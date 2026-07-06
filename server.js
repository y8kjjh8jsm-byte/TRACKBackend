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
app.use(express.json({ limit: "20mb" }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.send("TRACK Food AI Running");
});

function cleanAIJson(text) {
  return text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

function roundMacro(value) {
  return Math.round(Number(value) || 0);
}

function fixMealEstimate(meal) {
  meal.name = meal.name || "Estimated meal";
  meal.serving = meal.serving || "1 serving";

  meal.calories = roundMacro(meal.calories);
  meal.protein = roundMacro(meal.protein);
  meal.carbs = roundMacro(meal.carbs);
  meal.fat = roundMacro(meal.fat);

  if (!Array.isArray(meal.components)) {
    meal.components = [];
  }

  meal.components = meal.components.map((item) => ({
    name: item.name || "Food item",
    estimatedGrams: roundMacro(item.estimatedGrams),
    calories: roundMacro(item.calories),
    protein: roundMacro(item.protein),
    carbs: roundMacro(item.carbs),
    fat: roundMacro(item.fat)
  }));

  return meal;
}

app.post("/analyze-food", verifyFirebaseToken, aiLimiter, async (req, res) => {
  try {
    const image = req.body.image;

    if (!image) {
      return res.status(400).json({
        error: "No image provided"
      });
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
You are an expert nutrition AI for the TRACK fitness app.

Carefully inspect the entire food image.

Your job:
1. Identify EVERY visible food component.
2. Estimate each component separately.
3. Estimate grams for each component.
4. Estimate calories, protein, carbs and fat for each component.
5. Add all components together for the final meal total.

Important rules:
- Do NOT only identify the largest item.
- Do NOT ignore meat, chicken, lamb, beef, fish, eggs, cheese, sauces, oils or toppings.
- If rice and meat are visible, estimate them separately.
- If bone-in meat is visible, only count the edible meat.
- If the meal looks oily, buttery, creamy, fried, or cooked with ghee, include that fat.
- Be realistic, not too low.
- For mixed meals, break them into parts like rice, meat, sauce, oil, vegetables, bread, cheese, dressing, etc.
- Return ONLY valid JSON.
- No explanation outside the JSON.

Return this exact JSON structure:

{
  "name": "",
  "serving": "",
  "calories": 0,
  "protein": 0,
  "carbs": 0,
  "fat": 0,
  "components": [
    {
      "name": "",
      "estimatedGrams": 0,
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0
    }
  ]
}

Example:
If the image shows lamb rice, return rice, lamb, and oil/ghee as separate components, then total them.
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

    const cleanedText = cleanAIJson(response.output_text);
    const parsedMeal = JSON.parse(cleanedText);
    const finalMeal = fixMealEstimate(parsedMeal);

    console.log(finalMeal);

    res.json(finalMeal);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Food analysis failed",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TRACK Food AI running on port ${PORT}`);
});