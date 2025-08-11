// Test the rapid throws issue found in Bun

let testModule;
try {
    testModule = require('./build/Release/test_rapid_throws.node');
} catch (e) {
    console.error("Failed to load test module:", e.message);
    console.log("Please build with: cp binding_rapid.gyp binding.gyp && node-gyp rebuild");
    process.exit(1);
}

console.log("=== Testing Rapid Throws Issue ===\n");

// Test 1: Single throw (should work)
console.log("Test 1: Single throw");
try {
    testModule.singleThrow();
    console.log("❌ Expected exception");
} catch (e) {
    console.log("✅ Caught:", e.message);
}

console.log("\nTest 2: Throw after catch");
try {
    testModule.throwAfterCatch();
    console.log("❌ Expected exception");
} catch (e) {
    console.log("✅ Caught:", e.message);
}

console.log("\nTest 3: Simple rapid throws (this may crash Bun)");
try {
    testModule.simpleRapidThrows();
    console.log("❌ Expected exception");
} catch (e) {
    console.log("✅ Caught:", e.message);
}

console.log("\n=== Test completed ===");