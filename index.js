const express = require("express");
const cors = require("cors");
const app = express();
const { Pool } = require("pg");
const { parse } = require("csv-parse/sync");
const path = require("path");
const multer = require("multer");

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
  if (req.file) {
    console.log("File received:");
    console.log("  originalname:", req.file.originalname);
    console.log("  mimetype:", req.file.mimetype);
    console.log("  size:", req.file.size);
  } else {
    console.log("No file received in request.");
    return res.status(400).json({ error: "No file uploaded" });
  }
  if (prompt) {
    console.log("Prompt received:", prompt);
  } else {
    console.log("No prompt received.");
  }
  const result = await saveCsvToDb(req.file.buffer, req.file.originalname);
  console.log("Result from saveCsvToDb:", result);
  res.json({ ...result, prompt });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
