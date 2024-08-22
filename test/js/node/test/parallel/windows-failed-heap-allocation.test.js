//#FILE: test-windows-failed-heap-allocation.js
//#SHA1: 1d7392892062d768702132ac5dc0f74ecdf78dbb
//-----------------
"use strict";

// This test ensures that an out of memory error exits with code 134 on Windows

if (process.platform !== "win32") {
  test.skip("Windows-only test", () => {});
} else {
  const { exec } = require("child_process");
  const path = require("path");
  const os = require("os");

  function heapBomb() {
    // Heap bomb, imitates a memory leak quickly
    const fn = nM => [...Array(nM)].map(i => fn(nM * 2));
    fn(2);
  }

  test("out of memory error exits with code 134 on Windows", () => {
    // Run child in tmpdir to avoid report files in repo
    const tmpdir = os.tmpdir();

    // --max-old-space-size=3 is the min 'old space' in V8, explodes fast
    const cmd = `"${process.execPath}" --max-old-space-size=30 "${__filename}"`;

    return new Promise(resolve => {
      exec(`${cmd} heapBomb`, { cwd: tmpdir }, (err, stdout, stderr) => {
        const msg = `Wrong exit code of ${err.code}! Expected 134 for abort`;
        // Note: common.nodeProcessAborted() is not asserted here because it
        // returns true on 134 as well as 0x80000003 (V8's base::OS::Abort)
        expect(err.code).toBe(134);
        resolve();
      });
    });
  });

  if (process.argv[2] === "heapBomb") {
    heapBomb();
  }
}

//<#END_FILE: test-windows-failed-heap-allocation.js
