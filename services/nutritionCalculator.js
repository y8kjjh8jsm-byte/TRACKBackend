const { searchUSDA } = require("./usdaService");
const { searchOpenFoodFacts } = require("./openFoodFactsService");
const { findLocalNutritionMatch } = require("./localNutritionService");

function round(value) {
  return Math.round(Number(value) || 0);
}

function scaleNutrition(nutrition, grams) {
  const factor = grams / 100;

  return {
    calories: round(nutrition.calories * factor),
    protein: round(nutrition.protein * factor),
    carbs: round(nutrition.carbs * factor),
    fat: round(nutrition.fat * factor),
    source: nutrition.source
  };
}

async function getNutritionForComponent(component) {
  const name = component.name || "Food item";
  const grams = round(component.estimatedGrams || component.grams || 0);

  let nutrition = await searchUSDA(name);

  if (!nutrition) {
    nutrition = await searchOpenFoodFacts(name);
  }

  if (!nutrition) {
    const localMatch = findLocalNutritionMatch(name);
    if (localMatch) {
      nutrition = {
        ...localMatch.nutrition,
        source: "TRACK database"
      };
    }
  }

  if (!nutrition) {
    nutrition = {
      calories: round(component.calories),
      protein: round(component.protein),
      carbs: round(component.carbs),
      fat: round(component.fat),
      source: "AI fallback"
    };
  }

  const scaled = scaleNutrition(nutrition, grams);

  return {
    name,
    estimatedGrams: grams,
    confidence: component.confidence || "medium",
    calories: scaled.calories,
    protein: scaled.protein,
    carbs: scaled.carbs,
    fat: scaled.fat,
    source: scaled.source
  };
}

async function calculateMealNutrition(aiMeal) {
  const components = Array.isArray(aiMeal.components)
    ? aiMeal.components
    : Array.isArray(aiMeal.ingredients)
      ? aiMeal.ingredients
      : [];

  const calculatedComponents = [];

  for (const component of components) {
    const calculated = await getNutritionForComponent(component);
    calculatedComponents.push(calculated);
  }

  const totals = calculatedComponents.reduce(
    (sum, item) => ({
      calories: sum.calories + item.calories,
      protein: sum.protein + item.protein,
      carbs: sum.carbs + item.carbs,
      fat: sum.fat + item.fat
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  return {
    name: aiMeal.name || aiMeal.meal || "Estimated meal",
    serving: aiMeal.serving || "1 plate",
    confidence: aiMeal.confidence || "medium",
    notes: aiMeal.notes || "Estimated from photo using TRACK Food Engine.",
    calories: round(totals.calories),
    protein: round(totals.protein),
    carbs: round(totals.carbs),
    fat: round(totals.fat),
    components: calculatedComponents
  };
}

module.exports = {
  calculateMealNutrition
};
