// Test script that runs the experimental module test with a timeout
const { spawn } = require('child_process');
const path = require('path');

const modulePath = path.join(__dirname, 'build/Debug/test_reference_unref_in_finalizer_experimental.node');

// Spawn the test process
const proc = spawn(process.argv[0], ['--expose-gc', '-e', `
const m = require(${JSON.stringify(modulePath)});
console.log('Loading experimental module...');
function makeGarbage() {
  let arr = m.test_reference_unref_in_finalizer_experimental();
  arr = null;
}
async function main() {
  // Collection of any particular object is not guaranteed under JSC: a
  // conservative stack/register scan can pin an address for the whole
  // process, and a pinned array keeps every finalizer object alive no matter
  // how many more GCs run. Retry with freshly allocated objects instead
  // (same approach as tryGcUntil in module.js); collecting any one of them
  // crashes as expected.
  for (let attempt = 0; attempt < 5; attempt++) {
    makeGarbage();
    for (let i = 0; i < 3; i++) {
      // Hop to a new task so the GC runs from a shallow stack.
      await new Promise(resolve => setTimeout(resolve, 1));
      global.gc ? global.gc() : Bun.gc(true);
    }
  }
  console.log('ERROR: Did not crash! Test failed!');
  process.exit(1);
}
main();
`], {
  env: { 
    ...process.env,
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

  // Check the accumulated output, not the chunk: the crash handler emits
  // "panic" and "(main thread)" as separate writes, so a marker can span
  // chunk boundaries.
  if (stderr.includes('FATAL ERROR')) {
    sawFatalError = true;
  }
  if (stderr.includes('panic(main thread)')) {
    sawPanic = true;
  }
  
  // If we've seen both messages, kill the process immediately
  // This avoids hanging on llvm-symbolizer
  if (sawFatalError && sawPanic) {
    proc.kill('SIGKILL');
  }
});

// Fallback timeout. The no-crash path runs up to 15 GCs across task hops,
// which needs headroom on slow (debug/ASAN) builds.
const timeout = setTimeout(() => {
  proc.kill('SIGKILL');
}, 10_000);

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