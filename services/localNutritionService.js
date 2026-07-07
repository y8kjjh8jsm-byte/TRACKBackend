const nutritionDB = require("../database/nutrition.json");

function findLocalNutritionMatch(name = "") {
  const lower = name.toLowerCase();
  const keys = Object.keys(nutritionDB);

  const exact = keys.find((key) => lower.includes(key));
  if (exact) return { key: exact, nutrition: nutritionDB[exact] };

  return null;
}

module.exports = {
  findLocalNutritionMatch
};
