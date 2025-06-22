import XLSX from 'xlsx';

export class ExcelProcessor {
    static processExcelFile(buffer) {
        try {
            // Read the Excel file from buffer
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            
            // Get all sheet names
            const sheetNames = workbook.SheetNames;
            console.log(sheetNames);
            
            // Process all sheets
            const processedData = {};
            
            for (const sheetName of sheetNames) {
                const worksheet = workbook.Sheets[sheetName];
                
                // Convert sheet to JSON
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                if (jsonData.length > 0) {
                    // Extract headers and data
                    const headers = jsonData[0];
                    const data = jsonData.slice(1);
                    
                    // Create structured data
                    processedData[sheetName] = {
                        headers: headers,
                        data: data,
                        summary: this.generateDataSummary(headers, data)
                    };
                }
            }
            console.log(processedData);
            return processedData;
        } catch (error) {
            throw new Error(`Failed to process Excel file: ${error.message}`);
        }
    }
    
    static generateDataSummary(headers, data) {
        const summary = {
            totalRows: data.length,
            totalColumns: headers.length,
            columnTypes: {},
            dataPreview: data.slice(0, 5) // First 5 rows for preview
        };
        
        // Analyze column types
        headers.forEach((header, index) => {
            const columnData = data.map(row => row[index]).filter(val => val !== undefined && val !== null && val !== '');
            
            if (columnData.length > 0) {
                const sample = columnData[0];
                if (typeof sample === 'number') {
                    summary.columnTypes[header] = 'numeric';
                } else if (this.isDate(sample)) {
                    summary.columnTypes[header] = 'date';
                } else {
                    summary.columnTypes[header] = 'text';
                }
            }
        });
        
        return summary;
    }
    
    static isDate(value) {
        return !isNaN(Date.parse(value));
    }
    
    static formatDataForAI(processedData) {
        let formatted = "Excel Data Analysis:\n\n";
        
        for (const [sheetName, sheetData] of Object.entries(processedData)) {
            formatted += `Sheet: ${sheetName}\n`;
            formatted += `Rows: ${sheetData.summary.totalRows}, Columns: ${sheetData.summary.totalColumns}\n`;
            formatted += `Headers: ${sheetData.headers.join(', ')}\n`;
            formatted += `Column Types: ${JSON.stringify(sheetData.summary.columnTypes, null, 2)}\n`;
            formatted += `Sample Data (first 5 rows):\n`;
            
            // Format sample data as a table
            if (sheetData.summary.dataPreview.length > 0) {
                sheetData.summary.dataPreview.forEach((row, index) => {
                    formatted += `Row ${index + 1}: ${row.join(' | ')}\n`;
                });
            }
            formatted += "\n";
        }
        
        return formatted;
    }
} 