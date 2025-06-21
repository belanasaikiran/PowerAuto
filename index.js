const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "http://localhost:3000", // Replace with your React app's origin if different
    methods: ["GET", "POST"],
  },
});

app.use(express.json());

// --- Dependencies for PostgreSQL and CSV parsing ---
const { Pool } = require("pg");
const { parse } = require("csv-parse/sync");
const path = require("path");
const multer = require("multer");

// --- PostgreSQL connection pool ---
const pool = new Pool({
  user: "power",
  host: "localhost",
  database: "power-auto-db",
  password: "pass",
  port: 5432,
});

// --- Multer setup for file uploads ---
const upload = multer();

// Root route
app.get("/", (req, res) => {
  res.send("Hello, Express with Socket.io!");
});

// --- Multer-based endpoint for CSV upload ---
app.post("/upload-csv", upload.single("csvfile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const originalFileName = req.file.originalname;
    const fileBuffer = req.file.buffer;

    // 1. Generate unique file name
    const timestamp = Date.now();
    const baseName = path
      .parse(originalFileName)
      .name.replace(/[^a-zA-Z0-9_]/g, "_");
    const uniqueFileName = `${baseName}_${timestamp}`;

    // 2. Parse CSV
    const csvString = fileBuffer.toString();
    const records = parse(csvString, { columns: true, skip_empty_lines: true });
    if (!records.length) throw new Error("CSV file is empty or invalid.");
    const columns = Object.keys(records[0]);

    // 3. Save file in 'files' table
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
      return res
        .status(500)
        .json({ error: "Failed to save CSV file to files table." });
    }

    // 4. Create new table for CSV data
    const columnDefs = columns.map((col) => `"${col}" TEXT`).join(", ");
    await pool.query(`CREATE TABLE "${uniqueFileName}" (${columnDefs})`);

    // 5. Insert CSV rows
    for (const row of records) {
      const values = columns.map((col) => row[col]);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      await pool.query(
        `INSERT INTO "${uniqueFileName}" (${columns.map((col) => `"${col}"`).join(", ")}) VALUES (${placeholders})`,
        values,
      );
    }

    res.json({ table: uniqueFileName, status: "success" });
  } catch (err) {
    console.error("Error processing CSV upload:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/userprompt endpoint
app.post("/api/userprompt", (req, res) => {
  const { prompt } = req.body;
  // Emit the prompt to all connected clients via socket.io
  io.emit("userprompt", { prompt, status: "acknowledged" });
  res.json({ message: "acknowledged" });
});

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });

  // Listen for userprompt_response from the client
  socket.on("userprompt", (data) => {
    console.log("Received userprompt_response:", data);
    // Send acknowledgement back to the client
    socket.emit("userprompt", { message: "acknowledged", received: data });
  });

  // --- Listen for getfile event for CSV upload ---
  /**
   * Expects:
   *   fileBuffer: Buffer (CSV file as Buffer or string)
   *   originalFileName: string (original file name)
   */
  socket.on("getfile", async (fileBuffer, originalFileName) => {
    try {
      // 1. Generate unique file name
      const timestamp = Date.now();
      const baseName = path
        .parse(originalFileName)
        .name.replace(/[^a-zA-Z0-9_]/g, "_");
      const uniqueFileName = `${baseName}_${timestamp}`;

      // 2. Parse CSV
      const csvString = Buffer.isBuffer(fileBuffer)
        ? fileBuffer.toString()
        : fileBuffer;
      const records = parse(csvString, {
        columns: true,
        skip_empty_lines: true,
      });
      if (!records.length) throw new Error("CSV file is empty or invalid.");
      const columns = Object.keys(records[0]);

      // 3. Save file in 'files' table
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
        socket.emit("file-uploaded", {
          status: "error",
          error: "Failed to save CSV file to files table.",
        });
        return;
      }
      if (!fileInsertResult.rows || fileInsertResult.rows.length === 0) {
        console.error(
          `CSV file "${uniqueFileName}" was NOT saved to the files table.`,
        );
      } else {
        console.log(
          `CSV file "${uniqueFileName}" saved to the files table with id ${fileInsertResult.rows[0].id}.`,
        );
      }

      // 4. Create new table for CSV data
      const columnDefs = columns.map((col) => `"${col}" TEXT`).join(", ");
      await pool.query(`CREATE TABLE "${uniqueFileName}" (${columnDefs})`);

      // 5. Insert CSV rows
      for (const row of records) {
        const values = columns.map((col) => row[col]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
        await pool.query(
          `INSERT INTO "${uniqueFileName}" (${columns.map((col) => `"${col}"`).join(", ")}) VALUES (${placeholders})`,
          values,
        );
      }

      socket.emit("file-uploaded", {
        table: uniqueFileName,
        status: "success",
      });
    } catch (err) {
      socket.emit("file-uploaded", { status: "error", error: err.message });
    }
  });

  // Example: Listen for a custom event from the client
  socket.on("sendMessage", (message) => {
    console.log("Message received:", message);
    // Example: Broadcast the message to all connected clients
    io.emit("receiveMessage", message);
  });
});

const PORT = process.env.PORT || 4000;
http.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
