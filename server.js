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

// ===============================
// TRACK FREE NUTRITION ENGINE
// ===============================

function item(brand, name, calories, protein, carbs, fat, serving, aliases = []) {
  return { brand, name, calories, protein, carbs, fat, serving, aliases };
}

const restaurantFoods = [
  item("mcdonalds", "big mac", 509, 26, 42, 25, "1 burger", ["big mac burger", "mcdonalds big mac", "big mac meal"]),
  item("mcdonalds", "quarter pounder with cheese", 518, 31, 37, 26, "1 burger", ["quarter pounder", "qp with cheese"]),
  item("mcdonalds", "mcchicken sandwich", 369, 17, 40, 15, "1 sandwich", ["mcchicken", "mayo chicken"]),
  item("mcdonalds", "medium fries", 337, 4, 42, 17, "1 medium fries", ["fries", "chips"]),
  item("mcdonalds", "large fries", 444, 5, 55, 22, "1 large fries", ["large chips"]),

  item("kfc", "zinger burger", 450, 26, 43, 18, "1 burger", ["zinger", "kfc zinger"]),
  item("kfc", "fillet burger", 475, 32, 48, 18, "1 burger", ["kfc fillet"]),
  item("kfc", "popcorn chicken", 285, 17, 18, 16, "1 regular", ["popcorn chicken regular"]),
  item("kfc", "regular fries", 250, 4, 32, 12, "1 regular fries", ["fries", "chips"]),
  item("kfc", "zinger box meal", 950, 45, 95, 43, "1 box meal", ["zinger meal", "zinger box"]),

  item("papa johns", "medium pepperoni pizza", 2400, 104, 280, 96, "1 medium pizza", ["pepperoni medium", "medium pepperoni"]),
  item("papa johns", "medium cheese pizza", 2100, 92, 260, 78, "1 medium pizza", ["cheese medium", "margherita medium"]),
  item("papa johns", "slice pepperoni pizza", 300, 13, 35, 12, "1 slice", ["pepperoni slice"]),

  item("dominos", "medium pepperoni pizza", 2200, 96, 270, 88, "1 medium pizza", ["medium pepperoni", "pepperoni medium"]),
  item("dominos", "medium cheese pizza", 2050, 88, 255, 75, "1 medium pizza", ["medium margherita", "cheese medium"]),
  item("pizza hut", "medium pepperoni pizza", 2300, 95, 275, 92, "1 medium pizza", ["pepperoni medium"]),

  item("subway", "italian bmt 6 inch", 410, 20, 46, 16, "1 6-inch sub", ["italian bmt", "bmt"]),
  item("subway", "chicken tikka 6 inch", 350, 24, 45, 8, "1 6-inch sub", ["chicken tikka"]),
  item("subway", "tuna 6 inch", 430, 22, 44, 19, "1 6-inch sub", ["tuna sub"]),

  item("nandos", "half chicken", 568, 70, 3, 31, "1 half chicken", ["half chicken nandos"]),
  item("nandos", "quarter chicken", 284, 35, 2, 15, "1 quarter chicken", ["quarter chicken nandos"]),

  item("five guys", "cheeseburger", 840, 47, 40, 55, "1 burger", ["five guys cheeseburger"]),
  item("five guys", "bacon cheeseburger", 920, 52, 40, 62, "1 burger", ["bacon cheese burger"]),

  item("starbucks", "caramel frappuccino", 380, 5, 63, 14, "1 grande", ["caramel frappe", "frappuccino"]),
  item("starbucks", "latte", 190, 13, 18, 7, "1 grande", ["caffe latte"]),

  item("costa", "latte", 150, 10, 15, 6, "1 medium", ["costa latte"]),
  item("greggs", "sausage roll", 329, 9, 24, 22, "1 sausage roll", ["greggs sausage roll"]),
  item("pret", "chicken caesar sandwich", 480, 28, 45, 20, "1 sandwich", ["caesar sandwich"])
];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text) {
  return normalize(text).split(" ").filter(Boolean);
}

function similarity(a, b) {
  const aw = new Set(words(a));
  const bw = new Set(words(b));
  if (!aw.size || !bw.size) return 0;

  let match = 0;
  for (const w of aw) {
    if (bw.has(w)) match++;
  }

  return match / Math.max(aw.size, bw.size);
}

function toFoodJSON(food, source = "restaurant_database") {
  return {
    name: `${titleCase(food.brand)} ${titleCase(food.name)}`.trim(),
    serving: food.serving,
    calories: Math.round(food.calories || 0),
    protein: Math.round(food.protein || 0),
    carbs: Math.round(food.carbs || 0),
    fat: Math.round(food.fat || 0),
    source
  };
}

function titleCase(text) {
  return String(text || "")
    .split(" ")
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : "")
    .join(" ");
}

function findRestaurantFood(brand, itemName) {
  const query = normalize(`${brand || ""} ${itemName || ""}`);
  let best = null;
  let bestScore = 0;

  for (const food of restaurantFoods) {
    const possibleNames = [
      `${food.brand} ${food.name}`,
      food.name,
      ...(food.aliases || []).map(a => `${food.brand} ${a}`),
      ...(food.aliases || [])
    ];

    for (const name of possibleNames) {
      const n = normalize(name);

      let score = similarity(query, n);

      if (query.includes(n) || n.includes(query)) score += 0.35;
      if (brand && normalize(food.brand).includes(normalize(brand))) score += 0.25;
      if (itemName && normalize(itemName).includes(normalize(food.name))) score += 0.25;

      if (score > bestScore) {
        bestScore = score;
        best = food;
      }
    }
  }

  return bestScore >= 0.45 ? best : null;
}

async function searchOpenFoodFacts(query) {
  try {
    const url =
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "TRACKFoodAI/1.0 (contact: support@trackapp.local)"
      }
    });

    const data = await response.json();
    const product = data.products?.[0];
    if (!product) return null;

    const nutriments = product.nutriments || {};

    const calories =
      nutriments["energy-kcal_100g"] ||
      nutriments["energy-kcal"] ||
      0;

    const protein = nutriments["proteins_100g"] || nutriments["proteins"] || 0;
    const carbs = nutriments["carbohydrates_100g"] || nutriments["carbohydrates"] || 0;
    const fat = nutriments["fat_100g"] || nutriments["fat"] || 0;

    if (!calories || calories <= 0) return null;

    return {
      name: product.product_name || product.generic_name || query,
      serving: "100g",
      calories: Math.round(calories),
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat),
      source: "open_food_facts"
    };
  } catch (error) {
    console.error("Open Food Facts error:", error.message);
    return null;
  }
}

async function searchUSDA(query) {
  try {
    if (!process.env.USDA_API_KEY) return null;

    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=5&api_key=${process.env.USDA_API_KEY}`
    );

    const data = await response.json();
    const foods = data.foods || [];

    let bestFood = null;

    for (const food of foods) {
      const nutrients = food.foodNutrients || [];
      const calories = nutrients.find(n => n.nutrientName === "Energy")?.value || 0;

      if (calories > 0) {
        bestFood = food;
        break;
      }
    }

    if (!bestFood) return null;

    const nutrients = bestFood.foodNutrients || [];

    return {
      name: bestFood.description,
      serving: "100g",
      calories: Math.round(nutrients.find(n => n.nutrientName === "Energy")?.value || 0),
      protein: Math.round(nutrients.find(n => n.nutrientName === "Protein")?.value || 0),
      carbs: Math.round(nutrients.find(n => n.nutrientName === "Carbohydrate, by difference")?.value || 0),
      fat: Math.round(nutrients.find(n => n.nutrientName === "Total lipid (fat)")?.value || 0),
      source: "usda"
    };
  } catch (error) {
    console.error("USDA search error:", error.message);
    return null;
  }
}

function cleanJSON(text) {
  return String(text || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

async function detectFoodFromImage(image) {
  const recognition = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
You are TRACK's professional food recognition engine.

Your job is NOT to estimate calories yet.
Your job is to identify the food as accurately as possible.

Return ONLY valid JSON:
{
  "brand": "McDonald's",
  "item": "Big Mac",
  "genericFood": "burger",
  "serving": "1 burger",
  "quantity": 1,
  "confidence": 92,
  "isRestaurantFood": true,
  "isPackagedFood": false,
  "possibleMatches": ["McDonald's Big Mac", "McDonald's Quarter Pounder"]
}

Rules:
- Identify exact restaurant/brand items where possible.
- Good examples:
  - McDonald's Big Mac
  - KFC Zinger Burger
  - Papa John's Medium Pepperoni Pizza
  - Domino's Medium Pepperoni Pizza
  - Starbucks Caramel Frappuccino
- If it is homemade, brand must be "".
- If unsure, lower confidence and include possibleMatches.
- Do not return calories.
- Do not return markdown.
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

  try {
    return JSON.parse(cleanJSON(recognition.output_text));
  } catch {
    return {
      brand: "",
      item: recognition.output_text || "Unknown food",
      genericFood: "meal",
      serving: "1 serving",
      quantity: 1,
      confidence: 40,
      isRestaurantFood: false,
      isPackagedFood: false,
      possibleMatches: []
    };
  }
}

async function estimateWithAI(image) {
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
  "fat": 18,
  "source": "ai_estimate"
}

Rules:
- Return integers only.
- Use realistic portions.
- Include oils, sauces, cheese and toppings.
- If restaurant food is visible but exact item is unknown, estimate conservatively.
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

  try {
    const parsed = JSON.parse(cleanJSON(fallback.output_text));
    return {
      name: parsed.name || "Estimated meal",
      serving: parsed.serving || "1 serving",
      calories: Math.round(parsed.calories || 0),
      protein: Math.round(parsed.protein || 0),
      carbs: Math.round(parsed.carbs || 0),
      fat: Math.round(parsed.fat || 0),
      source: "ai_estimate"
    };
  } catch {
    return {
      name: "Estimated meal",
      serving: "1 serving",
      calories: 500,
      protein: 25,
      carbs: 50,
      fat: 20,
      source: "ai_estimate"
    };
  }
}

async function resolveNutrition(detected, image) {
  const brand = detected.brand || "";
  const itemName = detected.item || detected.genericFood || "meal";
  const fullQuery = `${brand} ${itemName}`.trim();

  const restaurantMatch = findRestaurantFood(brand, itemName);
  if (restaurantMatch) return toFoodJSON(restaurantMatch, "restaurant_database");

  const offQuery = fullQuery || detected.genericFood;
  const openFoodFactsResult = await searchOpenFoodFacts(offQuery);
  if (openFoodFactsResult) return openFoodFactsResult;

  const usdaQuery = detected.genericFood || itemName;
  const usdaResult = await searchUSDA(usdaQuery);
  if (usdaResult) return usdaResult;

  return await estimateWithAI(image);
}

// ===============================
// ROUTES
// ===============================

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

    const detected = await detectFoodFromImage(image);
    const finalNutrition = await resolveNutrition(detected, image);

    res.json({
      result: JSON.stringify({
        name: finalNutrition.name,
        serving: finalNutrition.serving,
        calories: Math.round(finalNutrition.calories || 0),
        protein: Math.round(finalNutrition.protein || 0),
        carbs: Math.round(finalNutrition.carbs || 0),
        fat: Math.round(finalNutrition.fat || 0)
      })
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