const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const v2 = fs.readFileSync(path.join(root, "routes", "v2Food.js"), "utf8");
const auth = fs.readFileSync(path.join(root, "authMiddleware.js"), "utf8");
const fatSecret = fs.readFileSync(path.join(root, "services", "fatSecretService.js"), "utf8");

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test("legacy routes remain mounted", () => {
  assert(server.includes('app.use("/analyze-food", analyzeFoodRouter)'));
  assert(server.includes('app.use("/search-food", searchFoodRouter)'));
});

test("v2 food route remains mounted", () => {
  assert(server.includes('app.use("/v2/food", v2FoodRouter)'));
});

test("v2 search and analyze remain Firebase protected", () => {
  assert(v2.includes('router.post("/search", verifyFirebaseToken'));
  assert(v2.includes('router.post("/analyze", verifyFirebaseToken'));
  assert(auth.includes('return res.status(401)'));
});

test("rate limits remain on search and AI scan", () => {
  assert(v2.includes('max: 100'));
  assert(v2.includes('max: 30'));
});

test("generic fallback is failure-only", () => {
  assert(v2.includes('if (results.length === 0 && !intent.isRestaurantIntent)'));
});

test("client-facing analyze candidates stay empty for Swift compatibility", () => {
  assert(v2.includes('res.json({ result, candidates: []'));
});

test("vision unavailable returns a service failure rather than invented nutrition", () => {
  assert(v2.includes('vision_unavailable'));
  assert(v2.includes('503'));
});


test("provider calls have finite timeouts", () => {
  assert(fatSecret.includes('timeout: 10_000'));
  assert(fatSecret.includes('timeout: 12_000'));
});

test("regional localisation failure retries without falsely claiming requested locale", () => {
  assert(fatSecret.includes('effectiveRegion: "US"'));
  assert(fatSecret.includes('delete retry.region'));
  assert(fatSecret.includes('delete retry.language'));
});

test("search cache remains bounded and clearable", () => {
  assert(fatSecret.includes('SEARCH_TTL_MS'));
  assert(fatSecret.includes('if (searchCache.size > 250)'));
  assert(fatSecret.includes('function clearSearchCache()'));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`✓ ${name}`); passed += 1; }
  catch (error) { console.error(`✗ ${name}`); throw error; }
}
console.log(`\n${passed}/${tests.length} backend-contract tests passed.`);
