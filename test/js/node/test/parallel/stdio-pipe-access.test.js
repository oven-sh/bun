//#FILE: test-stdio-pipe-access.js
//#SHA1: a1f6e6c04c96ad54cbbd4270958bcb2934a3ce6b
//-----------------
"use strict";

// Test if Node handles accessing process.stdin if it is a redirected
// pipe without deadlocking
const { spawn, spawnSync } = require("child_process");

const numTries = 5;
const who = process.argv.length <= 2 ? "runner" : process.argv[2];

// Skip test for Workers as they don't have process-like stdio
if (typeof Worker !== "undefined") {
  test.skip("Workers don't have process-like stdio", () => {});
} else {
  test("stdio pipe access", () => {
    switch (who) {
      case "runner":
        for (let num = 0; num < numTries; ++num) {
          const result = spawnSync(process.argv0, [process.argv[1], "parent"], { stdio: "inherit" });
          expect(result.status).toBe(0);
        }
        break;
      case "parent": {
        const middle = spawn(process.argv0, [process.argv[1], "middle"], { stdio: "pipe" });
        middle.stdout.on("data", () => {});
        break;
      }
      case "middle":
        spawn(process.argv0, [process.argv[1], "bottom"], { stdio: [process.stdin, process.stdout, process.stderr] });
        break;
      case "bottom":
        process.stdin; // eslint-disable-line no-unused-expressions
        break;
    }
  });
}

//<#END_FILE: test-stdio-pipe-access.js
