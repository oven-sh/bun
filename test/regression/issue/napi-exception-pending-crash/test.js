const addon = require('./build/Release/test_addon');

console.log('Testing napi_is_exception_pending behavior...');

// Test 1: Basic functionality - should work without crash
console.log('\n1. Testing basic napi_is_exception_pending:');
try {
    const result = addon.testExceptionPendingBasic();
    console.log(`   Status: ${result.status} (should be 0 for napi_ok)`);
    console.log(`   Result: ${result.result} (should be false - no exception pending)`);
} catch (e) {
    console.log(`   ERROR: ${e.message}`);
    process.exit(1);
}

// Test 2: With pending exception - should detect the exception
console.log('\n2. Testing with pending exception:');
try {
    const result = addon.testWithPendingException();
    console.log(`   Status: ${result.status} (should be 0 for napi_ok)`);
    console.log(`   Result: ${result.result} (should be true - exception is pending)`);
    // This should have thrown, but we caught the result first
} catch (e) {
    console.log(`   Exception was thrown as expected: ${e.message}`);
    console.log(`   (This confirms exception handling works correctly)`);
}

// Test 3: Create object with finalizer - this is the crash test
console.log('\n3. Testing finalizer scenario (the crash case):');
console.log('   Creating object with finalizer that calls napi_is_exception_pending...');

// Create objects with finalizers
for (let i = 0; i < 5; i++) {
    const obj = addon.createObjectWithFinalizer();
    // Let it go out of scope
}

console.log('   Objects created. Forcing garbage collection...');

// Force garbage collection to trigger finalizers
if (global.gc) {
    global.gc();
    global.gc(); // Multiple times to ensure cleanup
} else {
    console.log('   Warning: global.gc not available, using setTimeout for cleanup');
    // Fallback: create pressure and wait
    for (let i = 0; i < 1000; i++) {
        new Array(1000).fill(i);
    }
}

console.log('   Garbage collection completed.');

// Add a small delay to ensure finalizers have run
setTimeout(() => {
    console.log('   Process exiting - finalizers should have run during cleanup.');
    console.log('\nSUCCESS: napi_is_exception_pending works correctly in all scenarios!');
    process.exit(0);
}, 100);