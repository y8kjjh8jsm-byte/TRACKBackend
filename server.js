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

const nutritionDB = {
  rice: { calories: 170, protein: 3, carbs: 31, fat: 4 },
  "basmati rice": { calories: 160, protein: 3, carbs: 32, fat: 2 },
  "spiced rice": { calories: 175, protein: 3, carbs: 31, fat: 5 },
  biryani: { calories: 190, protein: 4, carbs: 30, fat: 7 },
  pasta: { calories: 160, protein: 6, carbs: 31, fat: 1 },
  bread: { calories: 265, protein: 9, carbs: 49, fat: 3 },
  potato: { calories: 87, protein: 2, carbs: 20, fat: 0 },
  fries: { calories: 312, protein: 3, carbs: 41, fat: 15 },

  chicken: { calories: 165, protein: 31, carbs: 0, fat: 4 },
  lamb: { calories: 280, protein: 25, carbs: 0, fat: 20 },
  beef: { calories: 250, protein: 26, carbs: 0, fat: 15 },
  fish: { calories: 180, protein: 24, carbs: 0, fat: 8 },
  salmon: { calories: 208, protein: 22, carbs: 0, fat: 13 },
  egg: { calories: 155, protein: 13, carbs: 1, fat: 11 },

  cheese: { calories: 400, protein: 25, carbs: 2, fat: 33 },
  yogurt: { calories: 95, protein: 4, carbs: 7, fat: 5 },
  salad: { calories: 25, protein: 1, carbs: 5, fat: 0 },
  vegetables: { calories: 40, protein: 2, carbs: 8, fat: 0 },
  sauce: { calories: 120, protein: 1, carbs: 8, fat: 9 },
  oil: { calories: 884, protein: 0, carbs: 0, fat: 100 },
  ghee: { calories: 900, protein: 0, carbs: 0, fat: 100 },
  butter: { calories: 717, protein: 1, carbs: 0, fat: 81 }
};

function cleanAIJson(text) {
  return text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

function round(value) {
  return Math.round(Number(value) || 0);
}

function findNutritionMatch(name = "") {
  const lower = name.toLowerCase();

  const keys = Object.keys(nutritionDB);
  const exact = keys.find((key) => lower.includes(key));
  if (exact) return nutritionDB[exact];

  if (lower.includes("rice")) return nutritionDB["spiced rice"];
  if (lower.includes("mandi")) return nutritionDB["spiced rice"];
  if (lower.includes("kabsa")) return nutritionDB["spiced rice"];
  if (lower.includes("biryani")) return nutritionDB.biryani;

  if (lower.includes("lamb")) return nutritionDB.lamb;
  if (lower.includes("chicken")) return nutritionDB.chicken;
  if (lower.includes("beef")) return nutritionDB.beef;
  if (lower.includes("fish")) return nutritionDB.fish;
  if (lower.includes("salmon")) return nutritionDB.salmon;
  if (lower.includes("egg")) return nutritionDB.egg;

  if (lower.includes("pasta")) return nutritionDB.pasta;
  if (lower.includes("bread")) return nutritionDB.bread;
  if (lower.includes("potato")) return nutritionDB.potato;
  if (lower.includes("fries")) return nutritionDB.fries;

  if (lower.includes("oil")) return nutritionDB.oil;
  if (lower.includes("ghee")) return nutritionDB.ghee;
  if (lower.includes("butter")) return nutritionDB.butter;
  if (lower.includes("sauce")) return nutritionDB.sauce;
  if (lower.includes("cheese")) return nutritionDB.cheese;
  if (lower.includes("yogurt")) return nutritionDB.yogurt;
  if (lower.includes("salad")) return nutritionDB.salad;
  if (lower.includes("vegetables")) return nutritionDB.vegetables;

  return null;
}

function calculateFromDatabase(components) {
  return components.map((item) => {
    const grams = round(item.estimatedGrams || item.grams || 0);
    const match = findNutritionMatch(item.name);

    if (!match || grams <= 0) {
      return {
        name: item.name || "Food item",
        estimatedGrams: grams,
        calories: round(item.calories),
        protein: round(item.protein),
        carbs: round(item.carbs),
        fat: round(item.fat),
        source: "ai-estimate"
      };
    }

    return {
      name: item.name || "Food item",
      estimatedGrams: grams,
      calories: round((match.calories * grams) / 100),
      protein: round((match.protein * grams) / 100),
      carbs: round((match.carbs * grams) / 100),
      fat: round((match.fat * grams) / 100),
      source: "track-database"
    };
  });
}

function applySanityChecks(meal) {
  const text = `${meal.name} ${meal.components.map(c => c.name).join(" ")}`.toLowerCase();

  const hasRice =
    text.includes("rice") ||
    text.includes("biryani") ||
    text.includes("kabsa") ||
    text.includes("mandi");

  const hasMeat =
    text.includes("lamb") ||
    text.includes("chicken") ||
    text.includes("beef") ||
    text.includes("meat");

  const hasOil =
    text.includes("oil") ||
    text.includes("ghee") ||
    text.includes("butter");

  const meatGrams = meal.components
    .filter((c) => {
      const n = c.name.toLowerCase();
      return (
        n.includes("lamb") ||
        n.includes("chicken") ||
        n.includes("beef") ||
        n.includes("meat")
      );
    })
    .reduce((sum, c) => sum + (Number(c.estimatedGrams) || 0), 0);

  const riceGrams = meal.components
    .filter((c) => c.name.toLowerCase().includes("rice"))
    .reduce((sum, c) => sum + (Number(c.estimatedGrams) || 0), 0);

  if (meatGrams > 0) {
    meal.protein = Math.max(meal.protein, Math.round(meatGrams * 0.18));
    meal.calories = Math.max(meal.calories, Math.round(meatGrams * 1.8));
  }

  if (riceGrams > 0) {
    meal.carbs = Math.max(meal.carbs, Math.round(riceGrams * 0.25));
  }

  if (hasRice && hasMeat) {
    meal.calories = Math.max(meal.calories, 650);
    meal.protein = Math.max(meal.protein, 30);
    meal.carbs = Math.max(meal.carbs, 55);
    meal.fat = Math.max(meal.fat, hasOil ? 18 : 12);
  }

  return meal;
}

function buildFinalMeal(aiMeal) {
  const components = Array.isArray(aiMeal.components)
    ? aiMeal.components
    : Array.isArray(aiMeal.ingredients)
      ? aiMeal.ingredients
      : [];

  const calculatedComponents = calculateFromDatabase(components);

  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;

  calculatedComponents.forEach((item) => {
    calories += item.calories;
    protein += item.protein;
    carbs += item.carbs;
    fat += item.fat;
  });

  let finalMeal = {
    name: aiMeal.name || aiMeal.meal || "Estimated meal",
    serving: aiMeal.serving || "1 plate",
    calories: round(calories || aiMeal.calories),
    protein: round(protein || aiMeal.protein),
    carbs: round(carbs || aiMeal.carbs),
    fat: round(fat || aiMeal.fat),
    confidence: aiMeal.confidence || "medium",
    notes: aiMeal.notes || "Estimated from photo using component recognition and TRACK nutrition database.",
    components: calculatedComponents
  };

  finalMeal = applySanityChecks(finalMeal);

  return finalMeal;
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
You are the food vision system for TRACK.

Look at the image and identify the meal component by component.

Return ONLY valid JSON.

Do NOT calculate final nutrition yourself unless needed.
Your main job is to estimate visible ingredients and realistic gram amounts.

Rules:
- Identify every visible component.
- Estimate grams for each component.
- Include hidden cooking fats when likely, such as oil, butter or ghee.
- If meat is bone-in, estimate edible meat only.
- Do not ignore protein sources.
- If there are multiple visible meat pieces, estimate the total edible meat grams carefully.
- Do not call a rice-and-meat meal only "rice".
- Be realistic with portions.
- Give confidence as low, medium or high.

Return this exact JSON:

{
  "name": "",
  "serving": "",
  "confidence": "",
  "notes": "",
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

Example for rice with lamb:
{
  "name": "Spiced rice with lamb",
  "serving": "1 plate",
  "confidence": "medium",
  "notes": "Estimated from visible rice, lamb and likely cooking oil.",
  "components": [
    { "name": "spiced rice", "estimatedGrams": 320, "calories": 0, "protein": 0, "carbs": 0, "fat": 0 },
    { "name": "lamb", "estimatedGrams": 150, "calories": 0, "protein": 0, "carbs": 0, "fat": 0 },
    { "name": "ghee or cooking oil", "estimatedGrams": 10, "calories": 0, "protein": 0, "carbs": 0, "fat": 0 }
  ]
}
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

    const cleaned = cleanAIJson(response.output_text);
    const aiMeal = JSON.parse(cleaned);
    const finalMeal = buildFinalMeal(aiMeal);

    console.log(finalMeal);

    res.json({
      result: JSON.stringify({
        name: finalMeal.name,
        serving: finalMeal.serving,
        calories: finalMeal.calories,
        protein: finalMeal.protein,
        carbs: finalMeal.carbs,
        fat: finalMeal.fat
      })
    });

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