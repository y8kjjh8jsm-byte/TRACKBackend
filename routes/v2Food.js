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
  hasCredentials,
  nutritionLooksSane
} = require("../services/fatSecretService");
const { searchUSDA } = require("../services/usdaService");
const { searchOpenFoodFacts } = require("../services/openFoodFactsService");
const { calculateMealNutrition } = require("../services/nutritionCalculator");
const { validateMeal } = require("../services/validationEngine");
const { applyConfidenceScores } = require("../services/confidenceEngine");
const {
  sanitizeVisualPortion,
  resolveVisualNutrition,
  reconcileEstimatedNutrition,
  mealPlausibility,
  nutritionAudit
} = require("../services/nutritionQualityService");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "missing-openai-key" });

const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many food searches. Please try again later." }
});
const analyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI scans. Please try again later." }
});

function clean(value) { return String(value ?? "").trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function simpleId(...parts) {
  let hash = 2166136261;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}
function safeText(value, max = 120) { return clean(value).replace(/[\r\n\t]+/g, " ").slice(0, max); }

function fallbackResult(name, nutrition, source, region) {
  if (!nutrition) return null;
  const candidate = {
    id: simpleId(source, name), name, brand: "", serving: "100g",
    calories: num(nutrition.calories), protein: num(nutrition.protein), carbs: num(nutrition.carbs), fat: num(nutrition.fat),
    source, confidence: source === "USDA" ? 0.86 : 0.72, verified: source === "USDA",
    optionSummary: source === "USDA" ? "Generic food" : "Packaged food", proteinType: "", format: "Item", size: "", region,
    foodType: source === "USDA" ? "Generic" : "Brand", servingKind: "reference"
  };
  return nutritionLooksSane(candidate) ? candidate : null;
}

async function searchFallbacks(query, region) {
  const [usda, off] = await Promise.allSettled([searchUSDA(query), searchOpenFoodFacts(query)]);
  const rows = [];
  if (usda.status === "fulfilled") rows.push(fallbackResult(query, usda.value, "USDA", region));
  if (off.status === "fulfilled") rows.push(fallbackResult(query, off.value, "Open Food Facts", region));
  return rows.filter(Boolean);
}

router.post("/search", verifyFirebaseToken, searchLimiter, async (req, res) => {
  try {
    const query = clean(req.body?.query);
    if (query.length < 2) return res.status(400).json({ error: "query_required" });

    const region = clean(req.body?.region).toUpperCase() || "GB";
    const language = clean(req.body?.language).toLowerCase() || "en";
    const limit = Math.max(1, Math.min(num(req.body?.limit, 30), 50));
    const intent = parseIntent(query);

    let results = hasCredentials() ? await searchFoods(query, region, language, limit) : [];
    let fallbackUsed = false;

    // V2/FatSecret is authoritative. Fallbacks are failure-only, never list-fillers.
    // Explicit restaurant searches are never sent to generic/packaged fallback sources.
    if (results.length === 0 && !intent.isRestaurantIntent) {
      results = await searchFallbacks(query, region);
      fallbackUsed = results.length > 0;
    }

    const ranked = rankAndDedupe(results, query, limit, { maxServingsPerFood: 3 });

    console.info("TRACK food search", {
      query: safeText(query), region, brand: intent.brand || null,
      results: ranked.length, fallbackUsed,
      top: ranked.slice(0, 3).map(item => ({ name: safeText(item.name, 60), brand: safeText(item.brand, 40), serving: safeText(item.serving, 50), source: safeText(item.source, 50) }))
    });

    res.json({
      query,
      region,
      intent: { brand: intent.brand || null, size: intent.size || null, mealRequested: intent.mealRequested },
      results: ranked,
      databaseConnected: hasCredentials(),
      quality: {
        exactBrandProtected: Boolean(intent.brand),
        fallbackUsed,
        resultCount: ranked.length,
        verifiedCount: ranked.filter(x => x.verified).length
      }
    });
  } catch (error) {
    console.error("TRACK /v2/food/search error:", error?.message || error);
    res.status(500).json({ error: "food_search_failed" });
  }
});

const detectionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    detectedBrand: { type: ["string", "null"] },
    brandConfidence: { type: "number", minimum: 0, maximum: 1 },
    isRestaurantFood: { type: "boolean" },
    mealName: { type: "string" },
    items: {
      type: "array", minItems: 1, maxItems: 12,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          size: { type: ["string", "null"] },
          searchQuery: { type: "string" },
          estimatedServing: { type: ["string", "null"] },
          estimatedGrams: { type: "number" },
          estimatedGramsLow: { type: "number" },
          estimatedGramsHigh: { type: "number" },
          visualConfidence: { type: "number", minimum: 0, maximum: 1 },
          portionConfidence: { type: "number", minimum: 0, maximum: 1 },
          preparation: { type: "string" }
        },
        required: [
          "name", "quantity", "size", "searchQuery", "estimatedServing", "estimatedGrams",
          "estimatedGramsLow", "estimatedGramsHigh", "visualConfidence", "portionConfidence", "preparation"
        ]
      }
    },
    labelNutrition: {
      type: ["object", "null"], additionalProperties: false,
      properties: {
        serving: { type: "string" }, calories: { type: "number" }, protein: { type: "number" },
        carbs: { type: "number" }, fat: { type: "number" }, confidence: { type: "number", minimum: 0, maximum: 1 }
      },
      required: ["serving", "calories", "protein", "carbs", "fat", "confidence"]
    }
  },
  required: ["detectedBrand", "brandConfidence", "isRestaurantFood", "mealName", "items", "labelNutrition"]
};

async function identifyImage(image, task, region) {
  if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error("OpenAI is not configured"), { code: "openai_unavailable" });
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const taskInstructions = task === "nutrition_label"
    ? `Read the nutrition label and product branding carefully. Use only values that are actually legible for one clearly stated serving. Never infer missing digits or nutrition. Set labelNutrition to null if the table cannot be read reliably. Create a precise product search query as a secondary aid.`
    : `Identify EVERY visible edible component separately, but do not double-count toppings/sauces that are already inherent in a named composite food. Estimate TOTAL visible edible grams for each component across all visible pieces, not grams per piece. Give a realistic low/high gram range. Use plate, utensils, packaging, piece count and familiar food dimensions as scale cues. Record preparation (grilled, fried, skin-on, cheese-topped, visible sauce, etc.). Do not add hidden oil, butter, sauce or cheese merely because it is possible; only account for it when visually supported. Never invent nutrition values.`;

  const response = await openai.responses.create({
    model,
    input: [{ role: "user", content: [
      { type: "input_text", text: `You are TRACK's food recognition and portion-estimation layer. ${taskInstructions} User region: ${region}. A restaurant brand may be returned only when a logo, branded packaging, highly distinctive branded item, or other strong visual evidence supports it. If uncertain, detectedBrand MUST be null and brandConfidence low. Do not use nutrition knowledge to inflate a portion estimate. Return only the requested structured result.` },
      { type: "input_image", image_url: image, detail: "high" }
    ] }],
    text: { format: { type: "json_schema", name: "track_food_detection", strict: true, schema: detectionSchema } }
  });
  return JSON.parse(response.output_text);
}

function sanitizeDetection(raw) {
  const detection = { ...raw };
  const brandConfidence = Math.max(0, Math.min(1, num(detection.brandConfidence, 0)));
  if (brandConfidence < 0.78) detection.detectedBrand = null;
  detection.brandConfidence = brandConfidence;
  detection.items = (Array.isArray(detection.items) ? detection.items : []).map(item => {
    const portion = sanitizeVisualPortion(item);
    return {
      ...item,
      quantity: Math.max(0.25, Math.min(num(item.quantity, 1), 20)),
      estimatedGrams: Math.round(portion.grams),
      estimatedGramsLow: Math.round(portion.low),
      estimatedGramsHigh: Math.round(portion.high),
      visualConfidence: Math.max(0, Math.min(1, num(item.visualConfidence, 0.5))),
      portionConfidence: Math.max(0, Math.min(1, num(item.portionConfidence, 0.5))),
      _portionWasClamped: portion.wasClamped
    };
  });
  return detection;
}

function chooseBestMatch(results, item, detectedBrand) {
  if (!results.length) return null;
  const query = clean(item.searchQuery) || `${detectedBrand || ""} ${item.name}`;
  const intent = parseIntent(query);
  if (!intent.brand && detectedBrand) intent.brand = detectedBrand;

  const candidates = results
    .filter(nutritionLooksSane)
    .filter(result => !intent.brand || brandMatches(result.brand, intent.brand));
  if (!candidates.length) return null;

  const scored = candidates.map(result => ({
    result,
    score: scoreResult(result, intent) + (item.size && String(result.size).toLowerCase() === String(item.size).toLowerCase() ? 35 : 0)
  })).sort((a, b) => b.score - a.score);

  if (scored[0].score < 145) return null;
  return scored[0].result;
}

async function fallbackForItem(item, detection) {
  const portion = sanitizeVisualPortion(item);
  const synthetic = {
    name: item.name,
    serving: item.estimatedServing || "Detected portion",
    restaurantHint: detection.detectedBrand || "",
    confidence: num(item.visualConfidence, 0.5) >= 0.8 ? "high" : "medium",
    notes: "Image component estimate used only because no sufficiently strong verified database match was available.",
    components: [{
      name: `${item.name}${item.preparation ? ` ${item.preparation}` : ""}`,
      estimatedGrams: Math.round(portion.grams),
      confidence: num(item.visualConfidence, 0.5) >= 0.8 ? "high" : "medium"
    }]
  };
  const meal = applyConfidenceScores(validateMeal(await calculateMealNutrition(synthetic)));
  const candidate = {
    id: simpleId("fallback", item.name, portion.grams), name: item.name,
    brand: detection.detectedBrand || "", serving: item.estimatedServing || `${Math.round(portion.grams)} g`,
    calories: num(meal.calories), protein: num(meal.protein), carbs: num(meal.carbs), fat: num(meal.fat),
    source: "TRACK estimated nutrition", confidence: Math.min(0.76, num(meal.confidenceScore, 60) / 100, num(item.portionConfidence, 0.5) + 0.15),
    verified: false, optionSummary: "Estimated visible portion", proteinType: "", format: "Item", size: item.size || "",
    portionAlreadyApplied: true,
    estimatedGrams: Math.round(portion.grams), estimatedGramsLow: Math.round(portion.low), estimatedGramsHigh: Math.round(portion.high)
  };
  const reconciled = reconcileEstimatedNutrition(candidate);
  return reconciled.rejected ? null : reconciled;
}

async function groundedGroups(detection, region, language) {
  return Promise.all((detection.items || []).map(async item => {
    const brandPrefix = detection.detectedBrand ? `${detection.detectedBrand} ` : "";
    const query = clean(item.searchQuery) || `${brandPrefix}${item.name}`;
    const results = hasCredentials() ? await searchFoods(query, region, language, 20) : [];
    const ranked = rankAndDedupe(results, query, 10);
    const match = chooseBestMatch(ranked, item, detection.detectedBrand);
    const fallback = match ? null : await fallbackForItem(item, detection);
    return { item, query, match, fallback, alternatives: ranked.slice(0, 5) };
  }));
}

function scaleResolved(resolved, item) {
  if (resolved.portionAlreadyApplied) {
    const audit = nutritionAudit(resolved, { strict: true });
    return {
      calories: num(resolved.calories), protein: num(resolved.protein), carbs: num(resolved.carbs), fat: num(resolved.fat),
      quantity: Math.max(0.25, Math.min(num(item.quantity, 1), 20)), factor: 1,
      portion: sanitizeVisualPortion(item), scalingBasis: "estimated_portion_already_applied", audit
    };
  }
  return resolveVisualNutrition(resolved, item);
}

function makeCompositeResult(detection, groups) {
  let calories = 0, protein = 0, carbs = 0, fat = 0, confidence = 1;
  const names = [], components = [];

  for (const group of groups) {
    const resolved = group.match || group.fallback;
    if (!resolved) continue;
    const scaled = scaleResolved(resolved, group.item);
    if (!scaled.audit?.ok) continue;

    calories += scaled.calories; protein += scaled.protein; carbs += scaled.carbs; fat += scaled.fat;
    confidence = Math.min(
      confidence,
      num(group.item.visualConfidence, 0.5),
      num(group.item.portionConfidence, 0.5) + 0.12,
      num(resolved.confidence, 0.65)
    );
    names.push(group.item.quantity === 1 ? resolved.name : `${group.item.quantity}× ${resolved.name}`);
    components.push({
      name: resolved.name,
      serving: resolved.serving,
      source: resolved.source,
      verified: Boolean(resolved.verified),
      confidence: num(resolved.confidence, 0.65),
      estimatedGrams: Math.round(scaled.portion?.grams || num(group.item.estimatedGrams, 0)),
      estimatedGramsLow: Math.round(scaled.portion?.low || num(group.item.estimatedGramsLow, 0)),
      estimatedGramsHigh: Math.round(scaled.portion?.high || num(group.item.estimatedGramsHigh, 0)),
      scalingBasis: scaled.scalingBasis,
      preparation: clean(group.item.preparation)
    });
  }

  if (!components.length) return null;
  let result = {
    name: clean(detection.mealName) || names.join(" + ") || "Detected meal",
    serving: "Detected meal",
    calories: Math.round(calories), protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat),
    source: components.every(x => x.verified) ? "Vision matched to verified foods" : "Vision grounded with verified + estimated nutrition",
    confidence: Math.min(0.97, confidence),
    verified: components.length > 0 && components.every(x => x.verified),
    detectedBrand: detection.detectedBrand || null,
    components
  };

  if (!result.verified) result = reconcileEstimatedNutrition(result);
  if (result.rejected) return null;

  const plausibility = mealPlausibility(result, detection.items || []);
  result.plausibility = plausibility;
  result.portionUncertainty = components.map(component => ({
    name: component.name,
    lowGrams: component.estimatedGramsLow,
    highGrams: component.estimatedGramsHigh
  }));
  if (!plausibility.ok) return null;
  return result;
}

function labelResult(detection) {
  const label = detection.labelNutrition;
  if (!label || num(label.confidence, 0) < 0.72) return null;
  const candidate = {
    name: clean(detection.mealName) || clean(detection.items?.[0]?.name) || "Nutrition label",
    serving: clean(label.serving) || "Label serving",
    calories: Math.round(num(label.calories)), protein: Math.round(num(label.protein)),
    carbs: Math.round(num(label.carbs)), fat: Math.round(num(label.fat)),
    source: "Nutrition label read from image", confidence: Math.min(0.98, num(label.confidence, 0.9)),
    verified: false, detectedBrand: detection.detectedBrand || null
  };
  const audit = nutritionAudit(candidate, { strict: false });
  // A modest mismatch can be legitimate label rounding/fibre; a severe mismatch means the
  // OCR/vision read is not trustworthy enough to auto-fill.
  if (!audit.ok && audit.reasons.includes("macro_calorie_mismatch")) return null;
  return { ...candidate, plausibility: audit };
}

router.post("/analyze", verifyFirebaseToken, analyzeLimiter, async (req, res) => {
  try {
    const image = clean(req.body?.image);
    if (!image.startsWith("data:image/")) return res.status(400).json({ error: "image_required" });

    const task = clean(req.body?.task) || "meal";
    const region = clean(req.body?.region).toUpperCase() || "GB";
    const language = clean(req.body?.language).toLowerCase() || "en";
    const candidateLimit = Math.max(0, Math.min(num(req.body?.returnCandidates, 5), 10));
    const detection = sanitizeDetection(await identifyImage(image, task, region));

    let result = task === "nutrition_label" ? labelResult(detection) : null;
    let groups = [];

    if (!result) {
      groups = await groundedGroups(detection, region, language);
      const resolvedGroups = groups.filter(group => group.match || group.fallback);

      if (resolvedGroups.length === 1) {
        const group = resolvedGroups[0];
        const resolved = group.match || group.fallback;
        const scaled = scaleResolved(resolved, group.item);
        if (scaled.audit?.ok) {
          const single = {
            ...resolved,
            calories: Math.round(scaled.calories), protein: Math.round(scaled.protein), carbs: Math.round(scaled.carbs), fat: Math.round(scaled.fat),
            serving: group.item.estimatedServing || resolved.serving || "Detected portion",
            detectedBrand: detection.detectedBrand || resolved.brand || null,
            confidence: Math.min(0.99, num(resolved.confidence, 0.75), num(group.item.visualConfidence, 0.5) + 0.1, num(group.item.portionConfidence, 0.5) + 0.12),
            portionEstimate: {
              grams: Math.round(scaled.portion?.grams || num(group.item.estimatedGrams, 0)),
              lowGrams: Math.round(scaled.portion?.low || num(group.item.estimatedGramsLow, 0)),
              highGrams: Math.round(scaled.portion?.high || num(group.item.estimatedGramsHigh, 0)),
              scalingBasis: scaled.scalingBasis
            }
          };
          const plausibility = mealPlausibility(single, [group.item]);
          if (plausibility.ok) result = { ...single, plausibility };
        }
      } else if (resolvedGroups.length > 0) {
        result = makeCompositeResult(detection, resolvedGroups);
      }
    }

    if (!result) {
      console.warn("TRACK meal rejected", { task, region, detectedBrand: detection.detectedBrand || null, items: detection.items.map(x => safeText(x.name, 50)) });
      return res.status(422).json({ error: "food_not_confidently_identified", detected: detection });
    }

    const debugCandidates = rankAndDedupe(
      groups.flatMap(group => group.alternatives || []),
      detection.mealName || detection.items?.[0]?.searchQuery || "food",
      candidateLimit
    );

    console.info("TRACK meal analysis", {
      task, region, brand: detection.detectedBrand || null,
      name: safeText(result.name, 70), calories: result.calories, protein: result.protein, carbs: result.carbs, fat: result.fat,
      components: (result.components || []).map(c => ({ name: safeText(c.name, 50), source: safeText(c.source, 45), grams: c.estimatedGrams }))
    });

    // The current Swift client sorts `result` together with `candidates`. Keep alternatives
    // diagnostic-only so a component cannot outrank the complete meal.
    res.json({ result, candidates: [], debugCandidates, detected: detection, databaseConnected: hasCredentials() });
  } catch (error) {
    const unavailable = error?.code === "openai_unavailable";
    console.error("TRACK /v2/food/analyze error:", error?.message || error);
    res.status(unavailable ? 503 : 500).json({ error: unavailable ? "vision_unavailable" : "food_analysis_failed" });
  }
});

module.exports = router;
