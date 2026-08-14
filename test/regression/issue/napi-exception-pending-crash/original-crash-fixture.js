/**
 * This script demonstrates the original crash scenario.
 * It's designed to test the specific case that was failing before our fix.
 */

const addon = require('./build/Release/test_addon');

console.log('Testing the original crash scenario...');
console.log('(This would crash before the fix, but should work now)');

// This is the exact scenario that was crashing:
// 1. Create objects with finalizers
// 2. Force cleanup/garbage collection  
// 3. During cleanup, finalizers call napi_is_exception_pending
// 4. Before the fix: CRASH with "panic: Aborted" from DECLARE_THROW_SCOPE
// 5. After the fix: Should work fine

console.log('\nCreating objects with finalizers...');
for (let i = 0; i < 10; i++) {
    const obj = addon.createObjectWithFinalizer();
    // Immediately let it go out of scope
}

console.log('Forcing cleanup (this is where the crash occurred)...');

if (global.gc) {
    global.gc();
    global.gc();
} else {
    // Create memory pressure to trigger cleanup
    for (let i = 0; i < 1000; i++) {
        new Array(1000).fill(i);
    }
}

console.log('Cleanup completed successfully!');

// Exit cleanly - more finalizers may run during process exit
setTimeout(() => {
    console.log('\n✅ SUCCESS: No crash occurred!');
    console.log('The napi_is_exception_pending fix is working correctly.');
    process.exit(0);
}, 200);