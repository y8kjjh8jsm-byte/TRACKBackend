const axios = require("axios");

let tokenCache = { token: null, expiresAt: 0 };

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

function hasCredentials() {
  return Boolean(process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET);
}

async function getAccessToken() {
  if (!hasCredentials()) return null;

  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const basic = Buffer.from(
    `${process.env.FATSECRET_CLIENT_ID}:${process.env.FATSECRET_CLIENT_SECRET}`
  ).toString("base64");

  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const scope = clean(process.env.FATSECRET_SCOPE);
  if (scope) body.set("scope", scope);

  const response = await axios.post(
    "https://oauth.fatsecret.com/connect/token",
    body.toString(),
    {
      timeout: 10_000,
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  const token = response.data?.access_token;
  if (!token) throw new Error("FatSecret token response did not include access_token");

  const expiresIn = Math.max(120, num(response.data?.expires_in, 3600));
  tokenCache = {
    token,
    expiresAt: now + (expiresIn - 60) * 1000
  };

  return token;
}

async function apiGet(path, params = {}) {
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
  const t = text.toLowerCase();
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
  const t = text.toLowerCase();
  if (/\bmeal\b|\bcombo\b|\bmeal deal\b|\bwith fries\b|\bwith chips\b/.test(t)) {
    return "Meal";
  }
  if (/\bdrink\b|\blatte\b|\bcoffee\b|\bmocha\b|\bcappuccino\b|\btea\b|\bcola\b/.test(t)) {
    return "Drink";
  }
  return "Item";
}

function detectProteinType(text = "") {
  const t = text.toLowerCase();
  if (t.includes("chicken")) return "Chicken";
  if (t.includes("beef")) return "Beef";
  if (t.includes("steak")) return "Beef";
  if (t.includes("fish") || t.includes("salmon") || t.includes("tuna")) return "Fish";
  if (t.includes("turkey")) return "Turkey";
  if (t.includes("lamb")) return "Lamb";
  if (t.includes("vegan")) return "Vegan";
  if (t.includes("vegetarian")) return "Vegetarian";
  return "";
}

function optionSummary(name, serving) {
  return [
    detectProteinType(name),
    detectFormat(`${name} ${serving}`),
    detectSize(`${name} ${serving}`)
  ].filter(Boolean).join(" · ");
}

function normalizeServing(food, serving, region, index = 0) {
  const name = clean(food.food_name || food.name);
  const brand = clean(food.brand_name || food.brand);
  const foodId = clean(food.food_id || food.id);
  const servingText = clean(serving?.serving_description) ||
    [serving?.number_of_units, serving?.measurement_description].filter(Boolean).join(" ") ||
    clean(food.serving_description) ||
    "1 serving";

  const calories = num(serving?.calories ?? food.calories);
  const protein = num(serving?.protein ?? food.protein);
  const carbs = num(serving?.carbohydrate ?? serving?.carbs ?? food.carbohydrate ?? food.carbs);
  const fat = num(serving?.fat ?? food.fat);

  if (!name || (calories <= 0 && protein <= 0 && carbs <= 0 && fat <= 0)) return null;

  return {
    id: stableId("fatsecret", foodId, serving?.serving_id || index, servingText),
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
    optionSummary: optionSummary(name, servingText),
    proteinType: detectProteinType(name),
    format: detectFormat(`${name} ${servingText}`),
    size: detectSize(`${name} ${servingText}`),
    region
  };
}

function normalizeFood(food, region) {
  if (!food) return [];
  const servings = asArray(food?.servings?.serving || food?.serving);
  if (!servings.length) {
    const one = normalizeServing(food, null, region, 0);
    return one ? [one] : [];
  }

  return servings
    .map((serving, index) => normalizeServing(food, serving, region, index))
    .filter(Boolean);
}

function normalizeSearchPayload(data, region) {
  const foods = asArray(data?.foods?.food || data?.foods_search?.results?.food || data?.food);
  return foods.flatMap(food => normalizeFood(food, region));
}

async function getFoodById(foodId, region, language) {
  const attempts = ["food/v5", "food/v4", "food/v3"];
  let lastError = null;

  for (const path of attempts) {
    try {
      const data = await apiGet(path, {
        food_id: foodId,
        region,
        language,
        flag_default_serving: true
      });
      const food = data?.food || data;
      const normalized = normalizeFood(food, region);
      if (normalized.length) return normalized;
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      if (status === 401 || status === 403) continue;
    }
  }

  if (lastError && !lastError.response) throw lastError;
  return [];
}

async function searchFoods(query, region = "GB", language = "en", maxResults = 30) {
  if (!hasCredentials()) return [];

  const bounded = Math.max(1, Math.min(num(maxResults, 30), 50));
  const common = {
    search_expression: query,
    max_results: bounded,
    page_number: 0,
    region,
    language,
    flag_default_serving: true
  };

  const richPaths = ["foods/search/v5", "foods/search/v3"];
  for (const path of richPaths) {
    try {
      const data = await apiGet(path, common);
      const results = normalizeSearchPayload(data, region);
      if (results.length) return results;
    } catch (error) {
      const status = error.response?.status;
      console.warn(`FatSecret ${path} unavailable${status ? ` (${status})` : ""}; trying fallback.`);
    }
  }

  try {
    const data = await apiGet("foods/search/v1", common);
    const foods = asArray(data?.foods?.food);
    const detailedGroups = await Promise.all(
      foods.slice(0, Math.min(bounded, 20)).map(async food => {
        if (!food?.food_id) return normalizeFood(food, region);
        try {
          const details = await getFoodById(food.food_id, region, language);
          return details.length ? details : normalizeFood(food, region);
        } catch {
          return normalizeFood(food, region);
        }
      })
    );
    return detailedGroups.flat();
  } catch (error) {
    console.error("FatSecret search failed:", error.message);
    return [];
  }
}

function textScore(result, query) {
  const q = clean(query).toLowerCase();
  const tokens = q.split(/\s+/).filter(token => token.length > 1);
  const hay = `${result.brand || ""} ${result.name || ""} ${result.serving || ""} ${result.optionSummary || ""}`.toLowerCase();

  let score = (num(result.confidence, 0.7) * 100) + (result.verified ? 25 : 0);
  if (hay === q) score += 80;
  if (hay.startsWith(q)) score += 45;
  if (hay.includes(q)) score += 30;

  tokens.forEach(token => {
    if (hay.includes(token)) score += 8;
  });

  const requestedSize = detectSize(q).toLowerCase();
  if (requestedSize && result.size?.toLowerCase() === requestedSize) score += 25;

  if (/\bmeal\b|\bcombo\b/.test(q) && result.format === "Meal") score += 25;
  if (!/\bmeal\b|\bcombo\b/.test(q) && result.format === "Item") score += 4;

  return score;
}

function rankAndDedupe(results, query, limit = 30) {
  const seen = new Set();
  return results
    .filter(item => item && item.name)
    .filter(item => {
      const key = `${item.brand}|${item.name}|${item.serving}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => textScore(b, query) - textScore(a, query))
    .slice(0, limit);
}

module.exports = {
  hasCredentials,
  searchFoods,
  rankAndDedupe,
  textScore
};
