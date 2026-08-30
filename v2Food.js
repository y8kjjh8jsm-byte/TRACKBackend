const express = require("express");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");

const verifyFirebaseToken = require("../authMiddleware");
const { searchFoods, rankAndDedupe, hasCredentials } = require("../services/fatSecretService");
const { searchUSDA } = require("../services/usdaService");
const { searchOpenFoodFacts } = require("../services/openFoodFactsService");
const { calculateMealNutrition } = require("../services/nutritionCalculator");
const { validateMeal } = require("../services/validationEngine");
const { applyConfidenceScores } = require("../services/confidenceEngine");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  message: { error: "Too many food searches. Please try again later." }
});

const analyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: { error: "Too many AI scans. Please try again later." }
});

function clean(value) {
  return String(value ?? "").trim();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function simpleId(...parts) {
  let hash = 2166136261;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function fallbackResult(name, nutrition, source, region) {
  if (!nutrition) return null;
  return {
    id: simpleId(source, name),
    name,
    brand: "",
    serving: "100g",
    calories: num(nutrition.calories),
    protein: num(nutrition.protein),
    carbs: num(nutrition.carbs),
    fat: num(nutrition.fat),
    source,
    confidence: source === "USDA" ? 0.88 : 0.76,
    verified: source === "USDA",
    optionSummary: "",
    proteinType: "",
    format: "Item",
    size: "",
    region
  };
}

async function searchFallbacks(query, region) {
  const [usda, off] = await Promise.all([
    searchUSDA(query),
    searchOpenFoodFacts(query)
  ]);
  return [
    fallbackResult(query, usda, "USDA", region),
    fallbackResult(query, off, "Open Food Facts", region)
  ].filter(Boolean);
}

router.post("/search", verifyFirebaseToken, searchLimiter, async (req, res) => {
  try {
    const query = clean(req.body?.query);
    if (query.length < 2) return res.status(400).json({ error: "query_required" });

    const region = clean(req.body?.region).toUpperCase() || "GB";
    const language = clean(req.body?.language).toLowerCase() || "en";
    const limit = Math.max(1, Math.min(num(req.body?.limit, 30), 50));

    let results = [];
    if (hasCredentials()) {
      results = await searchFoods(query, region, language, limit);
    }

    if (results.length < 5) {
      results.push(...await searchFallbacks(query, region));
    }

    res.json({
      query,
      region,
      results: rankAndDedupe(results, query, limit),
      databaseConnected: hasCredentials()
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
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          size: { type: ["string", "null"] },
          searchQuery: { type: "string" },
          estimatedServing: { type: ["string", "null"] },
          estimatedGrams: { type: "number" },
          visualConfidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["name", "quantity", "size", "searchQuery", "estimatedServing", "estimatedGrams", "visualConfidence"]
      }
    },
    labelNutrition: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        serving: { type: "string" },
        calories: { type: "number" },
        protein: { type: "number" },
        carbs: { type: "number" },
        fat: { type: "number" }
      },
      required: ["serving", "calories", "protein", "carbs", "fat"]
    }
  },
  required: ["detectedBrand", "isRestaurantFood", "mealName", "items", "labelNutrition"]
};

async function identifyImage(image, task, region) {
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const taskInstructions = task === "nutrition_label"
    ? `Read the nutrition label and product branding carefully. Capture calories, protein, carbohydrate and fat for the clearly stated serving when legible. Also create a precise food-database search query. Never invent unreadable label values.`
    : `Identify every visible food/drink. Use logos, wrappers, cups, boxes and restaurant presentation as evidence for the brand. For restaurant food, create precise search queries containing brand, item name, size, meal/combo wording and flavour where visible. Estimate quantity and edible grams, but do not invent calories.`;

  const response = await openai.responses.create({
    model,
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: `You are TRACK's food recognition layer. ${taskInstructions} User region: ${region}. Return only the requested structured result.`
        },
        { type: "input_image", image_url: image, detail: "high" }
      ]
    }],
    text: {
      format: {
        type: "json_schema",
        name: "track_food_detection",
        strict: true,
        schema: detectionSchema
      }
    }
  });

  return JSON.parse(response.output_text);
}

function chooseBestMatch(results, item) {
  if (!results.length) return null;
  const target = `${item.searchQuery || ""} ${item.size || ""} ${item.estimatedServing || ""}`.toLowerCase();
  const targetTokens = target.split(/\s+/).filter(Boolean);

  return [...results].sort((a, b) => {
    const score = result => {
      const hay = `${result.brand || ""} ${result.name || ""} ${result.serving || ""} ${result.optionSummary || ""}`.toLowerCase();
      let s = (result.verified ? 50 : 0) + num(result.confidence, 0.5) * 50;
      targetTokens.forEach(token => { if (hay.includes(token)) s += 4; });
      if (item.size && hay.includes(String(item.size).toLowerCase())) s += 20;
      return s;
    };
    return score(b) - score(a);
  })[0];
}

async function groundedGroups(detection, region, language) {
  return Promise.all((detection.items || []).map(async item => {
    const brandPrefix = detection.detectedBrand ? `${detection.detectedBrand} ` : "";
    const query = clean(item.searchQuery) || `${brandPrefix}${item.name}`;
    const results = await searchFoods(query, region, language, 15);
    const ranked = rankAndDedupe(results, query, 8);
    return {
      item,
      query,
      match: chooseBestMatch(ranked, item),
      alternatives: ranked.slice(0, 5)
    };
  }));
}

function scaleMatched(match, item) {
  const quantity = Math.max(0.25, Math.min(num(item.quantity, 1), 20));
  return {
    calories: num(match.calories) * quantity,
    protein: num(match.protein) * quantity,
    carbs: num(match.carbs) * quantity,
    fat: num(match.fat) * quantity,
    quantity
  };
}

function makeCompositeResult(detection, matched) {
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let confidence = 1;
  const names = [];

  matched.forEach(group => {
    const scaled = scaleMatched(group.match, group.item);
    calories += scaled.calories;
    protein += scaled.protein;
    carbs += scaled.carbs;
    fat += scaled.fat;
    confidence = Math.min(confidence, num(group.item.visualConfidence, 0.5), num(group.match.confidence, 0.7));
    names.push(scaled.quantity === 1 ? group.match.name : `${scaled.quantity}× ${group.match.name}`);
  });

  return {
    name: clean(detection.mealName) || names.join(" + ") || "Detected meal",
    serving: "Detected meal",
    calories: Math.round(calories),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    source: "Vision matched to FatSecret verified foods",
    confidence: Math.min(0.97, confidence),
    verified: matched.every(group => group.match.verified === true),
    detectedBrand: detection.detectedBrand || null
  };
}

function labelResult(detection) {
  const label = detection.labelNutrition;
  if (!label) return null;
  const total = num(label.calories) + num(label.protein) + num(label.carbs) + num(label.fat);
  if (total <= 0) return null;

  return {
    name: clean(detection.mealName) || clean(detection.items?.[0]?.name) || "Nutrition label",
    serving: clean(label.serving) || "Label serving",
    calories: Math.round(num(label.calories)),
    protein: Math.round(num(label.protein)),
    carbs: Math.round(num(label.carbs)),
    fat: Math.round(num(label.fat)),
    source: "Nutrition label read from image",
    confidence: 0.9,
    verified: true,
    detectedBrand: detection.detectedBrand || null
  };
}

async function legacyGrounding(detection) {
  const synthetic = {
    name: detection.mealName || "Detected meal",
    serving: "Detected meal",
    restaurantHint: detection.detectedBrand || "",
    confidence: "medium",
    notes: "Fallback grounding when commercial database match is unavailable.",
    components: (detection.items || []).map(item => ({
      name: item.name,
      estimatedGrams: Math.max(1, num(item.estimatedGrams, 100)),
      confidence: num(item.visualConfidence, 0.5) >= 0.8 ? "high" : "medium"
    }))
  };

  const calculated = await calculateMealNutrition(synthetic);
  return applyConfidenceScores(validateMeal(calculated));
}

function legacyToV2(meal, brand) {
  if (!meal) return null;
  return {
    name: meal.name,
    serving: meal.serving,
    calories: num(meal.calories),
    protein: num(meal.protein),
    carbs: num(meal.carbs),
    fat: num(meal.fat),
    source: "TRACK fallback nutrition engine",
    confidence: Math.min(0.82, num(meal.confidenceScore, 65) / 100),
    verified: false,
    detectedBrand: brand || null
  };
}

router.post("/analyze", verifyFirebaseToken, analyzeLimiter, async (req, res) => {
  try {
    const image = clean(req.body?.image);
    if (!image.startsWith("data:image/")) {
      return res.status(400).json({ error: "image_required" });
    }

    const task = clean(req.body?.task) || "meal";
    const region = clean(req.body?.region).toUpperCase() || "GB";
    const language = clean(req.body?.language).toLowerCase() || "en";
    const candidateLimit = Math.max(0, Math.min(num(req.body?.returnCandidates, 5), 10));

    const detection = await identifyImage(image, task, region);

    let groups = [];
    if (hasCredentials()) {
      groups = await groundedGroups(detection, region, language);
    }

    const matched = groups.filter(group => group.match);
    let result = null;

    if (matched.length === 1 && num(matched[0].item.quantity, 1) <= 1) {
      const match = matched[0].match;
      result = {
        ...match,
        detectedBrand: detection.detectedBrand || match.brand || null,
        confidence: Math.min(0.99, Math.max(num(match.confidence, 0.8), num(matched[0].item.visualConfidence, 0.5)))
      };
    } else if (matched.length > 0) {
      result = makeCompositeResult(detection, matched);
    }

    if (!result && task === "nutrition_label") {
      result = labelResult(detection);
    }

    if (!result) {
      result = legacyToV2(await legacyGrounding(detection), detection.detectedBrand);
    }

    const candidates = rankAndDedupe(
      groups.flatMap(group => group.alternatives || []),
      detection.mealName || detection.items?.[0]?.searchQuery || "food",
      candidateLimit
    );

    res.json({
      result,
      candidates,
      detected: detection,
      databaseConnected: hasCredentials()
    });
  } catch (error) {
    console.error("TRACK /v2/food/analyze error:", error);
    res.status(500).json({ error: "food_analysis_failed", details: error.message });
  }
});

module.exports = router;
