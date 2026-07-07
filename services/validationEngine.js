function round(value) {
  return Math.round(Number(value) || 0);
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function validateMeal(meal) {
  const componentText = meal.components.map((c) => c.name).join(" ").toLowerCase();
  const fullText = `${meal.name} ${componentText}`.toLowerCase();

  const hasRice = includesAny(fullText, ["rice", "biryani", "kabsa", "mandi"]);
  const hasMeat = includesAny(fullText, ["lamb", "chicken", "beef", "steak", "meat", "fish", "salmon"]);
  const hasOil = includesAny(fullText, ["oil", "ghee", "butter"]);

  const meatGrams = meal.components
    .filter((c) => includesAny(c.name.toLowerCase(), ["lamb", "chicken", "beef", "steak", "meat", "fish", "salmon"]))
    .reduce((sum, c) => sum + (Number(c.estimatedGrams) || 0), 0);

  const riceGrams = meal.components
    .filter((c) => includesAny(c.name.toLowerCase(), ["rice", "biryani", "kabsa", "mandi"]))
    .reduce((sum, c) => sum + (Number(c.estimatedGrams) || 0), 0);

  if (meatGrams > 0) {
    meal.protein = Math.max(meal.protein, round(meatGrams * 0.18));
    meal.calories = Math.max(meal.calories, round(meatGrams * 1.6));
  }

  if (riceGrams > 0) {
    meal.carbs = Math.max(meal.carbs, round(riceGrams * 0.25));
  }

  if (hasRice && hasMeat) {
    meal.calories = Math.max(meal.calories, 650);
    meal.protein = Math.max(meal.protein, 30);
    meal.carbs = Math.max(meal.carbs, 55);
    meal.fat = Math.max(meal.fat, hasOil ? 18 : 12);
  }

  meal.calories = round(meal.calories);
  meal.protein = round(meal.protein);
  meal.carbs = round(meal.carbs);
  meal.fat = round(meal.fat);

  return meal;
}

module.exports = {
  validateMeal
};
