require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { Pool } = require("pg");
const { parse } = require("csv-parse/sync");
const path = require("path");
const multer = require("multer");
const LlamaAPIClient = require("llama-api-client");

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
    origin: "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json());

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
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
