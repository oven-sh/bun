// Test script for experimental NAPI module that should crash
const m = require('./build/Debug/test_reference_unref_in_finalizer_experimental.node');

console.log('Loading experimental module...');
let arr = m.test_reference_unref_in_finalizer_experimental();
console.log('Test function returned');

// Clear reference and force GC
arr = null;

if (global.gc) {
  global.gc();
  console.log('GC triggered - should crash now');
} else if (process.isBun && Bun.gc) {
  Bun.gc(true);
  console.log('GC triggered - should crash now');
}

// This should never print
console.log('ERROR: Did not crash! Test failed!');
process.exit(1);