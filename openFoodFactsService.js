const axios = require("axios");

async function searchOpenFoodFacts(foodName) {
  try {
    const response = await axios.get("https://world.openfoodfacts.org/cgi/search.pl", {
      params: {
        search_terms: foodName,
        search_simple: 1,
        action: "process",
        json: 1,
        page_size: 1
      }
    });

    const product = response.data.products?.[0];
    const n = product?.nutriments;

    if (!n) return null;

    return {
      calories: Number(n["energy-kcal_100g"]) || 0,
      protein: Number(n["proteins_100g"]) || 0,
      carbs: Number(n["carbohydrates_100g"]) || 0,
      fat: Number(n["fat_100g"]) || 0,
      source: "Open Food Facts"
    };
  } catch (error) {
    console.error("Open Food Facts lookup failed:", error.message);
    return null;
  }
}

module.exports = {
  searchOpenFoodFacts
};
