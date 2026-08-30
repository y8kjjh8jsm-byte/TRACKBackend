const assert = require("assert");
const {
  macroCalories,
  nutritionAudit,
  sanitizeVisualPortion,
  resolveVisualNutrition,
  reconcileEstimatedNutrition,
  mealPlausibility
} = require("../services/nutritionQualityService");

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test("macro arithmetic is checked", () => {
  assert.equal(macroCalories({ protein: 26, carbs: 42, fat: 24 }), 488);
  assert.equal(nutritionAudit({ calories: 978, protein: 13, carbs: 21, fat: 4 }, { strict: true }).ok, false);
});

test("realistic macro/calorie combination passes", () => {
  assert.equal(nutritionAudit({ calories: 493, protein: 26, carbs: 42, fat: 24 }, { strict: true }).ok, true);
});

test("visual sauce/oil portions are bounded", () => {
  const oil = sanitizeVisualPortion({ name: "olive oil", estimatedGrams: 500, estimatedGramsLow: 300, estimatedGramsHigh: 700 });
  const sauce = sanitizeVisualPortion({ name: "garlic sauce", estimatedGrams: 900, estimatedGramsLow: 500, estimatedGramsHigh: 1200 });
  assert(oil.grams <= 80);
  assert(sauce.grams <= 180);
});

test("visual grams scale a database serving without multiplying piece count twice", () => {
  const resolved = { calories: 500, protein: 40, carbs: 40, fat: 20, metricAmount: 200, metricUnit: "g" };
  const scaled = resolveVisualNutrition(resolved, { name: "chicken meal", quantity: 2, estimatedGrams: 300, estimatedGramsLow: 260, estimatedGramsHigh: 340 });
  assert.equal(Math.round(scaled.factor * 100) / 100, 1.5);
  assert.equal(Math.round(scaled.calories), 750);
});

test("estimated-only calorie mismatch can be reconciled from its macros", () => {
  const result = reconcileEstimatedNutrition({ calories: 1765, protein: 84, carbs: 90, fat: 20, source: "TRACK estimated nutrition", verified: false });
  assert.equal(result.reconciled, true);
  assert.equal(result.calories, 876);
  assert.equal(result.nutritionAudit.ok, true);
});

test("verified corrupted data is rejected rather than rewritten", () => {
  const result = reconcileEstimatedNutrition({ calories: 978, protein: 13, carbs: 21, fat: 4, source: "FatSecret verified database", verified: true });
  assert.equal(result.rejected, true);
});

test("multi-item meal plausibility accepts a realistic chicken-fries-garlic-bread total", () => {
  const meal = { calories: 1450, protein: 85, carbs: 135, fat: 63 };
  const components = [
    { name: "grilled chicken", preparation: "grilled skin-on with visible sauce", estimatedGrams: 350 },
    { name: "fries", preparation: "fried", estimatedGrams: 220 },
    { name: "cheesy garlic bread", preparation: "cheese-topped", estimatedGrams: 220 }
  ];
  assert.equal(mealPlausibility(meal, components).ok, true);
});

test("meal plausibility rejects impossible visible energy density", () => {
  const meal = { calories: 3000, protein: 40, carbs: 100, fat: 250 };
  const components = [{ name: "plain grilled chicken", preparation: "grilled", estimatedGrams: 250 }];
  assert.equal(mealPlausibility(meal, components).ok, false);
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`✓ ${name}`); passed += 1; }
  catch (error) { console.error(`✗ ${name}`); throw error; }
}
console.log(`\n${passed}/${tests.length} meal-quality tests passed.`);
