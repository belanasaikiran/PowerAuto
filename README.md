# PowerBI Template Generator

A Node.js application that automatically generates PowerBI-style HTML dashboards from Excel files using Google's Gemini AI and Tailwind CSS.

## Features

- 📊 **Excel File Processing**: Automatically reads and analyzes Excel (.xlsx, .xls) files
- 🤖 **AI-Powered Generation**: Uses Google Gemini AI to create intelligent dashboard layouts
- 🎨 **Modern Design**: Generates HTML templates with Tailwind CSS styling
- 📱 **Responsive Layout**: Mobile-first responsive design using div elements
- 🔍 **Data Analysis**: Intelligent column type detection and data structure analysis
- 🚀 **REST API**: Easy-to-use API endpoints for integration
- 📁 **File Management**: Automatic file upload/download handling

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd powerauto
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
# or for development
npm run dev
```

The server will start on `http://localhost:3000`

## API Documentation

### Generate PowerBI Template

**Endpoint:** `POST /generate-powerbi`

**Parameters:**
- `excelFile` (file): Excel file (.xlsx or .xls)
- `prompt` (string): Description of desired dashboard layout
- `apiKey` (string): Your Google Gemini API key

**Example using cURL:**
```bash
curl -X POST http://localhost:3000/generate-powerbi \
  -F "excelFile=@./sales-data.xlsx" \
  -F "prompt=Create a sales dashboard with bar charts and KPIs" \
  -F "apiKey=your_gemini_api_key_here"
```

**Example Response:**
```json
{
  "success": true,
  "message": "PowerBI template generated successfully",
  "templateUrl": "/templates/powerbi-template-1234567890.html",
  "downloadUrl": "http://localhost:3000/templates/powerbi-template-1234567890.html",
  "metadata": {
    "generatedAt": "2024-01-15T10:30:00.000Z",
    "excelFile": "uploads/1234567890-sales-data.xlsx",
    "prompt": "Create a sales dashboard with bar charts and KPIs"
  },
  "excelAnalysis": {
    "sheets": [
      {
        "name": "Sales Data",
        "columns": ["Date", "Region", "Product", "Sales Amount"],
        "rowCount": 1000
      }
    ],
    "summary": {
      "totalSheets": 1,
      "totalRows": 1000,
      "totalColumns": 4
    }
  }
}
```

## Usage Examples

### 1. Basic Usage (Programmatic)

```javascript
const PowerBITemplateGenerator = require('./utils/jsxGenerator');

const generator = new PowerBITemplateGenerator('your_gemini_api_key');

const result = await generator.generateTemplateFromExcel(
  'path/to/excel/file.xlsx',
  'Create a modern sales dashboard with charts and KPIs',
  'output/dashboard.html'
);

if (result.success) {
  console.log('Template generated:', result.htmlTemplate);
} else {
  console.error('Error:', result.error);
}
```

### 2. API Usage (Frontend Integration)

```javascript
// Frontend JavaScript example
const formData = new FormData();
formData.append('excelFile', fileInput.files[0]);
formData.append('prompt', 'Create a financial dashboard with revenue tracking');
formData.append('apiKey', 'your_gemini_api_key');

fetch('/generate-powerbi', {
  method: 'POST',
  body: formData
})
.then(response => response.json())
.then(data => {
  if (data.success) {
    // Open generated template
    window.open(data.downloadUrl, '_blank');
  } else {
    console.error('Generation failed:', data.message);
  }
});
```

### 3. Different Dashboard Types

The AI can generate various types of dashboards based on your prompt:

#### Sales Dashboard
```
"Create a comprehensive sales dashboard with:
- Bar charts showing sales by region and product
- Line charts for monthly trends
- KPI cards for total revenue, growth rate, and top products
- Interactive filters for date range and region
- Professional blue color scheme"
```

#### Financial Dashboard
```
"Design a financial analytics dashboard featuring:
- Revenue vs expenses comparison charts
- Profit margin trends over time
- Budget variance analysis
- Cash flow indicators
- Green/red color coding for positive/negative values"
```

#### Marketing Dashboard
```
"Build a marketing performance dashboard with:
- Campaign ROI metrics
- Conversion funnel visualization
- Customer acquisition costs
- Social media engagement stats
- Colorful, modern design with gradients"
```

## Supported Excel Data Types

The system automatically detects and handles:

- **Numbers**: Integers, decimals, percentages
- **Dates**: Various date formats
- **Text**: Categories, names, descriptions
- **Boolean**: True/false values

## Generated Template Features

Each generated HTML template includes:

- ✅ **Tailwind CSS**: Modern, utility-first styling
- ✅ **Responsive Design**: Works on desktop, tablet, and mobile
- ✅ **Chart Containers**: Placeholder areas for data visualization
- ✅ **Interactive Elements**: Filters, dropdowns, and controls
- ✅ **Professional Layout**: Grid-based organization
- ✅ **Accessibility**: Semantic HTML structure
- ✅ **Customizable**: Easy to modify colors, fonts, and layout

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server status and available endpoints |
| `/health` | GET | Health check endpoint |
| `/generate-powerbi` | POST | Generate PowerBI template from Excel |
| `/templates/:filename` | GET | Serve generated HTML templates |
| `/api-docs` | GET | Complete API documentation |

## Environment Variables

Create a `.env` file for production:

```env
PORT=3000
NODE_ENV=production
GEMINI_API_KEY=your_gemini_api_key_here
```

## Error Handling

The API provides detailed error messages:

```json
{
  "success": false,
  "error": "Failed to process Excel file",
  "message": "File format not supported. Please use .xlsx or .xls files."
}
```

Common errors:
- Invalid file format
- Missing API key
- Excel file parsing errors
- Gemini API rate limits
- Network connectivity issues

## Getting a Gemini API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Create a new API key
4. Copy the key and use it in your requests

## File Structure

```
powerauto/
├── server.js              # Main Express server
├── utils/
│   └── jsxGenerator.js    # PowerBI template generator class
├── example-usage.js       # Usage examples
├── uploads/               # Temporary Excel file storage
├── templates/             # Generated HTML templates
├── package.json           # Dependencies
└── README.md             # This file
```

## Development

For development with auto-restart:

```bash
npm run dev
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

ISC License

## Support

For issues and questions:
- Check the API documentation at `/api-docs`
- Review the example usage in `example-usage.js`
- Open an issue on GitHub

---

**Note**: This tool generates HTML templates with placeholder content. For fully functional dashboards with real data binding, you'll need to integrate with charting libraries like Chart.js, D3.js, or similar. 