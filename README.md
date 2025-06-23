# PowerAuto

PowerAuto is a powerful Node.js application that processes data, generates insights, and converts text to speech using AI technologies. It serves as a bridge between your data and AI-powered analytics and voice generation capabilities.

## Features

- **Data Processing**: Upload and process CSV files with automated schema detection
- **Database Integration**: Store and manage data in PostgreSQL
- **AI-Powered Analytics**: Generate insights and summaries from your data using Llama AI
- **Chart Generation**: Create dynamic chart configurations based on data analysis
- **Text-to-Speech**: Convert text to speech using ElevenLabs API
- **Dashboard Explanation**: Generate narrative explanations for dashboards
- **WebSocket Support**: Stream audio responses in real-time

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL database
- API keys for:
  - Llama AI
  - ElevenLabs (for text-to-speech)
  - Google Generative AI (Gemini)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/belanasaikiran/PowerAuto.git
   cd PowerAuto
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Add your API keys and database configuration
   ```
   LLAMA_API_KEY="your_llama_api_key"
   ELEVEN_LABS_API_KEY="your_elevenlabs_api_key"
   GEMINI_API_KEY="your_gemini_api_key"
   PG_USER="power"
   PG_PASSWORD="your_password"
   PG_HOST="localhost"
   PG_PORT=5432
   PG_DATABASE="powerdb"
   ```

4. Set up PostgreSQL:
   - You can use Docker to run PostgreSQL:
     ```
     docker run --name postgres-power \
       -e POSTGRES_USER=power \
       -e POSTGRES_PASSWORD=your_password \
       -e POSTGRES_DB=powerdb \
       -p 5432:5432 \
       -d postgres
     ```
   - Set up the required database tables:
     ```sql
     CREATE TABLE IF NOT EXISTS files (
         id SERIAL PRIMARY KEY,
         file_name TEXT UNIQUE NOT NULL,
         uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
         file_data BYTEA NOT NULL
     );
     ```

## Usage

1. Start the server:
   ```
   node index.js
   ```

2. The server will start on port 3000 (default) or the port specified in your environment variables.

3. API Endpoints:
   - POST `/api/userprompt`: Process a user prompt against a specific table
   - POST `/api/upload`: Upload a CSV file
   - POST `/api/table/:tableName`: Get data from a specific table
   - POST `/api/dashboard-to-speech`: Convert dashboard data to speech
   - POST `/api/text-to-speech`: Convert text to speech
   - POST `/api/summarize-file`: Summarize a file using Llama AI
   - GET `/api/tables`: List all available tables

## API Documentation

### User Prompt

```
POST /api/userprompt
Content-Type: application/json

{
  "prompt": "Summarize the sales data",
  "table": "sales_data",
  "chartType": "bar" // Optional
}
```

### File Upload

```
POST /api/upload
Content-Type: multipart/form-data

file: [CSV file]
```

### Text to Speech

```
POST /api/text-to-speech
Content-Type: application/json

{
  "text": "Text to convert to speech",
  "voiceId": "pNInz6obpgDQGcFmaJgB" // Optional
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the ISC License.

## Acknowledgments

- [Llama AI](https://www.llama-api.com/) for AI-powered analytics
- [ElevenLabs](https://elevenlabs.io/) for text-to-speech capabilities
- [Google Generative AI](https://ai.google.dev/) for Gemini integration