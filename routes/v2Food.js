const express = require("express");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");

const verifyFirebaseToken = require("../authMiddleware");
const {
  searchFoods,
  rankAndDedupe,
  scoreResult,
  parseIntent,
  brandMatches,
  hasCredentials
} = require("../services/fatSecretService");
const { searchUSDA } = require("../services/usdaService");
const { searchOpenFoodFacts } = require("../services/openFoodFactsService");
const { calculateMealNutrition } = require("../services/nutritionCalculator");
const { validateMeal } = require("../services/validationEngine");
const { applyConfidenceScores } = require("../services/confidenceEngine");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const searchLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: "Too many food searches. Please try again later." } });
const analyzeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: "Too many AI scans. Please try again later." } });

function clean(value) { return String(value ?? "").trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function simpleId(...parts) {
  let hash = 2166136261;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}

function fallbackResult(name, nutrition, source, region) {
  if (!nutrition) return null;
  return {
    id: simpleId(source, name), name, brand: "", serving: "100g",
    calories: num(nutrition.calories), protein: num(nutrition.protein), carbs: num(nutrition.carbs), fat: num(nutrition.fat),
    source, confidence: source === "USDA" ? 0.86 : 0.72, verified: source === "USDA",
    optionSummary: source === "USDA" ? "Generic food" : "Packaged food", proteinType: "", format: "Item", size: "", region
  };
}

async function searchFallbacks(query, region) {
  const [usda, off] = await Promise.all([searchUSDA(query), searchOpenFoodFacts(query)]);
  return [fallbackResult(query, usda, "USDA", region), fallbackResult(query, off, "Open Food Facts", region)].filter(Boolean);
}

router.post("/search", verifyFirebaseToken, searchLimiter, async (req, res) => {
  try {
    const query = clean(req.body?.query);
    if (query.length < 2) return res.status(400).json({ error: "query_required" });

    const region = clean(req.body?.region).toUpperCase() || "GB";
    const language = clean(req.body?.language).toLowerCase() || "en";
    const limit = Math.max(8, Math.min(num(req.body?.limit, 30), 50));
    const intent = parseIntent(query);

    let results = hasCredentials() ? await searchFoods(query, region, language, limit) : [];

    // Never pollute an explicit restaurant search with USDA/OFF or a different brand.
    if (!intent.isRestaurantIntent && results.length < 8) {
      results.push(...await searchFallbacks(query, region));
    }

    // searchFoods already performs a strict exact-item pass and, for restaurant queries,
    // adds only same-brand related menu items to keep the V2 result set large enough that
    // the iOS client does not mix in weaker legacy/Open Food Facts fallbacks.
    const ranked = intent.isRestaurantIntent ? results.slice(0, limit) : rankAndDedupe(results, query, limit);
    res.json({
      query,
      region,
      intent: { brand: intent.brand || null, size: intent.size || null, mealRequested: intent.mealRequested },
      results: ranked,
      databaseConnected: hasCredentials(),
      quality: {
        exactBrandProtected: Boolean(intent.brand),
        resultCount: ranked.length,
        verifiedCount: ranked.filter(x => x.verified).length
      }
    });
  } catch (error) {
    console.error("TRACK /v2/food/search error:", error);
    res.status(500).json({ error: "food_search_failed" });
  }
});

const detectionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    detectedBrand: { type: ["string", "null"] },
    isRestaurantFood: { type: "boolean" },
    mealName: { type: "string" },
    items: {
      type: "array", minItems: 1, maxItems: 10,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          name: { type: "string" }, quantity: { type: "number" }, size: { type: ["string", "null"] },
          searchQuery: { type: "string" }, estimatedServing: { type: ["string", "null"] }, estimatedGrams: { type: "number" },
          visualConfidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["name", "quantity", "size", "searchQuery", "estimatedServing", "estimatedGrams", "visualConfidence"]
      }
    },
    labelNutrition: {
      type: ["object", "null"], additionalProperties: false,
      properties: { serving: { type: "string" }, calories: { type: "number" }, protein: { type: "number" }, carbs: { type: "number" }, fat: { type: "number" } },
      required: ["serving", "calories", "protein", "carbs", "fat"]
    }
  },
  required: ["detectedBrand", "isRestaurantFood", "mealName", "items", "labelNutrition"]
};

async function identifyImage(image, task, region) {
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const taskInstructions = task === "nutrition_label"
    ? "Read the nutrition label and product branding carefully. Capture calories, protein, carbohydrate and fat for the clearly stated serving when legible. Never invent unreadable values. Also create a precise product search query."
    : "Identify every visible food and drink separately. Use logos, wrappers, cups, boxes, menu typography and restaurant presentation as brand evidence. For branded food, include the brand in each searchQuery. Capture visible size words exactly. Estimate quantity and edible grams, but NEVER invent nutrition values.";

  const response = await openai.responses.create({
    model,
    input: [{ role: "user", content: [
      { type: "input_text", text: `You are TRACK's recognition layer. ${taskInstructions} User region: ${region}. If brand evidence is uncertain, set detectedBrand to null rather than guessing. Return only the requested structured result.` },
      { type: "input_image", image_url: image, detail: "high" }
    ] }],
    text: { format: { type: "json_schema", name: "track_food_detection", strict: true, schema: detectionSchema } }
  });
  return JSON.parse(response.output_text);
}

function chooseBestMatch(results, item, detectedBrand) {
  if (!results.length) return null;
  const query = clean(item.searchQuery) || `${detectedBrand || ""} ${item.name}`;
  const intent = parseIntent(query);
  if (!intent.brand && detectedBrand) intent.brand = detectedBrand;

  const candidates = results.filter(result => !intent.brand || brandMatches(result.brand, intent.brand));
  if (!candidates.length) return null;

  const scored = candidates.map(result => ({ result, score: scoreResult(result, intent) + (item.size && String(result.size).toLowerCase() === String(item.size).toLowerCase() ? 35 : 0) }))
    .sort((a, b) => b.score - a.score);

  // Reject weak fuzzy matches rather than attaching verified nutrition to the wrong food.
  if (scored[0].score < 145) return null;
  return scored[0].result;
}

async function fallbackForItem(item, detection) {
  const synthetic = {
    name: item.name,
    serving: item.estimatedServing || "Detected portion",
    restaurantHint: detection.detectedBrand || "",
    confidence: num(item.visualConfidence, 0.5) >= 0.8 ? "high" : "medium",
    notes: "Fallback for an image component without a sufficiently strong verified database match.",
    components: [{ name: item.name, estimatedGrams: Math.max(1, num(item.estimatedGrams, 100)), confidence: num(item.visualConfidence, 0.5) >= 0.8 ? "high" : "medium" }]
  };
  const meal = applyConfidenceScores(validateMeal(await calculateMealNutrition(synthetic)));
  return {
    id: simpleId("fallback", item.name, item.estimatedGrams), name: item.name,
    brand: detection.detectedBrand || "", serving: item.estimatedServing || `${Math.max(1, num(item.estimatedGrams, 100))} g`,
    calories: num(meal.calories), protein: num(meal.protein), carbs: num(meal.carbs), fat: num(meal.fat),
    source: "TRACK fallback nutrition engine", confidence: Math.min(0.78, num(meal.confidenceScore, 60) / 100), verified: false,
    optionSummary: "Estimated portion", proteinType: "", format: "Item", size: item.size || ""
  };
}

async function groundedGroups(detection, region, language) {
  return Promise.all((detection.items || []).map(async item => {
    const brandPrefix = detection.detectedBrand ? `${detection.detectedBrand} ` : "";
    const query = clean(item.searchQuery) || `${brandPrefix}${item.name}`;
    const results = hasCredentials() ? await searchFoods(query, region, language, 20) : [];
    const ranked = rankAndDedupe(results, query, 10);
    const match = chooseBestMatch(ranked, item, detection.detectedBrand);
    return { item, query, match, fallback: match ? null : await fallbackForItem(item, detection), alternatives: ranked.slice(0, 5) };
  }));
}

function scaleResolved(resolved, item) {
  const quantity = Math.max(0.25, Math.min(num(item.quantity, 1), 20));
  return {
    calories: num(resolved.calories) * quantity, protein: num(resolved.protein) * quantity,
    carbs: num(resolved.carbs) * quantity, fat: num(resolved.fat) * quantity, quantity
  };
}

function makeCompositeResult(detection, groups) {
  let calories = 0, protein = 0, carbs = 0, fat = 0, confidence = 1;
  const names = [], components = [];

  groups.forEach(group => {
    const resolved = group.match || group.fallback;
    if (!resolved) return;
    const scaled = scaleResolved(resolved, group.item);
    calories += scaled.calories; protein += scaled.protein; carbs += scaled.carbs; fat += scaled.fat;
    confidence = Math.min(confidence, num(group.item.visualConfidence, 0.5), num(resolved.confidence, 0.65));
    names.push(scaled.quantity === 1 ? resolved.name : `${scaled.quantity}× ${resolved.name}`);
    components.push({ name: resolved.name, serving: resolved.serving, source: resolved.source, verified: Boolean(resolved.verified), confidence: num(resolved.confidence, 0.65) });
  });

  return {
    name: clean(detection.mealName) || names.join(" + ") || "Detected meal", serving: "Detected meal",
    calories: Math.round(calories), protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat),
    source: components.every(x => x.verified) ? "Vision matched to verified foods" : "Vision grounded with verified + fallback nutrition",
    confidence: Math.min(0.97, confidence), verified: components.length > 0 && components.every(x => x.verified),
    detectedBrand: detection.detectedBrand || null, components
  };
}

function labelResult(detection) {
  const label = detection.labelNutrition;
  if (!label) return null;
  const total = num(label.calories) + num(label.protein) + num(label.carbs) + num(label.fat);
  if (total <= 0) return null;
  return {
    name: clean(detection.mealName) || clean(detection.items?.[0]?.name) || "Nutrition label",
    serving: clean(label.serving) || "Label serving", calories: Math.round(num(label.calories)), protein: Math.round(num(label.protein)),
    carbs: Math.round(num(label.carbs)), fat: Math.round(num(label.fat)), source: "Nutrition label read from image",
    confidence: 0.9, verified: false, detectedBrand: detection.detectedBrand || null
  };
}

router.post("/analyze", verifyFirebaseToken, analyzeLimiter, async (req, res) => {
  try {
    const image = clean(req.body?.image);
    if (!image.startsWith("data:image/")) return res.status(400).json({ error: "image_required" });

    const task = clean(req.body?.task) || "meal";
    const region = clean(req.body?.region).toUpperCase() || "GB";
    const language = clean(req.body?.language).toLowerCase() || "en";
    const candidateLimit = Math.max(0, Math.min(num(req.body?.returnCandidates, 5), 10));
    const detection = await identifyImage(image, task, region);

    // A legible nutrition label is the primary source for the label task.
    let result = task === "nutrition_label" ? labelResult(detection) : null;
    let groups = [];

    if (!result) {
      groups = await groundedGroups(detection, region, language);
      const resolvedGroups = groups.filter(group => group.match || group.fallback);
      if (resolvedGroups.length === 1 && num(resolvedGroups[0].item.quantity, 1) <= 1) {
        const resolved = resolvedGroups[0].match || resolvedGroups[0].fallback;
        result = { ...resolved, detectedBrand: detection.detectedBrand || resolved.brand || null,
          confidence: Math.min(0.99, Math.min(num(resolved.confidence, 0.75), num(resolvedGroups[0].item.visualConfidence, 0.5) + 0.1)) };
      } else if (resolvedGroups.length > 0) {
        result = makeCompositeResult(detection, resolvedGroups);
      }
    }

    if (!result) return res.status(422).json({ error: "food_not_confidently_identified", detected: detection });

    const debugCandidates = rankAndDedupe(groups.flatMap(group => group.alternatives || []), detection.mealName || detection.items?.[0]?.searchQuery || "food", candidateLimit);
    // The current iOS client sorts `result` together with `candidates`. Returning alternatives
    // here could make one component outrank the complete detected meal. Keep the client-facing
    // candidate array empty and expose alternatives separately for backend diagnostics.
    res.json({ result, candidates: [], debugCandidates, detected: detection, databaseConnected: hasCredentials() });
  } catch (error) {
    console.error("TRACK /v2/food/analyze error:", error);
    res.status(500).json({ error: "food_analysis_failed", details: error.message });
  }
});

module.exports = router;
