require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { Pool } = require("pg");
const { parse } = require("csv-parse/sync");
const path = require("path");
const multer = require("multer");
const LlamaAPIClient = require("llama-api-client");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const WebSocket = require('ws');

const pool = new Pool({
  user: "power",
  host: "localhost",
  database: "power-auto-db",
  password: "pass",
  port: 5432,
});

const upload = multer();

app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  })
);
app.use(express.json());

//kaushik - START: TextToSpeech Agent Integration
class TextToSpeechAgent {
    constructor(geminiApiKey, elevenLabsApiKey) {
        this.genAI = new GoogleGenerativeAI(geminiApiKey);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        this.elevenLabsApiKey = elevenLabsApiKey;
        this.elevenLabsWsUrl = 'wss://api.elevenlabs.io/v1/text-to-speech';
        
        // Validate API key
        if (!elevenLabsApiKey) {
            console.warn('Warning: ElevenLabs API key not provided');
        }
    }

    /**
     * Generate narrative explanation from dashboard configuration
     */
    async generateDashboardExplanation(dashboardConfig) {
        const prompt = this.createExplanationPrompt(dashboardConfig);
        
        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const explanation = response.text();
            
            return explanation;
        } catch (error) {
            throw new Error(`Failed to generate explanation: ${error.message}`);
        }
    }

    /**
     * Convert text to speech using ElevenLabs WebSocket streaming
     */
    async textToSpeechStreaming(text, voiceId = 'pNInz6obpgDQGcFmaJgB', modelId = 'eleven_monolingual_v1') {
        if (!this.elevenLabsApiKey) {
            throw new Error('ElevenLabs API key is required');
        }

        const uri = `${this.elevenLabsWsUrl}/${voiceId}/stream-input?model_id=${modelId}`;
        console.log('Connecting to ElevenLabs WebSocket:', uri);
        
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(uri, {
                headers: {
                    'Authorization': `Bearer ${this.elevenLabsApiKey}`
                }
            });
            const audioChunks = [];
            let connectionTimeout;
            let hasReceivedData = false;

            // Set timeout for connection
            connectionTimeout = setTimeout(() => {
                ws.close();
                reject(new Error('WebSocket connection timeout'));
            }, 30000); // 30 seconds timeout

            ws.on('open', async () => {
                console.log('WebSocket connection opened successfully');
                clearTimeout(connectionTimeout);
                
                try {
                    // Send initial configuration with API key
                    const initMessage = {
                        text: " ",
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.8,
                            use_speaker_boost: false,
                            style: 0.0,
                            speaker_boost: false
                        },
                        generation_config: {
                            chunk_length_schedule: [120, 160, 250, 290]
                        },
                        xi_api_key: this.elevenLabsApiKey
                    };

                    console.log('Sending initial configuration...');
                    await this.sendMessage(ws, initMessage);

                    // Add small delay before sending text
                    await new Promise(resolve => setTimeout(resolve, 100));

                    // Send the actual text
                    console.log('Sending text for conversion:', text.substring(0, 100) + '...');
                    await this.sendMessage(ws, { text: text });

                    // Add small delay before ending
                    await new Promise(resolve => setTimeout(resolve, 100));

                    // Send empty string to indicate end of text sequence
                    console.log('Sending end signal...');
                    await this.sendMessage(ws, { text: "" });

                } catch (error) {
                    console.error('Error sending messages:', error);
                    reject(error);
                }
            });

            ws.on('message', (data) => {
                try {
                    const response = JSON.parse(data.toString());
                    console.log('Received WebSocket message:', { 
                        hasAudio: !!response.audio, 
                        isFinal: response.isFinal,
                        error: response.error 
                    });
                    
                    if (response.error) {
                        console.error('ElevenLabs API error:', response.error);
                        reject(new Error(`ElevenLabs API error: ${response.error}`));
                        return;
                    }
                    
                    if (response.audio) {
                        // Decode base64 audio data
                        const audioData = Buffer.from(response.audio, 'base64');
                        audioChunks.push(audioData);
                        hasReceivedData = true;
                        console.log(`Received audio chunk: ${audioData.length} bytes`);
                    }
                    
                    if (response.isFinal) {
                        console.log('Audio generation completed, total chunks:', audioChunks.length);
                        if (audioChunks.length > 0) {
                            const completeAudio = Buffer.concat(audioChunks);
                            console.log(`Complete audio size: ${completeAudio.length} bytes`);
                            resolve(completeAudio);
                        } else {
                            reject(new Error('No audio data received - final response with no chunks'));
                        }
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                    reject(error);
                }
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                clearTimeout(connectionTimeout);
                reject(new Error(`WebSocket error: ${error.message}`));
            });

            ws.on('close', (code, reason) => {
                console.log(`WebSocket connection closed - Code: ${code}, Reason: ${reason}`);
                clearTimeout(connectionTimeout);
                
                if (audioChunks.length > 0 && hasReceivedData) {
                    const completeAudio = Buffer.concat(audioChunks);
                    console.log(`Resolving with audio data: ${completeAudio.length} bytes`);
                    resolve(completeAudio);
                } else {
                    const errorMsg = hasReceivedData ? 
                        'Connection closed but no audio chunks received' : 
                        'No audio data received - check API key and voice ID';
                    console.error(errorMsg);
                    reject(new Error(errorMsg));
                }
            });
        });
    }

    /**
     * Helper method to send JSON messages over WebSocket
     */
    sendMessage(ws, message) {
        return new Promise((resolve, reject) => {
            if (ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket is not open'));
                return;
            }
            
            const messageStr = JSON.stringify(message);
            console.log('Sending WebSocket message:', { 
                textLength: message.text?.length || 0, 
                hasApiKey: !!message.xi_api_key 
            });
            
            ws.send(messageStr, (error) => {
                if (error) {
                    console.error('Error sending WebSocket message:', error);
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Fallback HTTP API method for text-to-speech conversion
     */
    async textToSpeechHTTP(text, voiceId = 'pNInz6obpgDQGcFmaJgB') {
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
        
        try {
            console.log('Using HTTP API as fallback...');
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'Content-Type': 'application/json',
                    'xi-api-key': this.elevenLabsApiKey
                },
                body: JSON.stringify({
                    text: text,
                    model_id: 'eleven_monolingual_v1',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.8,
                        style: 0.0,
                        use_speaker_boost: false
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const audioBuffer = Buffer.from(await response.arrayBuffer());
            console.log(`HTTP API returned audio: ${audioBuffer.length} bytes`);
            return audioBuffer;
            
        } catch (error) {
            throw new Error(`HTTP API failed: ${error.message}`);
        }
    }

    /**
     * Main method: Process dashboard config and generate audio explanation
     */
    async processDashboardToSpeech(dashboardConfig, voiceId = 'pNInz6obpgDQGcFmaJgB') {
        try {
            console.log('Generating dashboard explanation...');
            const explanation = await this.generateDashboardExplanation(dashboardConfig);
            
            console.log('Converting explanation to speech...');
            let audioBuffer;
            
            try {
                // Try WebSocket streaming first
                audioBuffer = await this.textToSpeechStreaming(explanation, voiceId);
            } catch (wsError) {
                console.warn('WebSocket streaming failed, trying HTTP API:', wsError.message);
                // Fallback to HTTP API
                audioBuffer = await this.textToSpeechHTTP(explanation, voiceId);
            }
            
            return {
                success: true,
                explanation: explanation,
                audioBuffer: audioBuffer,
                audioSize: audioBuffer.length
            };
        } catch (error) {
            throw new Error(`Text-to-speech processing failed: ${error.message}`);
        }
    }

    /**
     * Create prompt for generating dashboard explanation
     */
    createExplanationPrompt(dashboardConfig) {
        return `
You are a professional data analyst presenting dashboard insights to business stakeholders. 

Based on the following dashboard configuration, create a clear, engaging, and professional spoken explanation that would be perfect for a business presentation or executive briefing.

Dashboard Configuration:
${JSON.stringify(dashboardConfig, null, 2)}

Requirements for the explanation:
1. Start with a brief overview of what the dashboard shows
2. Highlight the most important KPIs and their significance
3. Explain key trends, patterns, and insights from each chart
4. Use business-friendly language (avoid technical jargon)
5. Make it conversational and engaging for audio presentation
6. Include specific numbers and percentages where relevant
7. End with actionable insights or recommendations
8. Keep it between 2-4 minutes of speaking time (approximately 300-600 words)

Style Guidelines:
- Use natural, conversational tone
- Include pauses for emphasis (use commas and periods)
- Speak as if presenting to executives
- Be confident and authoritative
- Make it interesting and engaging

Generate ONLY the explanation text, no additional formatting or meta-commentary.
        `;
    }

    /**
     * Stream audio directly to response (for real-time playback)
     */
    async streamAudioToResponse(dashboardConfig, res, voiceId = 'pNInz6obpgDQGcFmaJgB') {
        try {
            const explanation = await this.generateDashboardExplanation(dashboardConfig);
            
            res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Transfer-Encoding': 'chunked',
                'Access-Control-Allow-Origin': '*'
            });

            const uri = `${this.elevenLabsWsUrl}/${voiceId}/stream-input?model_id=eleven_monolingual_v1`;
            const ws = new WebSocket(uri);

            ws.on('open', async () => {
                await this.sendMessage(ws, {
                    text: " ",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.8,
                        use_speaker_boost: false
                    },
                    generation_config: {
                        chunk_length_schedule: [120, 160, 250, 290]
                    },
                    xi_api_key: this.elevenLabsApiKey
                });

                await this.sendMessage(ws, { text: explanation });
                await this.sendMessage(ws, { text: "" });
            });

            ws.on('message', (data) => {
                try {
                    const response = JSON.parse(data);
                    if (response.audio) {
                        const audioData = Buffer.from(response.audio, 'base64');
                        res.write(audioData);
                    }
                    if (response.isFinal) {
                        res.end();
                    }
                } catch (error) {
                    console.error('Error processing audio stream:', error);
                    res.status(500).end();
                }
            });

            ws.on('error', (error) => {
                console.error('WebSocket streaming error:', error);
                res.status(500).end();
            });

        } catch (error) {
            console.error('Error streaming audio:', error);
            res.status(500).json({ error: error.message });
        }
    }
}

// Initialize TextToSpeech Agent
const ttsAgent = new TextToSpeechAgent(
    process.env.GOOGLE_API_KEY,
    process.env.ELEVENLABS_API_KEY
);
//kaushik - END: TextToSpeech Agent Integration

/**
 * Save a CSV file buffer to the database, create a new table, and insert its data.
 * @param {Buffer} fileBuffer - The CSV file as a Buffer.
 * @param {string} originalFileName - The original file name.
 * @returns {Promise<{table: string, status: string, error?: string}>}
 */
async function saveCsvToDb(fileBuffer, originalFileName) {
  try {
    const timestamp = Date.now();
    const baseName = path
      .parse(originalFileName)
      .name.replace(/[^a-zA-Z0-9_]/g, "_");
    const uniqueFileName = `${baseName}_${timestamp}`;

    const csvString = fileBuffer.toString();
    const records = parse(csvString, { columns: true, skip_empty_lines: true });
    if (!records.length) throw new Error("CSV file is empty or invalid.");
    const columns = Object.keys(records[0]);

    let fileSaved = false;
    try {
      await pool.query(
        "INSERT INTO files (file_name, uploaded_at, file_data) VALUES ($1, NOW(), $2)",
        [uniqueFileName, fileBuffer],
      );
      fileSaved = true;
    } catch (fileErr) {
      console.error("Failed to save CSV file to files table:", fileErr);
    }
    if (!fileSaved) {
      return {
        status: "error",
        error: "Failed to save CSV file to files table.",
      };
    }

    const columnDefs = columns.map((col) => `"${col}" TEXT`).join(", ");
    await pool.query(`CREATE TABLE "${uniqueFileName}" (${columnDefs})`);

    for (const row of records) {
      const values = columns.map((col) => row[col]);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      await pool.query(
        `INSERT INTO "${uniqueFileName}" (${columns.map((col) => `"${col}"`).join(", ")}) VALUES (${placeholders})`,
        values,
      );
    }

    return { table: uniqueFileName, status: "success" };
  } catch (err) {
    console.error("Error processing CSV upload:", err);
    return { status: "error", error: err.message };
  }
}

/**
 * Summarize a file using Meta Llama 4 API via llama-api-client.
 * @param {Buffer} fileBuffer - The file buffer to summarize.
 * @param {string} fileName - The file name.
 * @returns {Promise<string>} - The summary.
 */
async function summarizeWithLlamaFile(
  fileBuffer,
  fileName,
  userPrompt,
  chartType,
) {
  if (!process.env.LLAMA_API_KEY) {
    throw new Error("LLAMA_API_KEY is not set in environment variables");
  }
  const client = new LlamaAPIClient({
    apiKey: process.env.LLAMA_API_KEY,
  });

  const csvContent = fileBuffer.toString("utf-8");
  let prompt = `The following is the content of a CSV file named "${fileName}":\n${csvContent}\n\n${userPrompt}\n\n`;

  if (chartType) {
    prompt += `
The user wants to visualize the data as a chart using react-chartjs-2.
Please output only a valid JSON object with the following structure:

{
  "labels": [...],
  "datasets": [
    {
      "label": "...",
      "data": [...],
      "backgroundColor": [...]
    }
  ]
}

Do not include any explanation, markdown, or extra text. Only output the JSON object.
`.trim();
  } else {
    prompt += `
Summarize this CSV file in clear, concise English.
Structure:
Paragraph 1 — Lead and context (what is this data about)
Paragraph 2 — Key facts, trends, or outliers
Paragraph 3 — Broader implications or closing information

Do not include markdown, headings, or explanations — just return the plain English summary.
`.trim();
  }

  try {
    const res = await client.chat.completions.create({
      model: "Llama-4-Maverick-17B-128E-Instruct-FP8",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 512,
      temperature: 0.3,
    });

    return (
      res.completion_message?.content?.text?.trim() || "Summary not found."
    );
  } catch (err) {
    console.error("LLaMA summarization error:", err.message);
    return "Summary generation failed. Please try again.";
  }
}

// 1. Prompt-only API
app.post("/api/userprompt", async (req, res) => {
  const prompt = req.body.prompt;
  const table = req.body.table;

  if (!prompt) {
    return res.status(400).json({ error: "No prompt provided" });
  }
  if (!table) {
    return res.status(400).json({ error: "No table provided" });
  }

  try {
    // Fetch all rows from the specified table
    const result = await pool.query(`SELECT * FROM "${table}"`);
    if (!result.rows.length) {
      return res.status(404).json({ error: `No data found in table ${table}` });
    }

    // Convert rows to CSV string for Llama
    const columns = Object.keys(result.rows[0]);
    const csvRows = [
      columns.join(","),
      ...result.rows.map((row) =>
        columns.map((col) => row[col] ?? "").join(","),
      ),
    ];
    const csvContent = csvRows.join("\n");

    // 1. Extract chart type from prompt using Llama
    let chartType = "";
    try {
      const client = new LlamaAPIClient({
        apiKey: process.env.LLAMA_API_KEY,
      });
      const chartTypePrompt = `
Given the following user prompt, extract only the type of chart the user is requesting (such as "pie", "bar", "line", "doughnut", etc). If no chart type is mentioned, respond with "none".

Prompt:
${prompt}

Respond with only the chart type in lowercase, or "none".
`.trim();
      const chartTypeRes = await client.chat.completions.create({
        model: "Llama-4-Maverick-17B-128E-Instruct-FP8",
        messages: [{ role: "user", content: chartTypePrompt }],
        max_completion_tokens: 10,
        temperature: 0,
      });
      chartType = chartTypeRes.completion_message?.content?.text
        ?.trim()
        .replace(/["'.]/g, "");
      console.log("Extracted chart type from prompt:", chartType);
    } catch (err) {
      console.error("Error extracting chart type from prompt:", err);
      chartType = "";
    }

    // 2. Compose the Llama prompt
    let llamaPrompt = `The following is the content of a CSV file from the table "${table}":\n${csvContent}\n\n${prompt}\n\n`;
    let wantQuestions = false;
    if (chartType && chartType !== "none") {
      wantQuestions = true;
      llamaPrompt += `
The user wants to visualize the data as a ${chartType} using react-chartjs-2.
Please output only a valid JSON object with the following structure:

{
  "labels": [...],
  "datasets": [
    {
      "label": "...",
      "data": [...],
      "backgroundColor": [...]
    }
  ]
}

Do not include any explanation, markdown, or extra text. Only output the JSON object.
`.trim();
    } else {
      llamaPrompt += `
Analyze the CSV data and answer the user's question in clear, concise English.
Do not include markdown, headings, or explanations — just return the plain English answer.
`.trim();
    }

    // 3. Call Llama for summary or chart data
    const client = new LlamaAPIClient({
      apiKey: process.env.LLAMA_API_KEY,
    });
    const llamaRes = await client.chat.completions.create({
      model: "Llama-4-Maverick-17B-128E-Instruct-FP8",
      messages: [{ role: "user", content: llamaPrompt }],
      max_completion_tokens: 512,
      temperature: 0.3,
    });

    const summary =
      llamaRes.completion_message?.content?.text?.trim() ||
      "Summary not found.";

    // If chartType, also ask for 2-3 meaningful questions about the CSV file
    let questions = [];
    let report = "";
    if (wantQuestions) {
      try {
        const questionsPrompt = `
Given the following CSV data, generate 2-3 meaningful, insightful questions that a user might ask about this data. Output as a JSON array of strings. Do not include any explanation or markdown.

CSV data:
${csvContent}
`.trim();
        const questionsRes = await client.chat.completions.create({
          model: "Llama-4-Maverick-17B-128E-Instruct-FP8",
          messages: [{ role: "user", content: questionsPrompt }],
          max_completion_tokens: 128,
          temperature: 0.3,
        });
        // Try to parse as JSON array
        try {
          questions = JSON.parse(
            questionsRes.completion_message?.content?.text?.trim() || "[]",
          );
        } catch (e) {
          questions = [];
        }
      } catch (err) {
        console.error("Error getting questions from Llama:", err);
        questions = [];
      }
    }

    // Generate a report about what was done with the user's request
    try {
      const reportPrompt = `
Given the following user prompt and CSV data, provide a brief report (2-3 sentences) describing what you did to fulfill the request and any insights or recommendations. Do not include markdown or headings, just plain English.

User prompt: ${prompt}
CSV data from table "${table}":
${csvContent}
`.trim();
      const reportRes = await client.chat.completions.create({
        model: "Llama-4-Maverick-17B-128E-Instruct-FP8",
        messages: [{ role: "user", content: reportPrompt }],
        max_completion_tokens: 128,
        temperature: 0.3,
      });
      report = reportRes.completion_message?.content?.text?.trim() || "";
    } catch (err) {
      console.error("Error getting report from Llama:", err);
      report = "Could not generate a report for this request.";
    }

    res.json({ table, prompt, chartType, summary, questions, report });
  } catch (err) {
    console.error("Error in /api/userprompt:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. File + Prompt API
app.post("/api/upload-csv-prompt", upload.single("file"), async (req, res) => {
  const prompt = req.body.prompt;
  console.log("Received /api/upload-csv-prompt request");
  if (!req.file) {
    console.log("No file received in request.");
    return res.status(400).json({ error: "No file uploaded" });
  }
  console.log("File received:");
  console.log("  originalname:", req.file.originalname);
  console.log("  mimetype:", req.file.mimetype);
  console.log("  size:", req.file.size);

  if (!prompt) {
    console.log("No prompt received.");
    return res.status(400).json({ error: "No prompt provided" });
  }
  console.log("Prompt received:", prompt);

  // Extract chart type from prompt using Llama
  let chartType = "";
  try {
    const client = new LlamaAPIClient({
      apiKey: process.env.LLAMA_API_KEY,
    });
    const chartTypePrompt = `
Given the following user prompt, extract only the type of chart the user is requesting (such as "pie", "bar", "line", "doughnut", etc). If no chart type is mentioned, respond with "none".

Prompt:
${prompt}

Respond with only the chart type in lowercase, or "none".
`.trim();
    const chartTypeRes = await client.chat.completions.create({
      model: "Llama-4-Maverick-17B-128E-Instruct-FP8",
      messages: [{ role: "user", content: chartTypePrompt }],
      max_completion_tokens: 10,
      temperature: 0,
    });
    chartType = chartTypeRes.completion_message?.content?.text
      ?.trim()
      .replace(/["'.]/g, "");
    console.log("Extracted chart type from prompt:", chartType);
  } catch (err) {
    console.error("Error extracting chart type from prompt:", err);
    chartType = "";
  }

  // Summarize using Llama with the file and prompt, and chartType if found
  const summary = await summarizeWithLlamaFile(
    req.file.buffer,
    req.file.originalname,
    prompt,
    chartType !== "none" ? chartType : "",
  );
  console.log("Summary from Llama:", summary);

  // Save the file to the DB after summarization
  const result = await saveCsvToDb(req.file.buffer, req.file.originalname);
  console.log("Result from saveCsvToDb:", result);

  res.json({ ...result, prompt, summary, chartType });
});

/**
 * API: Summarize the latest uploaded file in the database using Meta Llama 4, sending the file as input.
 */
app.get("/api/summarize-latest-file", async (req, res) => {
  try {
    // Get the latest file from the files table
    const fileResult = await pool.query(
      "SELECT file_name, file_data FROM files ORDER BY uploaded_at DESC LIMIT 1",
    );
    if (!fileResult.rows.length) {
      return res.status(404).json({ error: "No files found in database." });
    }
    const { file_name, file_data } = fileResult.rows[0];

    // Get prompt and chartType from query parameters (optional)
    const prompt = req.query.prompt || "";
    const chartType = req.query.chartType || "";

    // Summarize using the file as input and the prompt/chartType
    const summary = await summarizeWithLlamaFile(
      file_data,
      file_name,
      prompt,
      chartType,
    );
    res.json({ file: file_name, summary, prompt, chartType });
  } catch (err) {
    console.error("Error summarizing latest file:", err);
    res.status(500).json({ error: err.message });
  }
});

//kaushik - START: New TextToSpeech API Endpoints
// 3. Generate Audio Explanation for Dashboard
//kaushik - START: Updated Audio Generation Endpoint with Better Error Handling
app.post("/api/generate-audio-explanation", async (req, res) => {
  console.log("=== Audio Generation Request ===");
  console.log("Request body:", JSON.stringify(req.body, null, 2));
  
  const { dashboardConfig, voiceId } = req.body;
  
  if (!dashboardConfig) {
    console.error("No dashboard configuration provided");
    return res.status(400).json({ error: "Dashboard configuration is required" });
  }

  // Check if API keys are available
  if (!process.env.GOOGLE_API_KEY) {
    console.error("GOOGLE_API_KEY is missing");
    return res.status(500).json({ error: "Google API key not configured" });
  }
  
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("ELEVENLABS_API_KEY is missing");
    return res.status(500).json({ error: "ElevenLabs API key not configured" });
  }

  try {
    console.log("Generating audio explanation for dashboard...");
    console.log("Dashboard config:", dashboardConfig);
    console.log("Voice ID:", voiceId);
    
    const result = await ttsAgent.processDashboardToSpeech(dashboardConfig, voiceId);
    console.log("Audio generation successful, size:", result.audioSize);
    
    // Return audio as base64 for easy frontend handling
    const audioBase64 = result.audioBuffer.toString('base64');
    
    res.json({
      success: true,
      explanation: result.explanation,
      audioBase64: audioBase64,
      audioSize: result.audioSize
    });
  } catch (error) {
    console.error("=== Audio Generation Error ===");
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    // Send detailed error info
    res.status(500).json({ 
      error: `Audio generation failed: ${error.message}`,
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
//kaushik - END: Updated Audio Generation Endpoint

// 4. Stream Audio Explanation (Real-time)
app.post("/api/stream-audio-explanation", async (req, res) => {
  const { dashboardConfig, voiceId } = req.body;
  
  if (!dashboardConfig) {
    return res.status(400).json({ error: "Dashboard configuration is required" });
  }

  try {
    console.log("Streaming audio explanation for dashboard...");
    await ttsAgent.streamAudioToResponse(dashboardConfig, res, voiceId);
  } catch (error) {
    console.error("Error streaming audio explanation:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5. Generate Text Explanation Only
app.post("/api/generate-text-explanation", async (req, res) => {
  const { dashboardConfig } = req.body;
  
  if (!dashboardConfig) {
    return res.status(400).json({ error: "Dashboard configuration is required" });
  }

  try {
    console.log("Generating text explanation for dashboard...");
    const explanation = await ttsAgent.generateDashboardExplanation(dashboardConfig);
    
    res.json({
      success: true,
      explanation: explanation
    });
  } catch (error) {
    console.error("Error generating text explanation:", error);
    res.status(500).json({ error: error.message });
  }
});
//kaushik - END: New TextToSpeech API Endpoints

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});