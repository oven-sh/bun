const { existsSync, accessSync, mkdirSync, copyFileSync } = require("fs");
const { platform } = require("os");

// Test only runs on Windows
if (platform() !== "win32") {
  console.log("Skipping test - not on Windows");
  process.exit(0);
}

console.log("Testing Windows long path handling...");

// Test cases from the bug report
const lengths = [49150, 49151, 98302, 98303];
const results = [];

for (const len of lengths) {
  const path = "A".repeat(len);
  try {
    const exists = existsSync(path);
    results.push({ len, operation: "existsSync", success: true, result: exists });
  } catch (err) {
    results.push({ len, operation: "existsSync", success: false, error: err.message });
  }
}

// Test access function with long paths
for (const len of [49151, 98302]) {
  const path = "A".repeat(len);
  try {
    accessSync(path);
    results.push({ len, operation: "accessSync", success: true });
  } catch (err) {
    // ENOENT is expected for non-existent files
    // ENAMETOOLONG should be returned for paths that are too long
    const isExpectedError = err.code === "ENOENT" || err.code === "ENAMETOOLONG";
    results.push({ len, operation: "accessSync", success: isExpectedError, error: err.code });
  }
}

// Test mkdir with long paths
const longDirPath = "A".repeat(49151);
try {
  mkdirSync(longDirPath, { recursive: true });
  results.push({ len: 49151, operation: "mkdirSync", success: true });
} catch (err) {
  const isExpectedError = err.code === "ENAMETOOLONG";
  results.push({ len: 49151, operation: "mkdirSync", success: isExpectedError, error: err.code });
}

// Print results
console.log("\nTest Results:");
console.log("=============");
for (const result of results) {
  if (result.success) {
    console.log(`✓ ${result.operation}(path.length=${result.len}) - ${result.error || "OK"}`);
  } else {
    console.log(`✗ ${result.operation}(path.length=${result.len}) - ${result.error}`);
  }
}

// Check if all tests passed
const allPassed = results.every(r => r.success);
if (allPassed) {
  console.log("\n✅ All tests passed! Long path handling is working correctly.");
} else {
  console.log("\n❌ Some tests failed.");
  process.exit(1);
}
