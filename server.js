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

        if (!image) {
            return res.status(400).json({ error: "No image provided" });
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
You are a food nutrition estimator.

Look at the meal photo and estimate the most likely food name and nutrition.

Return ONLY valid JSON in this exact format:
{
  "name": "Chicken rice bowl",
  "serving": "1 bowl",
  "calories": 650,
  "protein": 42,
  "carbs": 72,
  "fat": 18
}

Rules:
- Do not include extra text.
- Use integers only.
- If unsure, make a reasonable estimate.
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