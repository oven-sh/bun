const assert = require('assert');
const testModule = require('./build/Release/test_throw_exception_segfault.node');

// Test the segfault case
console.log("Testing ThrowAsJavaScriptException (expected to segfault in Bun)...");
try {
    testModule.throwException();
    assert.fail("Expected exception to be thrown");
} catch (error) {
    console.log("Caught exception:", error.message);
    assert.strictEqual(error.message, "Test error message");
}

// Test the workaround case
console.log("Testing workaround (throw in C++ space)...");
try {
    testModule.throwExceptionWorkaround();
    assert.fail("Expected exception to be thrown");
} catch (error) {
    console.log("Caught exception:", error.message);
    assert.strictEqual(error.message, "Test error message");
}

console.log("All tests passed!");