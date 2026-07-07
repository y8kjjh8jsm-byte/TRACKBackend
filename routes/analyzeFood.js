const express = require("express");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");

const verifyFirebaseToken = require("../authMiddleware");
const { detectFoodComponents } = require("../services/visionService");
const { calculateMealNutrition } = require("../services/nutritionCalculator");
const { validateMeal } = require("../services/validationEngine");
const { applyConfidenceScores } = require("../services/confidenceEngine");

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
      return res.status(400).json({
        error: "No image provided"
      });
    }

    const detectedMeal = await detectFoodComponents(openai, image);
    const calculatedMeal = await calculateMealNutrition(detectedMeal);
    const validatedMeal = validateMeal(calculatedMeal);
    const finalMeal = applyConfidenceScores(validatedMeal);

    console.log("TRACK Food Engine result:", finalMeal);

    res.json({
      result: JSON.stringify({
        name: finalMeal.name,
        serving: finalMeal.serving,
        calories: finalMeal.calories,
        protein: finalMeal.protein,
        carbs: finalMeal.carbs,
        fat: finalMeal.fat
      }),
      debug: {
        confidenceScore: finalMeal.confidenceScore,
        components: finalMeal.components
      }
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
