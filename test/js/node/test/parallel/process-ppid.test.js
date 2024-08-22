//#FILE: test-process-ppid.js
//#SHA1: 0d416dc7ff2171badfd44d5636348e2fba3445f8
//-----------------
"use strict";

const cp = require("child_process");

if (process.argv[2] === "child") {
  // The following console.log() call is part of the test's functionality.
  console.log(process.ppid);
} else {
  test("process.ppid in child process", () => {
    const child = cp.spawnSync(process.execPath, [__filename, "child"]);

    expect(child.status).toBe(0);
    expect(child.signal).toBeNull();
    expect(Number(child.stdout.toString().trim())).toBe(process.pid);
    expect(child.stderr.toString().trim()).toBe("");
  });
}

//<#END_FILE: test-process-ppid.js
