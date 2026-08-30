const express = require("express");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");

const verifyFirebaseToken = require("../authMiddleware");
const { parseFoodSearch } = require("../services/foodParserService");
const { searchFood } = require("../services/foodSearchService");

const router = express.Router();

const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Too many food searches. Please try again later." }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

router.post("/", verifyFirebaseToken, searchLimiter, async (req, res) => {
  try {
    const query = req.body.query;

    if (!query) {
      return res.status(400).json({ error: "No search query provided" });
    }

    const parsed = await parseFoodSearch(openai, query);
    const results = await searchFood(parsed);

    res.json({ results });

  } catch (error) {
    console.error("Food search error:", error);

    res.status(500).json({
      error: "Food search failed",
      details: error.message
    });
  }
});

module.exports = router;
