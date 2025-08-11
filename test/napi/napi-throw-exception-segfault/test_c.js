const assert = require('assert');

try {
    const testModule = require('./build/Release/test_c_version.node');
    
    // Test throwing with napi_throw
    console.log("Testing napi_throw...");
    try {
        testModule.throwError();
        assert.fail("Expected exception to be thrown");
    } catch (error) {
        console.log("Caught exception:", error.message);
    }
    
    // Test throwing with napi_throw_error
    console.log("Testing napi_throw_error...");
    try {
        testModule.throwErrorString();
        assert.fail("Expected exception to be thrown");
    } catch (error) {
        console.log("Caught exception:", error.message);
        assert.strictEqual(error.message, "Test error string from C NAPI");
    }
    
    console.log("All C NAPI tests passed!");
} catch (loadError) {
    console.error("Failed to load C module:", loadError.message);
    console.log("Building C module...");
}