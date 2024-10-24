//#FILE: test-process-really-exit.js
//#SHA1: ad12d9cd84340ccf30df102407fc23cdc83801f0
//-----------------
"use strict";

const { spawnSync } = require("child_process");

if (process.argv[2] === "subprocess") {
  process.reallyExit = function () {
    console.info("really exited");
  };
  process.exit();
} else {
  test("reallyExit hook is executed", () => {
    // Ensure that the reallyExit hook is executed.
    // see: https://github.com/nodejs/node/issues/25650
    const out = spawnSync(process.execPath, [__filename, "subprocess"]);
    const observed = out.output[1].toString("utf8").trim();
    expect(observed).toBe("really exited");
  });
}

//<#END_FILE: test-process-really-exit.js
