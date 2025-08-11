const assert = require('assert');

// Build and load the comprehensive test module
let testModule;
try {
    testModule = require('./build/Release/test_comprehensive.node');
} catch (e) {
    console.error("Failed to load comprehensive test module:", e.message);
    console.log("Please build with: cp binding_comprehensive.gyp binding.gyp && node-gyp rebuild");
    process.exit(1);
}

const tests = [
    {
        name: "Direct ThrowAsJavaScriptException (original issue)",
        func: testModule.directThrow,
        expectedMessage: "Direct throw error message"
    },
    {
        name: "Create then throw separately",
        func: testModule.createThenThrow,
        expectedMessage: "Created then thrown error"
    },
    {
        name: "TypeError throw",
        func: testModule.throwTypeError,
        expectedMessage: "Type error message",
        expectedType: TypeError
    },
    {
        name: "RangeError throw",
        func: testModule.throwRangeError,
        expectedMessage: "Range error message",
        expectedType: RangeError
    },
    {
        name: "C++ exception (workaround)",
        func: testModule.throwCppException,
        expectedMessage: "C++ thrown error"
    },
    {
        name: "Throw with error code",
        func: testModule.throwWithCode,
        expectedMessage: "Error with code",
        expectCode: "TEST_ERROR_CODE"
    },
    {
        name: "Nested function throw",
        func: testModule.nestedThrow,
        expectedMessage: "Nested error"
    },
    {
        name: "Throw in callback",
        func: () => testModule.throwInCallback(() => { throw new Error("Callback error"); }),
        expectedMessage: /Callback error/
    },
    {
        name: "Rapid throws (stress test)",
        func: testModule.rapidThrows,
        expectedMessage: "Final rapid throw"
    },
    {
        name: "Empty message throw",
        func: testModule.throwEmptyMessage,
        expectedMessage: ""
    },
    {
        name: "Long message throw",
        func: testModule.throwLongMessage,
        expectedMessage: /End of long message$/
    }
];

let passedTests = 0;
let totalTests = tests.length;

console.log(`Running ${totalTests} comprehensive C++ NAPI exception tests...\n`);

for (const test of tests) {
    try {
        console.log(`Testing: ${test.name}`);
        
        test.func();
        
        // If we get here, the function didn't throw
        console.log(`❌ FAILED: ${test.name} - Expected exception but none was thrown`);
        
    } catch (error) {
        // Verify the exception properties
        let passed = true;
        let details = [];
        
        // Check error type
        if (test.expectedType) {
            if (!(error instanceof test.expectedType)) {
                passed = false;
                details.push(`Expected ${test.expectedType.name} but got ${error.constructor.name}`);
            }
        }
        
        // Check error message
        if (test.expectedMessage instanceof RegExp) {
            if (!test.expectedMessage.test(error.message)) {
                passed = false;
                details.push(`Message doesn't match pattern: got "${error.message}"`);
            }
        } else if (typeof test.expectedMessage === 'string') {
            if (error.message !== test.expectedMessage) {
                passed = false;
                details.push(`Expected message "${test.expectedMessage}" but got "${error.message}"`);
            }
        }
        
        // Check error code if expected
        if (test.expectCode) {
            if (error.code !== test.expectCode) {
                passed = false;
                details.push(`Expected code "${test.expectCode}" but got "${error.code}"`);
            }
        }
        
        if (passed) {
            console.log(`✅ PASSED: ${test.name}`);
            passedTests++;
        } else {
            console.log(`❌ FAILED: ${test.name}`);
            details.forEach(detail => console.log(`   ${detail}`));
        }
        
        console.log(`   Caught: ${error.constructor.name}: ${error.message}`);
        if (error.code) console.log(`   Code: ${error.code}`);
    }
    
    console.log();
}

console.log(`\n=== Test Summary ===`);
console.log(`Passed: ${passedTests}/${totalTests}`);
console.log(`Failed: ${totalTests - passedTests}/${totalTests}`);

if (passedTests === totalTests) {
    console.log("🎉 All comprehensive C++ NAPI exception tests passed!");
    console.log("The original issue #4526 appears to be FIXED ✅");
} else {
    console.log("⚠️  Some tests failed - there may still be issues with NAPI exception handling");
    process.exit(1);
}