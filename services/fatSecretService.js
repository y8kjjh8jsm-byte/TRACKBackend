const { nutritionAudit } = require("./nutritionQualityService");

let tokenCache = { token: null, expiresAt: 0 };
const searchCache = new Map();
const SEARCH_TTL_MS = 10 * 60 * 1000;

const CHAIN_ALIASES = {
  "mcdonald's": ["mcdonald's", "mcdonalds", "mcdonald", "maccies", "maccy d's", "maccy ds"],
  "kfc": ["kfc", "kentucky fried chicken"],
  "starbucks": ["starbucks", "star bucks"],
  "costa coffee": ["costa coffee", "costa"],
  "burger king": ["burger king", "bk"],
  "wendy's": ["wendy's", "wendys"],
  "subway": ["subway"],
  "nando's": ["nando's", "nandos", "nando"],
  "five guys": ["five guys"],
  "caffè nero": ["caffè nero", "caffe nero", "cafe nero"],
  "taco bell": ["taco bell"],
  "domino's": ["domino's", "dominos"],
  "pizza hut": ["pizza hut"],
  "papa john's": ["papa john's", "papa johns"],
  "dunkin'": ["dunkin'", "dunkin", "dunkin donuts"],
  "chipotle": ["chipotle"],
  "popeyes": ["popeyes"],
  "wingstop": ["wingstop"],
  "pret a manger": ["pret a manger", "pret"],
  "greggs": ["greggs"],
  "shake shack": ["shake shack"]
};

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "with", "from", "at", "of", "for", "to", "food", "restaurant"
]);

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function clean(value) {
  return String(value ?? "").trim();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stableId(...parts) {
  let hash = 2166136261;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function fold(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value = "") {
  return fold(value).split(/\s+/).filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

function editDistance(a, b) {
  const x = fold(a);
  const y = fold(b);
  if (x === y) return 0;
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const old = row[j];
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = old;
    }
  }
  return row[y.length];
}

function fuzzyAliasInText(text, alias) {
  const f = fold(text);
  const a = fold(alias);
  if (!a || a.length < 5) return false;
  const aWords = a.split(/\s+/);
  const words = f.split(/\s+/);
  const width = aWords.length;
  for (let i = 0; i <= words.length - width; i += 1) {
    const candidate = words.slice(i, i + width).join(" ");
    const threshold = a.length >= 10 ? 2 : 1;
    if (editDistance(candidate, a) <= threshold) return true;
  }
  return false;
}

function removeAliasFromText(text, alias) {
  const f = fold(text);
  const a = fold(alias);
  if (!a) return f;
  if (f.includes(a)) return f.replace(a, " ").replace(/\s+/g, " ").trim();
  const words = f.split(/\s+/);
  const width = a.split(/\s+/).length;
  let best = null;
  for (let i = 0; i <= words.length - width; i += 1) {
    const candidate = words.slice(i, i + width).join(" ");
    const distance = editDistance(candidate, a);
    if (!best || distance < best.distance) best = { i, distance };
  }
  const threshold = a.length >= 10 ? 2 : 1;
  if (best && best.distance <= threshold) {
    return [...words.slice(0, best.i), ...words.slice(best.i + width)].join(" ").trim();
  }
  return f;
}

function canonicalBrand(value = "") {
  const f = fold(value);
  if (!f) return "";
  for (const [canonical, aliases] of Object.entries(CHAIN_ALIASES)) {
    if (aliases.some(alias => {
      const a = fold(alias);
      return f === a || f.includes(a) || a.includes(f) || fuzzyAliasInText(f, a);
    })) return canonical;
  }
  return f;
}

function parseIntent(query = "") {
  const raw = clean(query);
  const f = fold(raw);
  let brand = "";
  let matchedAlias = "";

  for (const [canonical, aliases] of Object.entries(CHAIN_ALIASES)) {
    const sorted = [...aliases].sort((a, b) => b.length - a.length);
    const alias = sorted.find(a => f.includes(fold(a))) || sorted.find(a => fuzzyAliasInText(f, a));
    if (alias) {
      brand = canonical;
      matchedAlias = fold(alias);
      break;
    }
  }

  let itemText = f;
  if (matchedAlias) itemText = removeAliasFromText(itemText, matchedAlias);

  const size = detectSize(raw);
  const mealRequested = /\b(meal|combo|meal deal|box meal)\b/i.test(raw);
  const quantityMatch = f.match(/^\s*(\d+(?:\.\d+)?)\s+(?!g\b|kg\b|ml\b|l\b)/);
  const quantity = quantityMatch ? Math.max(0.25, Math.min(num(quantityMatch[1], 1), 20)) : 1;
  const weightMatch = f.match(/\b(\d+(?:\.\d+)?)\s*(kg|g)\b/);
  const volumeMatch = f.match(/\b(\d+(?:\.\d+)?)\s*(ml|l)\b/);
  const requestedGrams = weightMatch ? num(weightMatch[1]) * (weightMatch[2] === "kg" ? 1000 : 1) : 0;
  const requestedMl = volumeMatch ? num(volumeMatch[1]) * (volumeMatch[2] === "l" ? 1000 : 1) : 0;

  // Measurements and a leading count describe the requested serving, not the food name.
  itemText = itemText
    .replace(/^\s*\d+(?:\.\d+)?\s+(?!g\b|kg\b|ml\b|l\b)/, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    raw,
    normalized: f,
    brand,
    itemText,
    itemTokens: tokens(itemText).filter(t => !/^\d/.test(t) && !["small", "medium", "large", "tall", "grande", "venti", "short", "meal", "combo"].includes(t)),
    size,
    mealRequested,
    quantity,
    requestedGrams,
    requestedMl,
    isRestaurantIntent: Boolean(brand)
  };
}

function hasCredentials() {
  return Boolean(process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET);
}

async function getAccessToken() {
  const axios = require("axios");
  if (!hasCredentials()) return null;
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const basic = Buffer.from(`${process.env.FATSECRET_CLIENT_ID}:${process.env.FATSECRET_CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const scope = clean(process.env.FATSECRET_SCOPE);
  if (scope) body.set("scope", scope);

  const response = await axios.post("https://oauth.fatsecret.com/connect/token", body.toString(), {
    timeout: 10_000,
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }
  });

  const token = response.data?.access_token;
  if (!token) throw new Error("FatSecret token response did not include access_token");
  const expiresIn = Math.max(120, num(response.data?.expires_in, 3600));
  tokenCache = { token, expiresAt: now + (expiresIn - 60) * 1000 };
  return token;
}

async function apiGet(path, params = {}) {
  const axios = require("axios");
  const token = await getAccessToken();
  if (!token) return null;
  const response = await axios.get(`https://platform.fatsecret.com/rest/${path}`, {
    timeout: 12_000,
    headers: { Authorization: `Bearer ${token}` },
    params: { ...params, format: "json" }
  });
  return response.data;
}

function detectSize(text = "") {
  const t = fold(text);
  if (/\bsmall\b/.test(t)) return "Small";
  if (/\bmedium\b/.test(t)) return "Medium";
  if (/\blarge\b/.test(t)) return "Large";
  if (/\btall\b/.test(t)) return "Tall";
  if (/\bgrande\b/.test(t)) return "Grande";
  if (/\bventi\b/.test(t)) return "Venti";
  if (/\bshort\b/.test(t)) return "Short";
  return "";
}

function detectFormat(text = "") {
  const t = fold(text);
  if (/\bmeal\b|\bcombo\b|\bmeal deal\b|\bwith fries\b|\bwith chips\b|\bbox meal\b/.test(t)) return "Meal";
  if (/\bdrink\b|\blatte\b|\bcoffee\b|\bmocha\b|\bcappuccino\b|\btea\b|\bcola\b|\bfrappuccino\b|\brefresher\b/.test(t)) return "Drink";
  return "Item";
}

function detectProteinType(text = "") {
  const t = fold(text);
  if (t.includes("chicken")) return "Chicken";
  if (t.includes("beef") || t.includes("steak") || t.includes("burger")) return "Beef";
  if (t.includes("fish") || t.includes("salmon") || t.includes("tuna")) return "Fish";
  if (t.includes("turkey")) return "Turkey";
  if (t.includes("lamb")) return "Lamb";
  if (t.includes("vegan")) return "Vegan";
  if (t.includes("vegetarian")) return "Vegetarian";
  return "";
}

function servingKind(serving = {}) {
  const text = fold(serving.serving_description || serving.measurement_description || "");
  if (num(serving.is_default) === 1) return "default";
  if (/\b100\s*g\b|\b100g\b|\b100\s*ml\b/.test(text)) return "reference";
  if (/\b1\s*(burger|sandwich|wrap|bottle|can|cup|piece|portion|serving|breast|fillet|slice|pack)\b/.test(text)) return "consumer";
  if (/\bsmall\b|\bmedium\b|\blarge\b|\btall\b|\bgrande\b|\bventi\b|\bshort\b/.test(text)) return "size";
  return "other";
}

function optionSummary(name, serving, foodType, isDefault) {
  const parts = [];
  const protein = detectProteinType(name);
  const format = detectFormat(`${name} ${serving}`);
  const size = detectSize(`${name} ${serving}`);
  if (size) parts.push(size);
  if (format !== "Item") parts.push(format);
  if (protein && !parts.includes(protein)) parts.push(protein);
  if (isDefault) parts.push("Recommended serving");
  if (String(foodType).toLowerCase() === "brand") parts.push("Branded food");
  return parts.join(" · ");
}

function normalizeServing(food, serving, region, index = 0) {
  const name = clean(food.food_name || food.name);
  const brand = clean(food.brand_name || food.brand);
  const foodId = clean(food.food_id || food.id);
  const servingText = clean(serving?.serving_description) ||
    [serving?.number_of_units, serving?.measurement_description].filter(Boolean).join(" ") ||
    clean(food.serving_description) || "1 serving";

  const calories = num(serving?.calories ?? food.calories);
  const protein = num(serving?.protein ?? food.protein);
  const carbs = num(serving?.carbohydrate ?? serving?.carbs ?? food.carbohydrate ?? food.carbs);
  const fat = num(serving?.fat ?? food.fat);
  if (!name || (calories <= 0 && protein <= 0 && carbs <= 0 && fat <= 0)) return null;

  const isDefault = num(serving?.is_default) === 1;
  const foodType = clean(food.food_type || "");
  const kind = servingKind(serving || {});

  return {
    id: stableId("fatsecret", foodId, serving?.serving_id || index, servingText),
    foodId,
    servingId: clean(serving?.serving_id || index),
    name,
    brand,
    serving: servingText,
    calories,
    protein,
    carbs,
    fat,
    source: "FatSecret verified database",
    confidence: 0.97,
    verified: true,
    optionSummary: optionSummary(name, servingText, foodType, isDefault),
    proteinType: detectProteinType(name),
    format: detectFormat(`${name} ${servingText}`),
    size: detectSize(`${name} ${servingText}`),
    region,
    foodType,
    isDefault,
    servingKind: kind,
    metricAmount: num(serving?.metric_serving_amount, 0),
    metricUnit: clean(serving?.metric_serving_unit)
  };
}

function normalizeFood(food, region) {
  if (!food) return [];
  const servings = asArray(food?.servings?.serving || food?.serving);
  if (!servings.length) {
    const one = normalizeServing(food, null, region, 0);
    return one ? [one] : [];
  }
  return servings.map((serving, index) => normalizeServing(food, serving, region, index)).filter(Boolean);
}

function normalizeSearchPayload(data, region) {
  const foods = asArray(data?.foods_search?.results?.food || data?.foods?.food || data?.food);
  return foods.flatMap(food => normalizeFood(food, region));
}

async function searchPathWithLocaleFallback(path, params, requestedRegion) {
  try {
    const data = await apiGet(path, params);
    return { data, effectiveRegion: requestedRegion, localized: true };
  } catch (error) {
    const status = error.response?.status;
    // Localization is a FatSecret premium capability. If the account cannot use it,
    // retry without locale instead of failing the whole food search. FatSecret then
    // defaults to its US/en dataset, and we label that honestly in the response.
    if ((status === 401 || status === 403) && (params.region || params.language)) {
      const retry = { ...params };
      delete retry.region;
      delete retry.language;
      try {
        const data = await apiGet(path, retry);
        return { data, effectiveRegion: "US", localized: false };
      } catch (retryError) {
        retryError.originalStatus = status;
        throw retryError;
      }
    }
    throw error;
  }
}

async function rawSearch(query, region, language, maxResults, foodType) {
  const common = {
    search_expression: query,
    max_results: Math.max(1, Math.min(num(maxResults, 30), 50)),
    page_number: 0,
    region,
    language,
    flag_default_serving: true
  };

  try {
    const response = await searchPathWithLocaleFallback(
      "foods/search/v5",
      { ...common, ...(foodType ? { food_type: foodType } : {}) },
      region
    );
    const results = normalizeSearchPayload(response.data, response.effectiveRegion);
    if (results.length) return results;
  } catch (error) {
    const status = error.response?.status || error.originalStatus;
    console.warn(`FatSecret foods/search/v5 unavailable${status ? ` (${status})` : ""}; trying v3.`);
  }

  try {
    const response = await searchPathWithLocaleFallback("foods/search/v3", common, region);
    const results = normalizeSearchPayload(response.data, response.effectiveRegion);
    if (results.length) return results;
  } catch (error) {
    const status = error.response?.status || error.originalStatus;
    console.warn(`FatSecret foods/search/v3 unavailable${status ? ` (${status})` : ""}; trying v1.`);
  }

  try {
    const response = await searchPathWithLocaleFallback("foods/search/v1", common, region);
    const foods = asArray(response.data?.foods?.food);
    const detailedGroups = await Promise.all(foods.slice(0, Math.min(common.max_results, 20)).map(async food => {
      if (!food?.food_id) return normalizeFood(food, response.effectiveRegion);
      try {
        const details = await getFoodById(food.food_id, response.effectiveRegion, language);
        return details.length ? details : normalizeFood(food, response.effectiveRegion);
      } catch {
        return normalizeFood(food, response.effectiveRegion);
      }
    }));
    return detailedGroups.flat();
  } catch (error) {
    console.error("FatSecret search failed:", error.message);
    return [];
  }
}

async function getFoodById(foodId, region, language) {
  for (const path of ["food/v5", "food/v3", "food/v1"]) {
    const params = { food_id: foodId, region, language, flag_default_serving: true };
    try {
      const response = await searchPathWithLocaleFallback(path, params, region);
      const normalized = normalizeFood(response.data?.food || response.data, response.effectiveRegion);
      if (normalized.length) return normalized;
    } catch (error) {
      const status = error.response?.status || error.originalStatus;
      if (status !== 401 && status !== 403) console.warn(`FatSecret ${path} detail failed:`, error.message);
    }
  }
  return [];
}

function brandMatches(resultBrand, intendedBrand) {
  if (!intendedBrand) return true;
  const rb = canonicalBrand(resultBrand);
  const ib = canonicalBrand(intendedBrand);
  if (!rb || !ib) return false;
  return rb === ib || rb.includes(ib) || ib.includes(rb);
}

function itemCoverage(result, intent) {
  if (!intent.itemTokens.length) return 1;
  const hayTokens = new Set(tokens(`${result.name} ${result.serving}`));
  const matched = intent.itemTokens.filter(t => hayTokens.has(t) || [...hayTokens].some(h => h.includes(t) || t.includes(h))).length;
  return matched / intent.itemTokens.length;
}

function scoreResult(result, queryOrIntent) {
  const intent = typeof queryOrIntent === "string" ? parseIntent(queryOrIntent) : queryOrIntent;
  const title = fold(`${result.brand || ""} ${result.name || ""}`);
  const serving = fold(result.serving || "");
  const resultBrand = canonicalBrand(result.brand || "");
  const intendedBrand = canonicalBrand(intent.brand || "");
  const coverage = itemCoverage(result, intent);
  let score = num(result.confidence, 0.7) * 100 + (result.verified ? 28 : 0);

  if (intendedBrand) {
    if (brandMatches(resultBrand, intendedBrand)) score += 140;
    else if (resultBrand) score -= 220;
    else score -= 90;
  }

  if (intent.itemTokens.length) {
    score += coverage * 120;
    if (coverage === 1) score += 55;
    if (coverage < 0.5) score -= 100;
  }

  if (title === intent.normalized) score += 90;
  if (title.includes(intent.itemText) && intent.itemText) score += 45;

  if (intent.size) {
    if (fold(result.size) === fold(intent.size) || serving.includes(fold(intent.size))) score += 45;
    else if (result.size) score -= 20;
  }

  if (intent.mealRequested) {
    if (result.format === "Meal") score += 55;
    else score -= 12;
  } else if (result.format === "Meal") {
    score -= 15;
  }

  if (result.isDefault) score += 28;
  if (result.servingKind === "consumer") score += 22;
  if (result.servingKind === "size") score += 20;
  if (result.servingKind === "reference") score -= 20;
  if (String(result.foodType).toLowerCase() === "brand" && intendedBrand) score += 18;
  if (String(result.region).toUpperCase() === String(result.region || "").toUpperCase()) score += 2;

  return score;
}

function nutritionLooksSane(item) {
  return nutritionAudit(item, { strict: true }).ok;
}

function canonicalFoodKey(item) {
  return `${canonicalBrand(item.brand)}|${fold(item.name)}`;
}

function servingDuplicateKey(item) {
  const kcal = Math.round(num(item.calories));
  const p = Math.round(num(item.protein));
  const c = Math.round(num(item.carbs));
  const f = Math.round(num(item.fat));
  const size = fold(item.size);
  const serving = fold(item.serving).replace(/\s+/g, " ");
  return `${canonicalFoodKey(item)}|${size}|${serving}|${kcal}|${p}|${c}|${f}`;
}

function servingLabelKind(item) {
  const text = fold(item.serving || "");
  if (!text || text === "serving" || /^1 serving$/.test(text) || /^1 portion$/.test(text)) return "vague";
  if (item.servingKind === "reference") return "reference";
  if (item.size || item.servingKind === "size") return "size";
  if (/\b(burger|sandwich|wrap|breast|fillet|piece|slice|bottle|can|cup|pack)\b/.test(text)) return "consumer";
  return item.servingKind || "other";
}

function clearlyDistinctServing(a, b) {
  const sizeA = fold(a.size || "");
  const sizeB = fold(b.size || "");
  if (sizeA && sizeB && sizeA !== sizeB) return true;

  const metricA = num(a.metricAmount, 0);
  const metricB = num(b.metricAmount, 0);
  const unitA = fold(a.metricUnit || "");
  const unitB = fold(b.metricUnit || "");
  if (metricA > 0 && metricB > 0 && unitA && unitA === unitB) {
    const ratio = Math.max(metricA, metricB) / Math.max(1, Math.min(metricA, metricB));
    if (ratio >= 1.25) return true;
  }

  const kindA = servingLabelKind(a);
  const kindB = servingLabelKind(b);
  if (kindA === "reference" || kindB === "reference") return true;
  return false;
}

function conflictingSameFoodServing(a, b) {
  if (clearlyDistinctServing(a, b)) return false;
  const kcalA = Math.max(1, num(a.calories));
  const kcalB = Math.max(1, num(b.calories));
  const ratio = Math.max(kcalA, kcalB) / Math.min(kcalA, kcalB);
  if (ratio < 1.35) return false;

  const kindA = servingLabelKind(a);
  const kindB = servingLabelKind(b);
  // Vague "1 serving" records must not compete with a concrete consumer serving when
  // their nutrition differs substantially. This generalises to restaurant/menu data
  // beyond any one chain.
  if (kindA === "vague" || kindB === "vague") return true;
  if (kindA === kindB) return true;
  if ([kindA, kindB].every(kind => ["consumer", "other", "default"].includes(kind))) return true;
  return false;
}

function chooseUsefulServings(group, intent, maxPerFood = 3) {
  const ranked = [...group]
    .filter(nutritionLooksSane)
    .sort((a, b) => scoreResult(b, intent) - scoreResult(a, intent));
  const selected = [];
  const seenNutrition = new Set();

  for (const item of ranked) {
    const macroKey = `${Math.round(item.calories)}|${Math.round(item.protein)}|${Math.round(item.carbs)}|${Math.round(item.fat)}|${fold(item.size)}`;
    if (seenNutrition.has(macroKey)) continue;

    if (item.servingKind === "reference" && selected.some(x => x.servingKind !== "reference") && !/\b\d+\s*g\b/.test(intent.normalized)) continue;
    if (selected.some(existing => conflictingSameFoodServing(existing, item))) continue;

    selected.push(item);
    seenNutrition.add(macroKey);
    if (selected.length >= maxPerFood) break;
  }
  return selected;
}

function rankAndDedupe(results, query, limit = 30, options = {}) {
  const intent = parseIntent(query);
  const minCoverage = intent.itemTokens.length >= 2 ? 0.5 : intent.itemTokens.length === 1 ? 1 : 0;
  const filtered = results.filter(item => item && item.name && nutritionLooksSane(item)).filter(item => {
    if (intent.brand && !brandMatches(item.brand, intent.brand)) return false;
    if (intent.itemTokens.length && itemCoverage(item, intent) < minCoverage) return false;
    return true;
  });

  const exactSeen = new Set();
  const deExact = filtered.filter(item => {
    const key = servingDuplicateKey(item);
    if (exactSeen.has(key)) return false;
    exactSeen.add(key);
    return true;
  });

  const groups = new Map();
  deExact.forEach(item => {
    const key = canonicalFoodKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  let compact = [];
  for (const group of groups.values()) {
    compact.push(...chooseUsefulServings(group, intent, options.maxServingsPerFood || 3));
  }

  compact.sort((a, b) => scoreResult(b, intent) - scoreResult(a, intent));
  return compact.slice(0, Math.max(1, Math.min(num(limit, 30), 50))).map(item => ({
    ...item,
    confidence: Math.max(0.5, Math.min(0.995, num(item.confidence, 0.9)))
  }));
}

function metricServingBase(item) {
  const amount = num(item.metricAmount, 0);
  const unit = fold(item.metricUnit || "");
  if (amount > 0) {
    if (["g", "gram", "grams"].includes(unit)) return { amount, kind: "g" };
    if (["kg", "kilogram", "kilograms"].includes(unit)) return { amount: amount * 1000, kind: "g" };
    if (["ml", "milliliter", "milliliters", "millilitre", "millilitres"].includes(unit)) return { amount, kind: "ml" };
    if (["l", "liter", "liters", "litre", "litres"].includes(unit)) return { amount: amount * 1000, kind: "ml" };
  }
  const serving = fold(item.serving || "");
  const grams = serving.match(/\b(\d+(?:\.\d+)?)\s*g\b/);
  if (grams) return { amount: num(grams[1]), kind: "g" };
  const ml = serving.match(/\b(\d+(?:\.\d+)?)\s*ml\b/);
  if (ml) return { amount: num(ml[1]), kind: "ml" };
  return null;
}

function scaledServingFromIntent(ranked, intent) {
  if (!ranked.length) return null;
  const requested = intent.requestedGrams > 0 ? { amount: intent.requestedGrams, kind: "g", label: `${Math.round(intent.requestedGrams)} g` }
    : intent.requestedMl > 0 ? { amount: intent.requestedMl, kind: "ml", label: `${Math.round(intent.requestedMl)} ml` }
      : null;

  if (requested) {
    const base = ranked.find(item => {
      const metric = metricServingBase(item);
      return metric && metric.kind === requested.kind && metric.amount > 0;
    });
    if (!base) return null;
    const metric = metricServingBase(base);
    const factor = requested.amount / metric.amount;
    if (!Number.isFinite(factor) || factor <= 0 || factor > 20) return null;
    const derived = {
      ...base,
      id: stableId(base.id, "requested", requested.label),
      serving: requested.label,
      calories: num(base.calories) * factor,
      protein: num(base.protein) * factor,
      carbs: num(base.carbs) * factor,
      fat: num(base.fat) * factor,
      optionSummary: `${requested.label} · scaled from verified serving`,
      source: `${base.source} · serving scaled`,
      isDefault: true,
      servingKind: "requested",
      metricAmount: requested.amount,
      metricUnit: requested.kind,
      derivedFromVerifiedServing: true
    };
    return nutritionLooksSane(derived) ? derived : null;
  }

  if (intent.quantity > 1) {
    const base = ranked.find(item => item.servingKind !== "reference") || ranked[0];
    const factor = intent.quantity;
    const derived = {
      ...base,
      id: stableId(base.id, "quantity", factor),
      serving: `${factor} × ${base.serving}`,
      calories: num(base.calories) * factor,
      protein: num(base.protein) * factor,
      carbs: num(base.carbs) * factor,
      fat: num(base.fat) * factor,
      optionSummary: `${factor} servings · scaled from verified serving`,
      source: `${base.source} · quantity scaled`,
      isDefault: true,
      servingKind: "requested",
      derivedFromVerifiedServing: true
    };
    return nutritionLooksSane(derived) ? derived : null;
  }

  return null;
}

async function searchFoods(query, region = "GB", language = "en", maxResults = 30) {
  if (!hasCredentials()) return [];
  const intent = parseIntent(query);
  const cacheKey = `${intent.normalized}|${region}|${language}|${maxResults}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.results.map(x => ({ ...x }));

  const requested = Math.max(12, Math.min(50, num(maxResults, 30)));
  const queryPlan = [];
  const pushPlan = (q, type) => {
    const key = `${fold(q)}|${type || "all"}`;
    if (q && !queryPlan.some(x => x.key === key)) queryPlan.push({ key, q, type });
  };

  pushPlan(intent.raw, intent.brand ? "brand" : undefined);
  if (intent.brand && intent.itemText) pushPlan(`${intent.brand} ${intent.itemText}`, "brand");
  if (!intent.brand) pushPlan(intent.raw, undefined);

  const groups = await Promise.all(queryPlan.map(plan => rawSearch(plan.q, region, language, requested, plan.type)));
  let combined = groups.flat();

  // If v5 brand filtering was unavailable, enforce brand intent locally.
  if (intent.brand) combined = combined.filter(item => brandMatches(item.brand, intent.brand));

  // First strict pass for the requested item.
  let ranked = rankAndDedupe(combined, query, requested, { maxServingsPerFood: 3 });

  const requestedServing = scaledServingFromIntent(ranked, intent);
  if (requestedServing) {
    ranked = [requestedServing, ...ranked.filter(item => item.id !== requestedServing.id)];
  }

  ranked = ranked.slice(0, requested);
  searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_TTL_MS, results: ranked });
  if (searchCache.size > 250) {
    const oldestKey = searchCache.keys().next().value;
    searchCache.delete(oldestKey);
  }
  return ranked.map(x => ({ ...x }));
}

function clearSearchCache() {
  searchCache.clear();
}

module.exports = {
  hasCredentials,
  searchFoods,
  rankAndDedupe,
  scoreResult,
  parseIntent,
  canonicalBrand,
  brandMatches,
  normalizeSearchPayload,
  nutritionLooksSane,
  servingLabelKind,
  clearlyDistinctServing,
  conflictingSameFoodServing,
  metricServingBase,
  scaledServingFromIntent,
  clearSearchCache
};
