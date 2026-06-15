require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const verifyFirebaseToken = require("./authMiddleware");
const rateLimit = require("express-rate-limit");

const app = express();

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many AI scans. Please try again later." }
});

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.send("TRACK Food AI Running");
});

app.get("/search-food", verifyFirebaseToken, async (req, res) => {
  try {
    const query = req.query.query;

    if (!query) {
      return res.json([]);
    }

    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=10&api_key=${process.env.USDA_API_KEY}`
    );

    const data = await response.json();

    const foods = (data.foods || []).map(food => {
      const nutrients = food.foodNutrients || [];

      const calories =
        nutrients.find(n => n.nutrientName === "Energy")?.value || 0;

      const protein =
        nutrients.find(n => n.nutrientName === "Protein")?.value || 0;

      const carbs =
        nutrients.find(n => n.nutrientName === "Carbohydrate, by difference")?.value || 0;

      const fat =
        nutrients.find(n => n.nutrientName === "Total lipid (fat)")?.value || 0;

      return {
        name: food.description,
        serving: "100g",
        calories: Math.round(calories),
        protein: Math.round(protein),
        carbs: Math.round(carbs),
        fat: Math.round(fat)
      };
    });

    res.json(foods);

  } catch (error) {
    console.error("USDA search error:", error);
    res.status(500).json({ error: "Food search failed" });
  }
});

app.post("/analyze-food", verifyFirebaseToken, aiLimiter, async (req, res) => {
  try {
    const { image } = req.body;

    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "No valid image provided" });
    }

    if (!image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Invalid image format" });
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
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
  "fat": 18
}

Rules:
- Return integers for calories, protein, carbs and fat.
- If multiple foods are visible, combine them into one meal name.
- Use realistic portions.
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

    res.json({
      result: response.output_text
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
  console.log(`TRACK Food AI running on port ${PORT}`);
});