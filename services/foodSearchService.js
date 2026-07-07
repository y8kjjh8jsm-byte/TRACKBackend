const { searchUSDA } = require("./usdaService");
const { searchOpenFoodFacts } = require("./openFoodFactsService");
const { findLocalNutritionMatch } = require("./localNutritionService");
const { getRestaurantNutrition } = require("./restaurantService");
const { buildCustomisedNutrition } = require("./customisationEngine");

function round(value) {
  return Math.round(Number(value) || 0);
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

async function searchFood(parsed) {
  const searchName = parsed.foodName || parsed.rawQuery;
  const brand = String(parsed.brand || "").toLowerCase();

  let baseNutrition = null;
  let source = "";

  if (parsed.isRestaurantItem && brand) {
    baseNutrition = getRestaurantNutrition(searchName, brand);
    if (baseNutrition) source = baseNutrition.source;
  }

  if (!baseNutrition) {
    baseNutrition = await searchUSDA(searchName);
    if (baseNutrition) source = "USDA";
  }

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

module.exports = {
  searchFood
};
