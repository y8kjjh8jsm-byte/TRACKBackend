const assert = require("assert");
const {
  rankAndDedupe,
  parseIntent,
  brandMatches,
  nutritionLooksSane,
  normalizeSearchPayload
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

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`✓ ${name}`); passed += 1; }
  catch (error) { console.error(`✗ ${name}`); throw error; }
}
console.log(`\n${passed}/${tests.length} food-quality tests passed.`);
