import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiClient {
    constructor(apiKey) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    }
    
    async generateDashboardConfig(excelData) {
        const prompt = this.createPrompt(excelData);
        
        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const jsonContent = response.text();
            
            // Parse and validate the JSON response
            try {
                const dashboardConfig = JSON.parse(jsonContent);
                return dashboardConfig;
            } catch (parseError) {
                // If JSON parsing fails, try to extract JSON from the response
                const jsonMatch = jsonContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                                 jsonContent.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[1] || jsonMatch[0]);
                }
                throw new Error('Failed to parse JSON response');
            }
        } catch (error) {
            throw new Error(`Gemini API error: ${error.message}`);
        }
    }
    
    createPrompt(excelData) {
        return `
You are an expert data analyst and dashboard designer. Analyze the following Excel data and create a structured JSON configuration for a dashboard using React chart components.

IMPORTANT: Do NOT include raw data. Process, analyze, and transform the data to create meaningful visualizations with proper aggregations, summaries, and insights.

Excel Data to Analyze:
${excelData}

Your Tasks:
1. ANALYZE the data patterns, trends, and relationships
2. IDENTIFY key metrics, KPIs, and meaningful insights
3. AGGREGATE and SUMMARIZE data appropriately for each chart type
4. CREATE processed data arrays that directly fit component interfaces
5. CHOOSE appropriate chart types based on data insights

Available Chart Components:

1. BarChart - For categorical comparisons and rankings
   Data Format: [{ label: "Category", value: aggregated_number }]
   Use for: Top/bottom performers, category comparisons, monthly/yearly totals

2. AreaChart - For trends and time series analysis  
   Data Format: [{ x: "time_period", y: value, series: "metric_name" }]
   Use for: Trends over time, growth patterns, multi-series comparisons

3. DonutChart - For proportions and distributions
   Data Format: [{ label: "Category", value: percentage_or_count }]
   Use for: Market share, category distribution, percentage breakdowns

4. FunnelChart - For process flows and conversion rates
   Data Format: [{ stage: "Process_Step", value: count_or_percentage }]
   Use for: Sales pipelines, conversion funnels, process flows

5. GaugeChart - For single KPI metrics and targets
   Data Format: { value: current_value, min: 0, max: target_value, unit: "%" }
   Use for: Performance against targets, completion rates, satisfaction scores

PROCESSING GUIDELINES:
- For sales data: Calculate totals, averages, growth rates, top performers
- For time series: Group by periods (monthly, quarterly), show trends
- For categorical data: Calculate percentages, top categories, distributions  
- For numerical data: Create ranges, calculate averages, identify outliers
- For KPIs: Calculate percentages, ratios, performance against targets

DATA TRANSFORMATION EXAMPLES:
❌ DON'T: Include raw rows like [{"Name": "John", "Sales": 1000}, {"Name": "Jane", "Sales": 1500}]
✅ DO: Process into [{"label": "Top Performer", "value": 1500}, {"label": "Average Sales", "value": 1250}]

❌ DON'T: Show all individual dates
✅ DO: Aggregate by meaningful periods like [{"x": "Q1 2024", "y": 45000}, {"x": "Q2 2024", "y": 52000}]

RESPONSE REQUIREMENTS:
- Maximum 8 components total (including KPIs)
- Each component must have PROCESSED, MEANINGFUL data
- Create 2-4 KPI gauges for key metrics
- Ensure data arrays are ready-to-display (no further processing needed)
- Use descriptive, business-friendly titles
- Include appropriate units and formatting

Output Structure:
{
  "dashboardTitle": "Descriptive Dashboard Name",
  "layout": { "cols": 12, "rows": "auto" },
  "kpis": [
    {
      "id": "unique-kpi-id",
      "type": "GaugeChart",
      "position": { "x": 0, "y": 0, "width": 3, "height": 3 },
      "props": {
        "value": calculated_current_value,
        "min": 0,
        "max": target_or_max_value,
        "title": "Business Metric Name",
        "unit": "appropriate_unit"
      }
    }
  ],
  "components": [
    {
      "id": "unique-component-id", 
      "type": "BarChart|AreaChart|DonutChart|FunnelChart",
      "position": { "x": 0, "y": 3, "width": 6, "height": 4 },
      "props": {
        "data": processed_data_array,
        "title": "Insight-Driven Title",
        "colors": ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4"]
      }
    }
  ]
}

CRITICAL: Return ONLY the JSON object with PROCESSED data. No explanations, no raw data, no additional text.
        `;
    }
} 