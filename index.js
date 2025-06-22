require("dotenv").config();
const express = require("express");
require("dotenv").config();
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
app.post("/api/userprompt", (req, res) => {
  const { prompt } = req.body;
  // Process the prompt as needed
  res.json({ message: "acknowledged", prompt });
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

  // Summarize using Llama with the file and prompt
  const summary = await summarizeWithLlamaFile(
    req.file.buffer,
    req.file.originalname,
    prompt,
    true,
  );
  console.log("Summary from Llama:", summary);

  // Save the file to the DB after summarization
  const result = await saveCsvToDb(req.file.buffer, req.file.originalname);
  console.log("Result from saveCsvToDb:", result);

  res.json({ ...result, prompt, summary });
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

const llama = require("llama-api-client")({ 
  apiKey: process.env.LLAMA_API_KEY });

app.post("/api/ai-agent", async (req, res) => {
  const { prompt, table } = req.body;
  if (!prompt || !table) {
    return res.status(400).json({ error: "Prompt and table are required." });
  }

  try {
    // Get table columns for context
    const colRes = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    const columns = colRes.rows.map(r => r.column_name).join(", ");

    // Compose the instruction for Llama
    const llamaPrompt = `You are an expert SQL assistant. The table "${table}" has columns: ${columns}. Write a SQL SELECT query for the following request: ${prompt}. Only return the SQL statement.`;

    // Call the Llama API using the client
    const completion = await llama.createCompletion({
      model: "Llama-4-Maverick-17B-128E-Instruct-FP8", // Use the correct model name for your API
      prompt: llamaPrompt,
      max_tokens: 128,
      temperature: 0.2
    });

    let sql = completion.choices[0].text.trim();

    // Optionally, extract only the SQL statement
    const match = sql.match(/SELECT[\s\S]*?;/i);
    if (match) sql = match[0];

    // Run the generated SQL query
    const result = await pool.query(sql);
    res.json({ sql, rows: result.rows });
  } catch (err) {
    console.error("AI agent error:", err);
    res.status(500).json({ error: err.message });
  }
});






app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
