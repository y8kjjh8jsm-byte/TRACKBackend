const axios = require("axios");

function getNutrient(food, nutrientNames) {
  const nutrients = food.foodNutrients || [];

  const found = nutrients.find((n) => {
    const name = (n.nutrientName || "").toLowerCase();
    return nutrientNames.some((target) => name.includes(target));
  });

  return Number(found?.value) || 0;
}

async function searchUSDA(foodName) {
  const apiKey = process.env.USDA_API_KEY;

  if (!apiKey) return null;

  try {
    const response = await axios.get("https://api.nal.usda.gov/fdc/v1/foods/search", {
      params: {
        api_key: apiKey,
        query: foodName,
        pageSize: 1
      }
    });

    const food = response.data.foods?.[0];
    if (!food) return null;

    return {
      calories: getNutrient(food, ["energy"]),
      protein: getNutrient(food, ["protein"]),
      carbs: getNutrient(food, ["carbohydrate"]),
      fat: getNutrient(food, ["total lipid", "fat"]),
      source: "USDA"
    };
  } catch (error) {
    console.error("USDA lookup failed:", error.message);
    return null;
  }
}

module.exports = {
  searchUSDA
};
