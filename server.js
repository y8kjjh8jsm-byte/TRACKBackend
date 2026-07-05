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
  item("mcdonalds", "big mac", 509, 26, 42, 25, "1 burger", ["big mac meal"]),
  item("mcdonalds", "quarter pounder with cheese", 518, 31, 37, 26, "1 burger", ["quarter pounder"]),
  item("mcdonalds", "double cheeseburger", 445, 27, 34, 22, "1 burger", ["double cheese burger"]),
  item("mcdonalds", "mcchicken sandwich", 369, 17, 40, 15, "1 sandwich", ["mcchicken"]),
  item("mcdonalds", "chicken nuggets 6 piece", 261, 15, 18, 15, "6 nuggets", ["6 nuggets"]),
  item("mcdonalds", "medium fries", 337, 4, 42, 17, "1 medium fries", ["fries", "chips"]),
  item("mcdonalds", "large fries", 444, 5, 55, 22, "1 large fries", ["large chips"]),
  item("mcdonalds", "filet o fish", 319, 14, 38, 12, "1 burger", ["fish burger"]),
  item("mcdonalds", "mcflurry oreo", 258, 6, 38, 9, "1 mcflurry", ["oreo mcflurry"]),

  item("kfc", "zinger burger", 450, 26, 43, 18, "1 burger", ["zinger"]),
  item("kfc", "zinger box meal", 950, 45, 95, 43, "1 box meal", ["zinger meal"]),
  item("kfc", "fillet burger", 475, 32, 48, 18, "1 burger", ["chicken fillet burger"]),
  item("kfc", "popcorn chicken", 285, 17, 18, 16, "1 regular", ["popcorn chicken regular"]),
  item("kfc", "regular fries", 250, 4, 32, 12, "1 fries", ["fries", "chips"]),
  item("kfc", "hot wings 3 piece", 245, 18, 8, 16, "3 wings", ["hot wings"]),
  item("kfc", "mini fillet", 130, 15, 8, 5, "1 mini fillet", ["chicken mini fillet"]),

  item("papa johns", "medium pepperoni pizza", 2400, 104, 280, 96, "1 medium pizza", ["pepperoni medium"]),
  item("papa johns", "medium cheese pizza", 2100, 92, 260, 78, "1 medium pizza", ["cheese pizza", "margherita"]),
  item("papa johns", "pepperoni slice", 300, 13, 35, 12, "1 slice", ["slice of pepperoni"]),
  item("papa johns", "garlic bread", 560, 14, 70, 24, "1 portion", ["garlic pizza bread"]),

  item("dominos", "medium pepperoni pizza", 2200, 96, 270, 88, "1 medium pizza", ["pepperoni medium"]),
  item("dominos", "medium cheese pizza", 2050, 88, 255, 75, "1 medium pizza", ["margherita"]),
  item("dominos", "texas bbq pizza", 2300, 100, 280, 90, "1 medium pizza", ["bbq pizza"]),
  item("dominos", "garlic pizza bread", 690, 20, 82, 30, "1 portion", ["garlic bread"]),

  item("pizza hut", "medium pepperoni pizza", 2300, 95, 275, 92, "1 medium pizza", ["pepperoni pizza"]),
  item("pizza hut", "medium margherita pizza", 2000, 80, 250, 75, "1 medium pizza", ["cheese pizza"]),
  item("pizza hut", "cookie dough", 650, 8, 85, 30, "1 dessert", ["cookie dough dessert"]),

  item("subway", "italian bmt 6 inch", 410, 20, 46, 16, "1 6-inch sub", ["bmt"]),
  item("subway", "chicken tikka 6 inch", 350, 24, 45, 8, "1 6-inch sub", ["chicken tikka"]),
  item("subway", "tuna 6 inch", 430, 22, 44, 19, "1 6-inch sub", ["tuna sub"]),
  item("subway", "meatball marinara 6 inch", 480, 24, 56, 18, "1 6-inch sub", ["meatball sub"]),
  item("subway", "steak and cheese 6 inch", 390, 26, 43, 12, "1 6-inch sub", ["steak cheese"]),

  item("nandos", "quarter chicken", 284, 35, 2, 15, "1 quarter chicken", ["quarter chicken"]),
  item("nandos", "half chicken", 568, 70, 3, 31, "1 half chicken", ["half chicken"]),
  item("nandos", "butterfly chicken", 352, 60, 2, 12, "1 portion", ["chicken butterfly"]),
  item("nandos", "peri salted chips", 470, 7, 62, 22, "1 regular", ["peri chips", "fries"]),
  item("nandos", "spicy rice", 393, 8, 75, 7, "1 regular", ["rice"]),

  item("burger king", "whopper", 657, 31, 49, 37, "1 burger", ["bk whopper"]),
  item("burger king", "double whopper", 900, 50, 50, 58, "1 burger", ["double whopper"]),
  item("burger king", "chicken royale", 570, 28, 55, 27, "1 burger", ["royale"]),
  item("burger king", "medium fries", 380, 4, 50, 18, "1 fries", ["fries"]),

  item("five guys", "hamburger", 700, 39, 39, 43, "1 burger", ["five guys burger"]),
  item("five guys", "cheeseburger", 840, 47, 40, 55, "1 burger", ["cheese burger"]),
  item("five guys", "bacon cheeseburger", 920, 52, 40, 62, "1 burger", ["bacon cheese burger"]),
  item("five guys", "regular fries", 950, 13, 131, 41, "1 regular fries", ["fries"]),

  item("starbucks", "caramel frappuccino", 380, 5, 63, 14, "1 grande", ["caramel frappe"]),
  item("starbucks", "latte", 190, 13, 18, 7, "1 grande", ["caffe latte"]),
  item("starbucks", "iced caramel macchiato", 250, 10, 37, 7, "1 grande", ["caramel macchiato"]),
  item("starbucks", "mocha", 370, 14, 43, 15, "1 grande", ["caffe mocha"]),
  item("starbucks", "blueberry muffin", 360, 6, 52, 14, "1 muffin", ["muffin"]),

  item("costa", "latte", 150, 10, 15, 6, "1 medium", ["costa latte"]),
  item("costa", "cappuccino", 120, 8, 12, 5, "1 medium", ["costa cappuccino"]),
  item("costa", "hot chocolate", 320, 11, 47, 10, "1 medium", ["costa hot chocolate"]),
  item("costa", "caramel latte", 250, 10, 35, 8, "1 medium", ["caramel latte"]),

  item("greggs", "sausage roll", 329, 9, 24, 22, "1 sausage roll", ["greggs sausage roll"]),
  item("greggs", "steak bake", 408, 14, 30, 27, "1 bake", ["steak slice"]),
  item("greggs", "chicken bake", 424, 18, 34, 25, "1 bake", ["chicken slice"]),
  item("greggs", "vegan sausage roll", 309, 12, 23, 19, "1 roll", ["vegan roll"]),

  item("pret", "chicken caesar sandwich", 480, 28, 45, 20, "1 sandwich", ["caesar sandwich"]),
  item("pret", "tuna cucumber sandwich", 390, 24, 42, 14, "1 sandwich", ["tuna sandwich"]),
  item("pret", "ham and cheese baguette", 520, 28, 58, 20, "1 baguette", ["ham cheese baguette"]),

  item("taco bell", "crunchwrap supreme", 540, 16, 71, 21, "1 crunchwrap", ["crunchwrap"]),
  item("taco bell", "beef burrito", 430, 17, 58, 14, "1 burrito", ["burrito"]),
  item("taco bell", "quesadilla", 520, 27, 38, 28, "1 quesadilla", ["chicken quesadilla"]),

  item("wagamama", "chicken katsu curry", 998, 44, 128, 35, "1 bowl", ["katsu curry"]),
  item("wagamama", "yaki udon", 628, 25, 82, 22, "1 bowl", ["udon"]),
  item("wagamama", "ramen", 650, 35, 80, 20, "1 bowl", ["chicken ramen"])
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