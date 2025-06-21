# Database Setup for File Upload Feature

## 1. Migration SQL for Default `files` Table

To create the default `files` table in your PostgreSQL database, run the following SQL:

```sql
CREATE TABLE IF NOT EXISTS files (
    id SERIAL PRIMARY KEY,
    file_name TEXT UNIQUE NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
    file_data BYTEA NOT NULL
);
```

- `file_name`: Used as the unique table name for each CSV upload.
- `file_data`: Stores the raw CSV file as binary data.
- `uploaded_at`: Timestamp of when the file was uploaded.

---

## 2. Required Dependencies

Install these in your project root:

```sh
npm install pg csv-parse
```

- `pg`: PostgreSQL client for Node.js
- `csv-parse`: For parsing CSV files in Node.js

---

## 3. Usage

- Run the SQL above in your PostgreSQL instance to create the `files` table before using the upload feature.
- Ensure your backend has the dependencies installed before running the server.