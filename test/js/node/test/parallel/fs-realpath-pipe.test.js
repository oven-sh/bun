//#FILE: test-fs-realpath-pipe.js
//#SHA1: 2a876967f5134cd77e2214f2abcbf753d46983cf
//-----------------
"use strict";

const { spawnSync } = require("child_process");

// Skip test for Windows, AIX, and IBMi
const isSkippedPlatform = ["win32", "aix", "os400"].includes(process.platform);
const testName = `No /dev/stdin on ${process.platform}.`;

(isSkippedPlatform ? test.skip : test)(testName, () => {
  const testCases = [
    `require('fs').realpath('/dev/stdin', (err, resolvedPath) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      if (resolvedPath) {
        process.exit(2);
      }
    });`,
    `try {
      if (require('fs').realpathSync('/dev/stdin')) {
        process.exit(2);
      }
    } catch (e) {
      console.error(e);
      process.exit(1);
    }`,
  ];

  for (const code of testCases) {
    const child = spawnSync(process.execPath, ["-e", code], {
      stdio: "pipe",
    });

    if (child.status !== 2) {
      console.log(code);
      console.log(child.stderr.toString());
    }

    expect(child.status).toBe(2);
  }
});

//<#END_FILE: test-fs-realpath-pipe.js
