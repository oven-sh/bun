//#FILE: test-stdin-from-file-spawn.js
//#SHA1: 1f8f432985d08b841ebb2c8142b865ae417737a1
//-----------------
"use strict";

const process = require("process");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

let defaultShell;
if (process.platform === "linux" || process.platform === "darwin") {
  defaultShell = "/bin/sh";
} else if (process.platform === "win32") {
  defaultShell = "cmd.exe";
} else {
  it.skip("This test exists only on Linux/Win32/OSX", () => {});
}

if (defaultShell) {
  test("stdin from file spawn", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));
    const tmpCmdFile = path.join(tmpDir, "test-stdin-from-file-spawn-cmd");
    const tmpJsFile = path.join(tmpDir, "test-stdin-from-file-spawn.js");

    fs.writeFileSync(tmpCmdFile, "echo hello");
    fs.writeFileSync(
      tmpJsFile,
      `
    'use strict';
    const { spawn } = require('child_process');
    // Reference the object to invoke the getter
    process.stdin;
    setTimeout(() => {
      let ok = false;
      const child = spawn(process.env.SHELL || '${defaultShell}',
        [], { stdio: ['inherit', 'pipe'] });
      child.stdout.on('data', () => {
        ok = true;
      });
      child.on('close', () => {
        process.exit(ok ? 0 : -1);
      });
    }, 100);
    `,
    );

    expect(() => {
      execSync(`${process.argv[0]} ${tmpJsFile} < ${tmpCmdFile}`);
    }).not.toThrow();

    // Clean up
    fs.unlinkSync(tmpCmdFile);
    fs.unlinkSync(tmpJsFile);
    fs.rmdirSync(tmpDir);
  });
}

//<#END_FILE: test-stdin-from-file-spawn.js
