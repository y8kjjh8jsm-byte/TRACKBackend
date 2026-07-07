const express = require("express");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");

const verifyFirebaseToken = require("../authMiddleware");
const { detectFoodComponents } = require("../services/visionService");
const { calculateMealNutrition } = require("../services/nutritionCalculator");
const { validateMeal } = require("../services/validationEngine");
const { applyConfidenceScores } = require("../services/confidenceEngine");
const {
  createMealFingerprint,
  getCachedMeal,
  saveCachedMeal
} = require("../services/cacheService");

const router = express.Router();

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many AI scans. Please try again later." }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

router.post("/", verifyFirebaseToken, aiLimiter, async (req, res) => {
  try {
    const image = req.body.image;

    if (!image) {
      return res.status(400).json({ error: "No image provided" });
    }

    const detectedMeal = await detectFoodComponents(openai, image);
    const fingerprint = createMealFingerprint(detectedMeal);

    const cachedMeal = getCachedMeal(fingerprint);

    if (cachedMeal) {
      console.log("TRACK Food Engine cache hit:", cachedMeal.name);

      return res.json({
        result: JSON.stringify({
          name: cachedMeal.name,
          serving: cachedMeal.serving,
          calories: cachedMeal.calories,
          protein: cachedMeal.protein,
          carbs: cachedMeal.carbs,
          fat: cachedMeal.fat
        })
      });
    }

    const calculatedMeal = await calculateMealNutrition(detectedMeal);
    const validatedMeal = validateMeal(calculatedMeal);
    const finalMeal = applyConfidenceScores(validatedMeal);

    saveCachedMeal(fingerprint, finalMeal);

    console.log("==================================");
    console.log("TRACK FOOD ENGINE");
    console.log("Meal:", finalMeal.name);

    finalMeal.components.forEach(component => {
      console.log(`${component.name} -> ${component.source} (${component.confidenceScore}%)`);
    });

    console.log("Calories:", finalMeal.calories);
    console.log("Protein:", finalMeal.protein);
    console.log("Carbs:", finalMeal.carbs);
    console.log("Fat:", finalMeal.fat);
    console.log("==================================");

    res.json({
      result: JSON.stringify({
        name: finalMeal.name,
        serving: finalMeal.serving,
        calories: finalMeal.calories,
        protein: finalMeal.protein,
        carbs: finalMeal.carbs,
        fat: finalMeal.fat
      })
    });

  } catch (error) {
    console.error("Analyze food error:", error);

    res.status(500).json({
      error: "Food analysis failed",
      details: error.message
    });
  }
});

module.exports = router;
