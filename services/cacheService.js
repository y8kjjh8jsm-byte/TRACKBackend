const fs = require("fs");
const path = require("path");

const CACHE_FILE = path.join(__dirname, "../database/mealCache.json");
const MAX_CACHE_ITEMS = 500;
const CACHE_TTL_DAYS = 30;

let mealCache = new Map();

function ensureCacheFile() {
  if (!fs.existsSync(CACHE_FILE)) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));
  }
}

function loadCache() {
  try {
    ensureCacheFile();
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    mealCache = new Map(Object.entries(parsed));
  } catch {
    mealCache = new Map();
  }
}

function saveCacheToFile() {
  try {
    const obj = Object.fromEntries(mealCache);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2));
  } catch (error) {
    console.error("Cache save failed:", error.message);
  }
}

function normalizeText(text = "") {
  return text.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

function createMealFingerprint(meal) {
  const components = (meal.components || [])
    .map(c => `${normalizeText(c.name)}:${Math.round(Number(c.estimatedGrams || 0) / 25) * 25}`)
    .sort()
    .join("|");

  return normalizeText(`${meal.restaurantHint || ""}|${meal.name || "meal"}|${components}`);
}

function isExpired(item) {
  if (!item?.cachedAt) return true;
  const ageMs = Date.now() - new Date(item.cachedAt).getTime();
  return ageMs > CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

function getCachedMeal(fingerprint) {
  const item = mealCache.get(fingerprint);
  if (!item || isExpired(item)) {
    mealCache.delete(fingerprint);
    saveCacheToFile();
    return null;
  }
  return item;
}

function saveCachedMeal(fingerprint, meal) {
  mealCache.set(fingerprint, {
    ...meal,
    cachedAt: new Date().toISOString()
  });

  if (mealCache.size > MAX_CACHE_ITEMS) {
    const firstKey = mealCache.keys().next().value;
    mealCache.delete(firstKey);
  }

  saveCacheToFile();
}

loadCache();

module.exports = {
  createMealFingerprint,
  getCachedMeal,
  saveCachedMeal
};
