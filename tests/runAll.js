const { spawnSync } = require("child_process");
const path = require("path");
const files = ["foodQuality.test.js", "mealQuality.test.js", "backendContract.test.js"];
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("\nAll TRACK Food test suites passed.");
