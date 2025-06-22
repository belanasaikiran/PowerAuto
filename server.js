import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { ExcelProcessor } from './utils/excelProcessor.js';
import { GeminiClient } from './utils/geminiClient.js';


dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Check if file is Excel format
        const allowedMimes = [
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];
        
        if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/)) {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
        }
    }
});

// Initialize Gemini client
const geminiClient = new GeminiClient(process.env.GOOGLE_API_KEY);

const PORT = process.env.PORT || 8000;

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'PowerAuto server is running',
        timestamp: new Date().toISOString()
    });
});

// NEW: Real-time data filtering endpoint
app.post('/filter-data', async (req, res) => {
    try {
        const { rawData, filters } = req.body;
        
        if (!rawData || !filters) {
            return res.status(400).json({
                error: 'Missing required data',
                message: 'Please provide rawData and filters'
            });
        }

        // Apply filters to the raw data
        const filteredData = applyFilters(rawData, filters);
        
        // Format data for AI
        const formattedData = ExcelProcessor.formatDataForAI(filteredData);
        
        // Regenerate component configuration with filtered data
        const dashboardConfig = await geminiClient.generateDashboardConfig(formattedData);
        
        res.json({
            success: true,
            message: 'Data filtered successfully',
            dashboardConfig: dashboardConfig,
            filteredData: filteredData
        });

    } catch (error) {
        console.error('Error filtering data:', error);
        res.status(500).json({
            error: 'Failed to filter data',
            message: error.message
        });
    }
});

// NEW: Main endpoint for dashboard configuration (React components)
app.post('/generate-dashboard-config', upload.single('excelFile'), async (req, res) => {
    try {
        // Validate file upload
        if (!req.file) {
            return res.status(400).json({
                error: 'No Excel file uploaded',
                message: 'Please upload an Excel file (.xlsx or .xls)'
            });
        }

        // Process the Excel file
        console.log('Processing Excel file for dashboard config:', req.file.originalname);
        const processedData = ExcelProcessor.processExcelFile(req.file.buffer);
        
        // Format data for AI
        const formattedData = ExcelProcessor.formatDataForAI(processedData);
        
        // Generate dashboard configuration using Gemini
        console.log('Generating dashboard configuration with Gemini...');
        const dashboardConfig = await geminiClient.generateDashboardConfig(formattedData);
        
        // Return the generated dashboard configuration
        res.json({
            success: true,
            message: 'Dashboard configuration generated successfully',
            data: {
                originalFileName: req.file.originalname,
                processedSheets: Object.keys(processedData),
                dashboardConfig: dashboardConfig
                // rawData removed - LLM processes everything internally
            }
        });

    } catch (error) {
        console.error('Error generating dashboard config:', error);
        res.status(500).json({
            error: 'Failed to generate dashboard configuration',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// LEGACY: Main endpoint: Process Excel and generate PowerBI template (for backward compatibility)
app.post('/generate-powerbi-template', upload.single('excelFile'), async (req, res) => {
    try {
        // Validate file upload
        if (!req.file) {
            return res.status(400).json({
                error: 'No Excel file uploaded',
                message: 'Please upload an Excel file (.xlsx or .xls)'
            });
        }

        // Process the Excel file
        console.log('Processing Excel file:', req.file.originalname);
        const processedData = ExcelProcessor.processExcelFile(req.file.buffer);
        
        // Format data for AI
        const formattedData = ExcelProcessor.formatDataForAI(processedData);
        
        // Generate dashboard configuration using Gemini (updated method)
        console.log('Generating dashboard configuration with Gemini...');
        const dashboardConfig = await geminiClient.generateDashboardConfig(formattedData);
        
        // Return both old and new format for backward compatibility
        res.json({
            success: true,
            message: 'Dashboard generated successfully',
            data: {
                originalFileName: req.file.originalname,
                processedSheets: Object.keys(processedData),
                dashboardConfig: dashboardConfig, // New format
                dataPreview: processedData
            }
        });

    } catch (error) {
        console.error('Error generating dashboard:', error);
        res.status(500).json({
            error: 'Failed to generate dashboard',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Endpoint to serve the generated HTML template directly
app.post('/generate-and-serve-template', upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send(`
                <html>
                    <body>
                        <h1>Error: No Excel file uploaded</h1>
                        <p>Please upload an Excel file (.xlsx or .xls)</p>
                        <a href="/">Go back</a>
                    </body>
                </html>
            `);
        }

        // Process the Excel file
        const processedData = ExcelProcessor.processExcelFile(req.file.buffer);
        const formattedData = ExcelProcessor.formatDataForAI(processedData);
        
        // Generate dashboard configuration using Gemini
        const dashboardConfig = await geminiClient.generateDashboardConfig(formattedData);
        
        // For backward compatibility, we could convert this to HTML if needed
        // but for now, we'll return a simple JSON visualization
        const htmlTemplate = `
            <html>
                <head>
                    <title>Dashboard Configuration</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        pre { background: #f5f5f5; padding: 20px; border-radius: 5px; overflow-x: auto; }
                        .header { color: #333; border-bottom: 2px solid #007acc; padding-bottom: 10px; }
                    </style>
                </head>
                <body>
                    <h1 class="header">Dashboard Configuration Generated</h1>
                    <p>This configuration can be used with your React components.</p>
                    <h2>Configuration JSON:</h2>
                    <pre>${JSON.stringify(dashboardConfig, null, 2)}</pre>
                    <p><strong>Note:</strong> Use the <code>/generate-dashboard-config</code> endpoint for direct JSON response.</p>
                </body>
            </html>
        `;
        
        // Serve the HTML template directly
        res.setHeader('Content-Type', 'text/html');
        res.send(htmlTemplate);

    } catch (error) {
        console.error('Error:', error);
        res.status(500).send(`
            <html>
                <body>
                    <h1>Error: Failed to generate PowerBI template</h1>
                    <p>${error.message}</p>
                    <a href="/">Go back</a>
                </body>
            </html>
        `);
    }
});


// Helper function to apply filters
function applyFilters(rawData, filters) {
    const filteredData = {};
    
    for (const [sheetName, sheetData] of Object.entries(rawData)) {
        let filteredRows = [...sheetData.data];
        
        filters.forEach(filter => {
            if (filter.sheet === sheetName) {
                const columnIndex = sheetData.headers.indexOf(filter.column);
                
                if (filter.type === 'dateRange') {
                    filteredRows = filteredRows.filter(row => {
                        const cellDate = new Date(row[columnIndex]).getTime();
                        return cellDate >= filter.min && cellDate <= filter.max;
                    });
                }
                
                if (filter.type === 'multiSelect' && filter.selectedValues) {
                    filteredRows = filteredRows.filter(row => {
                        return filter.selectedValues.includes(row[columnIndex]);
                    });
                }
            }
        });
        
        filteredData[sheetName] = {
            ...sheetData,
            data: filteredRows,
            summary: {
                ...sheetData.summary,
                totalRows: filteredRows.length
            }
        };
    }
    
    return filteredData;
}

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                error: 'File too large',
                message: 'Excel file must be smaller than 10MB'
            });
        }
    }
    
    res.status(500).json({
        error: 'Server error',
        message: error.message
    });
});

app.listen(PORT, () => {
    console.log(`🚀 PowerAuto server is running on port ${PORT}`);
    console.log(`📊 Visit http://localhost:${PORT} to upload Excel files`);
    console.log(`🔧 Component API: POST /generate-dashboard-config`);
    console.log(`🎨 HTML Template API: POST /generate-powerbi-template`);
    console.log(`🔑 Using Google API Key: ${process.env.GOOGLE_API_KEY ? 'Configured' : 'Not configured'}`);
});


