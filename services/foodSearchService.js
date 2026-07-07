const { searchUSDA } = require("./usdaService");
const { searchOpenFoodFacts } = require("./openFoodFactsService");
const { findLocalNutritionMatch } = require("./localNutritionService");
const { buildCustomisedNutrition } = require("./customisationEngine");

function round(value) {
  return Math.round(Number(value) || 0);
}

const smartFoodLibrary = [
  { name: "Small banana", serving: "1 small banana", calories: 90, protein: 1, carbs: 23, fat: 0, tags: ["banana", "fruit"] },
  { name: "Medium banana", serving: "1 medium banana", calories: 105, protein: 1, carbs: 27, fat: 0, tags: ["banana", "fruit"] },
  { name: "Large banana", serving: "1 large banana", calories: 121, protein: 1, carbs: 31, fat: 0, tags: ["banana", "fruit"] },

  { name: "Cooked chicken breast", serving: "1 breast, about 170g", calories: 280, protein: 53, carbs: 0, fat: 6, tags: ["chicken", "breast", "cooked", "protein"] },
  { name: "Raw chicken breast", serving: "100g raw", calories: 120, protein: 23, carbs: 0, fat: 3, tags: ["chicken", "breast", "raw"] },
  { name: "Chicken thigh", serving: "1 thigh", calories: 210, protein: 26, carbs: 0, fat: 11, tags: ["chicken", "thigh"] },

  { name: "Starbucks Grande Iced Latte", serving: "Grande", calories: 130, protein: 9, carbs: 13, fat: 4, tags: ["starbucks", "iced", "latte", "coffee"] },
  { name: "Starbucks Grande Iced Latte with Oat Milk", serving: "Grande", calories: 190, protein: 3, carbs: 25, fat: 7, tags: ["starbucks", "iced", "latte", "oat"] },
  { name: "Starbucks Iced Caramel Macchiato", serving: "Grande", calories: 250, protein: 10, carbs: 37, fat: 7, tags: ["starbucks", "iced", "caramel", "macchiato"] },
  { name: "Starbucks White Chocolate Mocha", serving: "Grande", calories: 390, protein: 13, carbs: 53, fat: 15, tags: ["starbucks", "white", "mocha"] },

  { name: "Costa Medium Latte", serving: "Medium", calories: 150, protein: 10, carbs: 15, fat: 5, tags: ["costa", "latte", "coffee"] },
  { name: "Costa Medium Latte with Oat Milk", serving: "Medium", calories: 190, protein: 4, carbs: 25, fat: 7, tags: ["costa", "latte", "oat"] },
  { name: "Costa Caramel Latte", serving: "Medium", calories: 250, protein: 10, carbs: 35, fat: 7, tags: ["costa", "caramel", "latte"] },

  { name: "Caffè Nero Latte", serving: "Regular", calories: 150, protein: 9, carbs: 14, fat: 6, tags: ["caffe nero", "nero", "latte"] },
  { name: "Caffè Nero Iced Mocha", serving: "Regular", calories: 260, protein: 9, carbs: 38, fat: 8, tags: ["caffe nero", "nero", "iced", "mocha"] },

  { name: "McDonald's Big Mac", serving: "1 burger", calories: 493, protein: 26, carbs: 42, fat: 24, tags: ["mcdonalds", "maccies", "big mac", "burger"] },
  { name: "McDonald's Medium Fries", serving: "Medium", calories: 337, protein: 4, carbs: 42, fat: 17, tags: ["mcdonalds", "maccies", "fries"] },
  { name: "KFC Zinger Burger", serving: "1 burger", calories: 450, protein: 26, carbs: 45, fat: 18, tags: ["kfc", "zinger", "burger"] },
  { name: "Nando's Grilled Chicken Breast", serving: "1 portion", calories: 298, protein: 45, carbs: 1, fat: 12, tags: ["nandos", "nando", "chicken"] }
];

function scoreItem(item, query) {
  const q = query.toLowerCase();
  const searchable = `${item.name} ${item.serving} ${item.tags.join(" ")}`.toLowerCase();

  let score = 0;

  q.split(" ").forEach(word => {
    if (word.length > 1 && searchable.includes(word)) score += 10;
  });

  if (searchable.includes(q)) score += 30;

  return score;
}

function searchSmartLibrary(query) {
  return smartFoodLibrary
    .map(item => ({
      ...item,
      score: scoreItem(item, query),
      source: "TRACK smart library",
      confidence: "high"
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score, tags, ...item }) => item);
}

function buildDisplayName(parsed) {
  const parts = [];

  if (parsed.size) parts.push(parsed.size);
  if (parsed.brand) parts.push(parsed.brand);
  if (parsed.foodName) parts.push(parsed.foodName);
  if (parsed.milk) parts.push(`with ${parsed.milk}`);

  if (Array.isArray(parsed.extras) && parsed.extras.length > 0) {
    parts.push(`+ ${parsed.extras.join(", ")}`);
  }

  if (Array.isArray(parsed.removals) && parsed.removals.length > 0) {
    parts.push(`without ${parsed.removals.join(", ")}`);
  }

  return parts.filter(Boolean).join(" ") || parsed.rawQuery || "Food item";
}

async function buildSingleAIResult(parsed) {
  const searchName = parsed.foodName || parsed.rawQuery;

  let baseNutrition = await searchUSDA(searchName);
  let source = baseNutrition ? "USDA" : "";

  if (!baseNutrition) {
    baseNutrition = await searchOpenFoodFacts(`${parsed.brand || ""} ${searchName}`);
    if (baseNutrition) source = "Open Food Facts";
  }

  if (!baseNutrition) {
    const localMatch = findLocalNutritionMatch(searchName);
    if (localMatch) {
      baseNutrition = localMatch.nutrition;
      source = "TRACK database";
    }
  }

  if (!baseNutrition) {
    baseNutrition = {
      calories: 200,
      protein: 8,
      carbs: 25,
      fat: 7
    };
    source = "AI-style fallback";
  }

  const customised = buildCustomisedNutrition(baseNutrition, parsed);

  return {
    name: buildDisplayName(parsed),
    calories: round(customised.calories),
    protein: round(customised.protein),
    carbs: round(customised.carbs),
    fat: round(customised.fat),
    serving: parsed.size || parsed.unit || "1 serving",
    source,
    confidence: parsed.confidence || "medium",
    parsed
  };
}

async function searchFood(parsed) {
  const query = parsed.rawQuery || parsed.foodName || "";
  const smartResults = searchSmartLibrary(query);

  const aiResult = await buildSingleAIResult(parsed);

  const combined = [aiResult, ...smartResults];

  const unique = [];
  const seen = new Set();

  combined.forEach(item => {
    const key = item.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  });

  return unique.slice(0, 10);
}

module.exports = {
  searchFood
};
