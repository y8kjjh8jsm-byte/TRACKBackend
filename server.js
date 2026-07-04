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

// RESTAURANT DATABASE
const restaurantFoods = [
  item("mcdonalds", "big mac", 509, 26, 42, 25, "1 burger"),
  item("mcdonalds", "quarter pounder with cheese", 518, 31, 37, 26, "1 burger"),
  item("mcdonalds", "mcchicken sandwich", 369, 17, 40, 15, "1 sandwich"),
  item("mcdonalds", "medium fries", 337, 4, 42, 17, "1 portion"),
  item("kfc", "zinger burger", 450, 26, 43, 18, "1 burger"),
  item("kfc", "fillet burger", 475, 32, 48, 18, "1 burger"),
  item("kfc", "popcorn chicken", 285, 17, 18, 16, "1 regular"),
  item("kfc", "fries", 250, 4, 32, 12, "1 regular"),
  item("papa johns", "medium pepperoni pizza", 2400, 104, 280, 96, "1 medium pizza"),
  item("papa johns", "medium cheese pizza", 2100, 92, 260, 78, "1 medium pizza"),
  item("dominos", "medium pepperoni pizza", 2200, 96, 270, 88, "1 medium pizza"),
  item("pizza hut", "medium pepperoni pizza", 2300, 95, 275, 92, "1 medium pizza"),
  item("subway", "italian bmt 6 inch", 410, 20, 46, 16, "1 6-inch sub"),
  item("nandos", "half chicken", 568, 70, 3, 31, "1 half chicken"),
  item("five guys", "cheeseburger", 840, 47, 40, 55, "1 burger"),
  item("starbucks", "caramel frappuccino", 380, 5, 63, 14, "1 grande"),
  item("costa", "latte", 150, 10, 15, 6, "1 medium"),
  item("greggs", "sausage roll", 329, 9, 24, 22, "1 sausage roll")
];

function item(brand, name, calories, protein, carbs, fat, serving) {
  return { brand, name, calories, protein, carbs, fat, serving };
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findRestaurantFood(brand, name) {
  const haystack = normalize(`${brand} ${name}`);

  return restaurantFoods.find(food => {
    const full = normalize(`${food.brand} ${food.name}`);
    return haystack.includes(full) || full.includes(haystack) || haystack.includes(normalize(food.name));
  });
}

async function searchUSDA(query) {
  if (!process.env.USDA_API_KEY) return null;

  const response = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=1&api_key=${process.env.USDA_API_KEY}`
  );

  const data = await response.json();
  const food = data.foods?.[0];
  if (!food) return null;

  const nutrients = food.foodNutrients || [];

  return {
    name: food.description,
    serving: "100g",
    calories: Math.round(nutrients.find(n => n.nutrientName === "Energy")?.value || 0),
    protein: Math.round(nutrients.find(n => n.nutrientName === "Protein")?.value || 0),
    carbs: Math.round(nutrients.find(n => n.nutrientName === "Carbohydrate, by difference")?.value || 0),
    fat: Math.round(nutrients.find(n => n.nutrientName === "Total lipid (fat)")?.value || 0)
  };
}

app.get("/", (req, res) => {
  res.send("TRACK Food AI Running");
});

app.get("/search-food", verifyFirebaseToken, async (req, res) => {
  try {
    const query = req.query.query;
    if (!query) return res.json([]);

    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=10&api_key=${process.env.USDA_API_KEY}`
    );

    const data = await response.json();

    const foods = (data.foods || []).map(food => {
      const nutrients = food.foodNutrients || [];

      return {
        name: food.description,
        serving: "100g",
        calories: Math.round(nutrients.find(n => n.nutrientName === "Energy")?.value || 0),
        protein: Math.round(nutrients.find(n => n.nutrientName === "Protein")?.value || 0),
        carbs: Math.round(nutrients.find(n => n.nutrientName === "Carbohydrate, by difference")?.value || 0),
        fat: Math.round(nutrients.find(n => n.nutrientName === "Total lipid (fat)")?.value || 0)
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

    const recognition = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
Identify the food in this image for a fitness nutrition app.

Return ONLY valid JSON:
{
  "brand": "McDonald's",
  "item": "Big Mac",
  "genericFood": "burger",
  "serving": "1 burger",
  "confidence": 92
}

Rules:
- If it is a restaurant/brand item, identify the exact brand and menu item.
- Examples: McDonald's Big Mac, KFC Zinger Burger, Papa John's Medium Pepperoni Pizza.
- If homemade, set brand to "" and describe the food clearly.
- Do not estimate calories here.
- Return only JSON.
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

    let detected;
    try {
      detected = JSON.parse(recognition.output_text);
    } catch {
      detected = {
        brand: "",
        item: recognition.output_text || "Unknown food",
        genericFood: "meal",
        serving: "1 serving",
        confidence: 50
      };
    }

    const restaurantMatch = findRestaurantFood(detected.brand, detected.item);

    if (restaurantMatch) {
      return res.json({
        result: JSON.stringify({
          name: `${restaurantMatch.brand} ${restaurantMatch.name}`,
          serving: restaurantMatch.serving,
          calories: restaurantMatch.calories,
          protein: restaurantMatch.protein,
          carbs: restaurantMatch.carbs,
          fat: restaurantMatch.fat
        })
      });
    }

    const usdaFood = await searchUSDA(detected.genericFood || detected.item);

    if (usdaFood && usdaFood.calories > 0) {
      return res.json({
        result: JSON.stringify({
          name: usdaFood.name,
          serving: usdaFood.serving,
          calories: usdaFood.calories,
          protein: usdaFood.protein,
          carbs: usdaFood.carbs,
          fat: usdaFood.fat
        })
      });
    }

    const fallback = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
Estimate nutrition for this food image.

Return ONLY valid JSON:
{
  "name": "Chicken rice bowl",
  "serving": "1 medium bowl",
  "calories": 650,
  "protein": 42,
  "carbs": 72,
  "fat": 18
}

Rules:
- Return integers only.
- Use realistic portions.
- No markdown.
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
      result: fallback.output_text
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