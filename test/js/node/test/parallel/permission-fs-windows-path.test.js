//#FILE: test-permission-fs-windows-path.js
//#SHA1: 300fb201fb37d1318e399c93b93842966f85ab9a
//-----------------
// Flags: --experimental-permission --allow-fs-read=* --allow-child-process
"use strict";

const { spawnSync } = require("child_process");

if (process.platform !== "win32") {
  test.skip("windows UNC path test", () => {});
} else {
  test("fs write permission on Windows paths", () => {
    const { stdout, status } = spawnSync(process.execPath, [
      "--experimental-permission",
      "--allow-fs-write",
      "C:\\\\",
      "-e",
      'console.log(process.permission.has("fs.write", "C:\\\\"))',
    ]);
    expect(stdout.toString()).toBe("true\n");
    expect(status).toBe(0);
  });

  test("fs write permission on Windows UNC paths", () => {
    const { stdout, status, stderr } = spawnSync(process.execPath, [
      "--experimental-permission",
      '--allow-fs-write="\\\\?\\C:\\"',
      "-e",
      'console.log(process.permission.has("fs.write", "C:\\\\"))',
    ]);
    expect(stdout.toString()).toBe("false\n");
    expect(status).toBe(0);
    expect(stderr.toString()).toBe("");
  });

  test("fs write permission on Windows paths using toNamespacedPath", () => {
    const { stdout, status, stderr } = spawnSync(process.execPath, [
      "--experimental-permission",
      "--allow-fs-write",
      "C:\\",
      "-e",
      `const path = require('path');
       console.log(process.permission.has('fs.write', path.toNamespacedPath('C:\\\\')))`,
    ]);
    expect(stdout.toString()).toBe("true\n");
    expect(status).toBe(0);
    expect(stderr.toString()).toBe("");
  });
}

//<#END_FILE: test-permission-fs-windows-path.js
