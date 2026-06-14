require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.get("/", (req, res) => {
    res.send("TRACK AI Backend Running");
});

app.post("/analyze-food", async (req, res) => {
    try {
        const { image } = req.body;

        if (!image || typeof image !== "string") {
            return res.status(400).json({ error: "No valid image provided" });
        }

        if (!image.startsWith("data:image/")) {
            return res.status(400).json({ error: "Invalid image format" });
        }

        const response = await openai.responses.create({
            model: "gpt-5.5",
            input: [
                {
                    role: "user",
                    content: [
                        {
                            type: "input_text",
                            text: `
You are a nutrition estimator for a fitness tracking app.

Analyze the meal photo carefully and estimate the most likely food items, portion size and nutrition.

Return ONLY valid JSON. Do not include markdown, comments, explanations or extra text.

Use this exact JSON format:
{
  "name": "Chicken rice bowl",
  "serving": "1 medium bowl",
  "calories": 650,
  "protein": 42,
  "carbs": 72,
  "fat": 18,
  "confidence": 0.82,
  "notes": "Estimated from visible chicken, rice and vegetables."
}

Rules:
- Return integers for calories, protein, carbs and fat.
- Confidence must be between 0 and 1.
- If multiple foods are visible, combine them into one meal name.
- If the image is unclear, still estimate but set confidence below 0.55.
- Do not invent extreme values.
- Use realistic portions.
- If nutrition is uncertain, choose a reasonable middle estimate.
- Never return text outside the JSON object.
`
                        },
                        {
                            type: "input_image",
                            image_url: image
                        }
                    ]
                }
            ]
        });

        const resultText = response.output_text;

        res.json({
            result: resultText
        });

    } catch (error) {
        console.error("AI food error:", error);
        res.status(500).json({
            error: "AI food recognition failed"
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});