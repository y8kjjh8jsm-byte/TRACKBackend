require("dotenv").config();

const express = require("express");
const cors = require("cors");

const analyzeFoodRouter = require("./routes/analyzeFood");
const searchFoodRouter = require("./routes/searchFood");

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) => {
  res.send("TRACK Food AI Running");
});

app.use("/analyze-food", analyzeFoodRouter);
app.use("/search-food", searchFoodRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TRACK Food AI running on port ${PORT}`);
});
