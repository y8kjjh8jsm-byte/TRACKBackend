const assert = require("assert");
const {
  rankAndDedupe,
  parseIntent,
  brandMatches,
  nutritionLooksSane,
  normalizeSearchPayload,
  conflictingSameFoodServing,
  servingLabelKind,
  scaledServingFromIntent
} = require("../services/fatSecretService");

function hit({ name, brand, serving = "1 serving", calories = 400, protein = 20, carbs = 40, fat = 15, isDefault = false, servingKind = "consumer", size = "", format = "Item" }) {
  return {
    id: `${brand}-${name}-${serving}`,
    name, brand, serving, calories, protein, carbs, fat,
    source: "FatSecret verified database", confidence: 0.97, verified: true,
    optionSummary: "", proteinType: "", size, format, region: "GB", foodType: "Brand", isDefault, servingKind
  };
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test("recognises major chain aliases", () => {
  assert.equal(parseIntent("maccies big mac").brand, "mcdonald's");
  assert.equal(parseIntent("Costa large latte").brand, "costa coffee");
  assert.equal(parseIntent("kentucky fried chicken zinger").brand, "kfc");
  assert.equal(parseIntent("macdonalds big mac").brand, "mcdonald's");
  assert.equal(parseIntent("starbuks latte").brand, "starbucks");
  assert.deepEqual(parseIntent("macdonalds big mac").itemTokens, ["big", "mac"]);
});

test("cross-brand results are rejected", () => {
  const results = rankAndDedupe([
    hit({ name: "Big Mac", brand: "McDonald's", calories: 493 }),
    hit({ name: "Iced Caramel Macchiato", brand: "Starbucks", calories: 250 })
  ], "McDonald's Big Mac", 30);
  assert.equal(results.length, 1);
  assert.equal(results[0].brand, "McDonald's");
});

test("exact requested item beats same-brand related food", () => {
  const results = rankAndDedupe([
    hit({ name: "Medium Fries", brand: "McDonald's", calories: 337 }),
    hit({ name: "Big Mac", brand: "McDonald's", calories: 493, isDefault: true }),
    hit({ name: "Big Mac Bacon", brand: "McDonald's", calories: 590 })
  ], "McDonald's Big Mac", 30);
  assert.equal(results[0].name, "Big Mac");
});

test("default consumer serving beats 100g reference for branded food", () => {
  const results = rankAndDedupe([
    hit({ name: "Big Mac", brand: "McDonald's", serving: "100 g", calories: 257, protein: 13, carbs: 22, fat: 13, servingKind: "reference" }),
    hit({ name: "Big Mac", brand: "McDonald's", serving: "1 burger", calories: 493, protein: 26, carbs: 42, fat: 24, servingKind: "consumer", isDefault: true })
  ], "McDonald's Big Mac", 30);
  assert.equal(results[0].serving, "1 burger");
});

test("size intent prioritises matching size", () => {
  const results = rankAndDedupe([
    hit({ name: "Caffe Latte", brand: "Starbucks", serving: "Grande", calories: 190, protein: 13, carbs: 18, fat: 7, size: "Grande", format: "Drink", servingKind: "size" }),
    hit({ name: "Caffe Latte", brand: "Starbucks", serving: "Tall", calories: 150, protein: 10, carbs: 15, fat: 6, size: "Tall", format: "Drink", servingKind: "size" })
  ], "Starbucks grande caffe latte", 30);
  assert.equal(results[0].size, "Grande");
});

test("duplicate identical servings collapse", () => {
  const a = hit({ name: "Zinger Burger", brand: "KFC", serving: "1 burger", calories: 450 });
  const results = rankAndDedupe([a, { ...a, id: "duplicate" }], "KFC Zinger Burger", 30);
  assert.equal(results.length, 1);
});

test("generic food search remains available", () => {
  const results = rankAndDedupe([
    { ...hit({ name: "Chicken Breast", brand: "", serving: "100 g", calories: 165, protein: 31, carbs: 0, fat: 3.6 }), foodType: "Generic", servingKind: "reference" }
  ], "chicken breast", 30);
  assert.equal(results.length, 1);
});

test("nutrition sanity rejects absurd values", () => {
  assert.equal(nutritionLooksSane(hit({ name: "Bad", brand: "X", calories: 99999 })), false);
  assert.equal(nutritionLooksSane(hit({ name: "Fine", brand: "X", calories: 400 })), true);
});


test("normalises FatSecret v5 detailed servings and default flag", () => {
  const payload = { foods_search: { results: { food: [{
    food_id: "123", food_name: "Big Mac", brand_name: "McDonald's", food_type: "Brand",
    servings: { serving: [
      { serving_id: "1", serving_description: "1 burger", is_default: "1", calories: "493", protein: "26", carbohydrate: "42", fat: "24" },
      { serving_id: "2", serving_description: "100 g", calories: "257", protein: "13.5", carbohydrate: "21.9", fat: "12.5" }
    ] }
  }] } } };
  const rows = normalizeSearchPayload(payload, "GB");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].brand, "McDonald's");
  assert.equal(rows[0].isDefault, true);
  assert.equal(rows[0].servingKind, "default");
  assert.equal(rows[0].calories, 493);
});
test("brand matching tolerates punctuation", () => {
  assert.equal(brandMatches("McDonalds", "McDonald's"), true);
  assert.equal(brandMatches("Starbucks", "McDonald's"), false);
});


test("rejects the previously observed corrupted Big Mac macro/calorie record", () => {
  const results = rankAndDedupe([
    hit({ name: "Big Mac", brand: "McDonald's", serving: "1 burger", calories: 493, protein: 26, carbs: 42, fat: 24, isDefault: true }),
    hit({ name: "Big Mac", brand: "McDonald's", serving: "1 serving", calories: 978, protein: 13, carbs: 21, fat: 4 })
  ], "McDonald's Big Mac", 30);
  assert.equal(results.length, 1);
  assert.equal(results[0].calories, 493);
});

test("suppresses conflicting vague restaurant serving when a concrete serving exists", () => {
  const results = rankAndDedupe([
    hit({ name: "Zinger Burger", brand: "KFC", serving: "1 serving", calories: 224, protein: 13, carbs: 31, fat: 5, servingKind: "other" }),
    hit({ name: "Zinger Burger", brand: "KFC", serving: "1 burger", calories: 450, protein: 26, carbs: 45, fat: 18, servingKind: "consumer", isDefault: true })
  ], "KFC Zinger Burger", 30);
  assert.equal(results.length, 1);
  assert.equal(results[0].serving, "1 burger");
});

test("allows genuinely distinct restaurant sizes", () => {
  const results = rankAndDedupe([
    hit({ name: "Caffe Latte", brand: "Starbucks", serving: "Tall", calories: 150, protein: 10, carbs: 15, fat: 6, size: "Tall", servingKind: "size" }),
    hit({ name: "Caffe Latte", brand: "Starbucks", serving: "Grande", calories: 210, protein: 13, carbs: 22, fat: 8, size: "Grande", servingKind: "size" })
  ], "Starbucks Caffe Latte", 30);
  assert.equal(results.length, 2);
});

test("Nando's branded query rejects generic chicken", () => {
  const results = rankAndDedupe([
    hit({ name: "Butterfly Chicken", brand: "Nando's", serving: "1 serving", calories: 330, protein: 56, carbs: 2, fat: 11 }),
    { ...hit({ name: "Chicken Breast", brand: "", serving: "100 g", calories: 165, protein: 31, carbs: 0, fat: 4 }), foodType: "Generic" }
  ], "Nando's Butterfly Chicken", 30);
  assert.equal(results.length, 1);
  assert.equal(results[0].brand, "Nando's");
});

test("serving conflict helper recognises vague-vs-concrete conflicts", () => {
  const vague = hit({ name: "Zinger Burger", brand: "KFC", serving: "1 serving", calories: 224, protein: 13, carbs: 31, fat: 5, servingKind: "other" });
  const concrete = hit({ name: "Zinger Burger", brand: "KFC", serving: "1 burger", calories: 450, protein: 26, carbs: 45, fat: 18, servingKind: "consumer" });
  assert.equal(servingLabelKind(vague), "vague");
  assert.equal(conflictingSameFoodServing(vague, concrete), true);
});

test("malformed FatSecret payload normalises safely to no rows", () => {
  assert.deepEqual(normalizeSearchPayload({ broken: true }, "GB"), []);
});


test("parses and scales Chicken breast 200g", () => {
  const intent = parseIntent("Chicken breast 200g");
  assert.equal(intent.requestedGrams, 200);
  assert.deepEqual(intent.itemTokens, ["chicken", "breast"]);
  const base = { ...hit({ name: "Chicken Breast", brand: "", serving: "100 g", calories: 165, protein: 31, carbs: 0, fat: 4 }), metricAmount: 100, metricUnit: "g", foodType: "Generic", servingKind: "reference" };
  const scaled = scaledServingFromIntent([base], intent);
  assert.equal(scaled.serving, "200 g");
  assert.equal(Math.round(scaled.calories), 330);
  assert.equal(Math.round(scaled.protein), 62);
});

test("parses and scales 2 large eggs", () => {
  const intent = parseIntent("2 large eggs");
  assert.equal(intent.quantity, 2);
  assert.deepEqual(intent.itemTokens, ["eggs"]);
  const base = { ...hit({ name: "Large Egg", brand: "", serving: "1 large egg", calories: 72, protein: 6, carbs: 0.4, fat: 5 }), foodType: "Generic", servingKind: "consumer" };
  const scaled = scaledServingFromIntent([base], intent);
  assert.equal(scaled.serving, "2 × 1 large egg");
  assert.equal(Math.round(scaled.calories), 144);
});

test("banana generic query remains a clean item query", () => {
  const intent = parseIntent("Banana");
  assert.equal(intent.brand, "");
  assert.deepEqual(intent.itemTokens, ["banana"]);
});

test("McDonald's Medium Fries preserves brand and size intent", () => {
  const intent = parseIntent("McDonald's Medium Fries");
  assert.equal(intent.brand, "mcdonald's");
  assert.equal(intent.size, "Medium");
  assert.deepEqual(intent.itemTokens, ["fries"]);
});

test("Starbucks Caramel Macchiato Grande preserves requested size", () => {
  const intent = parseIntent("Starbucks Caramel Macchiato Grande");
  assert.equal(intent.brand, "starbucks");
  assert.equal(intent.size, "Grande");
  assert.deepEqual(intent.itemTokens, ["caramel", "macchiato"]);
});

test("meal/combo intent is detected without treating meal as item token", () => {
  const intent = parseIntent("McDonald's Big Mac meal");
  assert.equal(intent.mealRequested, true);
  assert.deepEqual(intent.itemTokens, ["big", "mac"]);
});

test("branded supermarket food can rank without restaurant alias", () => {
  const rows = rankAndDedupe([
    { ...hit({ name: "Greek Style Yogurt", brand: "Fage", serving: "1 pot", calories: 120, protein: 18, carbs: 6, fat: 2 }), foodType: "Brand", servingKind: "consumer" },
    { ...hit({ name: "Vanilla Yogurt", brand: "Other", serving: "1 pot", calories: 180, protein: 8, carbs: 24, fat: 6 }), foodType: "Brand", servingKind: "consumer" }
  ], "Fage Greek Style Yogurt", 30);
  assert(rows.length >= 1);
  assert.equal(rows[0].brand, "Fage");
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`✓ ${name}`); passed += 1; }
  catch (error) { console.error(`✗ ${name}`); throw error; }
}
console.log(`\n${passed}/${tests.length} food-quality tests passed.`);
