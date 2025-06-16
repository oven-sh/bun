// Simple test to verify the Windows path length fix
// This test would have crashed before the fix

const { existsSync } = require("fs");

console.log("Testing Windows path length fix...\n");

const testCases = [
  { length: 49150, shouldCrash: false },
  { length: 49151, shouldCrash: true }, // This used to crash
  { length: 98302, shouldCrash: true }, // This used to crash
  { length: 98303, shouldCrash: false },
];

for (const testCase of testCases) {
  const path = "A".repeat(testCase.length);

  try {
    const result = existsSync(path);
    console.log(`✓ Path length ${testCase.length}: existsSync returned ${result} (no crash)`);
  } catch (err) {
    console.log(`✗ Path length ${testCase.length}: CRASHED with error:`, err.message);
  }
}

console.log("\nIf you see this message, the fix is working correctly!");
console.log('Before the fix, this script would have crashed with "index out of bounds" error.');
