// Test script that runs the experimental module test with a timeout
const { spawn } = require('child_process');
const path = require('path');

const modulePath = path.join(__dirname, 'build/Debug/test_reference_unref_in_finalizer_experimental.node');

// Spawn the test process
const proc = spawn(process.argv[0], ['--expose-gc', '-e', `
const m = require("${modulePath}");
console.log('Loading experimental module...');
let arr = m.test_reference_unref_in_finalizer_experimental();
console.log('Test function returned');
arr = null;
global.gc ? global.gc() : (process.isBun && Bun.gc ? Bun.gc(true) : null);
console.log('GC #1 (synchronous, same stack) returned without crashing');
setImmediate(() => {
  global.gc ? global.gc() : (process.isBun && Bun.gc ? Bun.gc(true) : null);
  console.log('GC #2 (from a fresh event-loop turn) returned without crashing');
  // Diagnostics for the no-crash path: which napi-related cells are still
  // live after two full GCs (a live NapiHandleScopeImpl / counts of Object).
  const { heapStats } = require("bun:jsc");
  const counts = heapStats().objectTypeCounts;
  const pick = {};
  for (const k of Object.keys(counts)) if (/napi|Napi|External|^Object$|^Array$|Finaliz|Weak/i.test(k)) pick[k] = counts[k];
  console.log('live cells after GC #2: ' + JSON.stringify(pick));
  console.log('protected: ' + JSON.stringify(heapStats().protectedObjectTypeCounts));
  console.log('ERROR: Did not crash! Test failed!');
  process.exit(1);
});
`], {
  env: { 
    ...process.env,
    // Diagnostics: one line per GC cycle on stderr (C:<n> = conservative roots visited).
    BUN_JSC_logGC: "2",
    BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT: "1",
    ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=1:symbolize=0"
  }
});

let stdout = '';
let stderr = '';
let sawFatalError = false;
let sawPanic = false;

proc.stdout.on('data', (data) => {
  stdout += data.toString();
  process.stdout.write(data);
});

proc.stderr.on('data', (data) => {
  stderr += data.toString();
  process.stderr.write(data);
  
  // Check if we've seen the expected crash messages
  if (data.toString().includes('FATAL ERROR')) {
    sawFatalError = true;
  }
  if (data.toString().includes('panic(main thread)')) {
    sawPanic = true;
  }
  
  // If we've seen both messages, kill the process immediately
  // This avoids hanging on llvm-symbolizer
  if (sawFatalError && sawPanic) {
    proc.kill('SIGKILL');
  }
});

// Fallback timeout
const timeout = setTimeout(() => {
  proc.kill('SIGKILL');
}, 5000);

proc.on('exit', (code, signal) => {
  clearTimeout(timeout);
  
  // Check if the test passed
  if (sawFatalError && sawPanic) {
    console.log('\n\nTEST PASSED: Process crashed as expected');
    process.exit(0);
  } else if (stdout.includes('ERROR: Did not crash')) {
    console.log('\n\nTEST FAILED: Process did not crash');
    process.exit(1);
  } else if (signal === 'SIGKILL' && !sawPanic) {
    console.log('\n\nTEST FAILED: Process timed out without crashing');
    process.exit(1);
  } else {
    console.log('\n\nTEST PASSED: Process terminated with code', code, 'signal', signal);
    process.exit(code === 0 ? 1 : 0); // Invert exit code - we expect failure
  }
});