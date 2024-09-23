//#FILE: test-v8-flag-pool-size-0.js
//#SHA1: 32e0b30d9305b4bf5509c6061176b2f87c47c66d
//-----------------
// Flags: --v8-pool-size=0 --expose-gc

"use strict";

// This test doesn't require any specific assertions or expectations.
// It's primarily checking that the process doesn't crash or hang when
// running with the specified flags.

test("V8 tasks scheduled by GC are handled on worker threads with --v8-pool-size=0", () => {
  // This verifies that V8 tasks scheduled by GC are handled on worker threads if
  // `--v8-pool-size=0` is given. The worker threads are managed by Node.js'
  // `v8::Platform` implementation.

  // Trigger garbage collection
  globalThis.gc();

  // If we've reached this point without crashing or hanging, the test is successful
  expect(true).toBe(true);
});

//<#END_FILE: test-v8-flag-pool-size-0.js
