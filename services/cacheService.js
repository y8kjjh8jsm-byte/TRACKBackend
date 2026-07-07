const mealCache = new Map();

function normalizeText(text = "") {
  return text.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

function createMealFingerprint(meal) {
  const components = (meal.components || [])
    .map(c => `${normalizeText(c.name)}:${Math.round(Number(c.estimatedGrams || 0) / 25) * 25}`)
    .sort()
    .join("|");

  return normalizeText(`${meal.name || "meal"}|${components}`);
}

function getCachedMeal(fingerprint) {
  return mealCache.get(fingerprint) || null;
}

function saveCachedMeal(fingerprint, meal) {
  mealCache.set(fingerprint, {
    ...meal,
    cachedAt: new Date().toISOString()
  });
}

module.exports = {
  createMealFingerprint,
  getCachedMeal,
  saveCachedMeal
};
