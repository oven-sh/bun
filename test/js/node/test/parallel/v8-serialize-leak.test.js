//#FILE: test-v8-serialize-leak.js
//#SHA1: f1b10774a48610a130cac36679953f9af1ed15e1
//-----------------
"use strict";
// Flags: --expose-gc

const v8 = require("v8");

// On IBMi, the rss memory always returns zero
if (process.platform === "os400") {
  test.skip("On IBMi, the rss memory always returns zero");
}

test("v8.serialize should not leak memory", async () => {
  const before = process.memoryUsage.rss();

  for (let i = 0; i < 1000000; i++) {
    v8.serialize("");
  }

  async function gcUntil(message, condition) {
    for (let i = 0; i < 10; i++) {
      global.gc();
      await new Promise(resolve => setTimeout(resolve, 100));
      if (condition()) {
        return;
      }
    }
    throw new Error(`${message} failed to be true in time`);
  }

  await gcUntil("RSS should go down", () => {
    const after = process.memoryUsage.rss();
    if (process.env.ASAN_OPTIONS) {
      console.log(`ASan: before=${before} after=${after}`);
      return after < before * 10;
    } else if (process.config.variables.node_builtin_modules_path) {
      console.log(`node_builtin_modules_path: before=${before} after=${after}`);
      return after < before * 10;
    }
    console.log(`before=${before} after=${after}`);
    return after < before * 10;
  });
});

//<#END_FILE: test-v8-serialize-leak.js
