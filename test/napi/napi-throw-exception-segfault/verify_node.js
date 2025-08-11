// Verify that Node.js handles "throw after catch" correctly

let testModule;
try {
    testModule = require('./build/Release/verify_node_behavior.node');
} catch (e) {
    console.error("Failed to load test module:", e.message);
    console.log("Please build with: cp binding_verify.gyp binding.gyp && node-gyp rebuild");
    process.exit(1);
}

console.log("=== Verifying Node.js Behavior ===\n");

// Test 1: Simple throw (baseline - should work in both Node.js and Bun)
console.log("Test 1: Simple throw (baseline)");
try {
    testModule.simpleThrow();
    console.log("❌ ERROR: Expected exception from simple throw");
} catch (e) {
    console.log("✅ SUCCESS: Caught simple exception:", e.message);
}

console.log("\nTest 2: Throw after catch (the issue)");
try {
    testModule.throwAfterCatchClean();
    console.log("❌ ERROR: Expected exception from throw after catch");
} catch (e) {
    console.log("✅ SUCCESS: Caught exception after catch:", e.message);
}

console.log("\n=== Node.js Verification Complete ===");
console.log("If both tests show SUCCESS, then Node.js handles this correctly");
console.log("and the issue is Bun-specific.");