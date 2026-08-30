require("dotenv").config();

const express = require("express");
const cors = require("cors");

const analyzeFoodRouter = require("./routes/analyzeFood");
const searchFoodRouter = require("./routes/searchFood");
const v2FoodRouter = require("./routes/v2Food");

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) => {
  res.send("TRACK Food AI Running");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    foodDatabase: Boolean(process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET),
    vision: Boolean(process.env.OPENAI_API_KEY),
    foodEngineVersion: "ultimate-2026-08-30"
  });
});

// Existing routes remain unchanged for backwards compatibility.
app.use("/analyze-food", analyzeFoodRouter);
app.use("/search-food", searchFoodRouter);

// New high-coverage endpoints used by the upgraded iOS client.
app.use("/v2/food", v2FoodRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TRACK Food AI running on port ${PORT}`);
});
