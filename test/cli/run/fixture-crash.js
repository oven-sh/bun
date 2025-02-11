let crash_handler;
try {
  crash_handler = require("bun:internal-for-testing").crash_handler;
} catch {
  console.error("This version of bun does not have internal-for-testing exposed");
  console.error("BUN_GARBAGE_COLLECTOR_LEVEL=0 BUN_FEATURE_FLAG_INTERNALS_FOR_TESTING=1 bun");
  process.exit(1);
}

const approach = process.argv[2];
if (approach in crash_handler) {
  crash_handler[approach]();
} else {
  console.error("usage: bun fixture-crash.js <segfault|panic|rootError|outOfMemory|raiseIgnoringPanicHandler>");
}
