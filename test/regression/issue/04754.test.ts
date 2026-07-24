// https://github.com/oven-sh/bun/issues/4754
//
// Node's CJS loader reads module source through the public
// `fs.readFileSync` property, so monkey-patching it is a de-facto hook into
// require(). vue-tsc (via volar.js) relies on this to rewrite
// `typescript/lib/tsc.js` before it is evaluated. Bun previously read module
// source natively and bypassed the patched function, so the unmodified source
// was evaluated and vue-tsc fell back to plain tsc behavior.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("require() reads module source through fs.readFileSync", () => {
  test("a replaced fs.readFileSync supplies the source for require()", async () => {
    using dir = tempDir("fs-readfilesync-require-hook", {
      "main.cjs": `
        const fs = require('fs');
        const path = require('path');
        const targetPath = path.join(__dirname, 'target.js');
        const origReadFileSync = fs.readFileSync;
        let calls = 0;
        fs.readFileSync = function (...args) {
          if (args[0] === targetPath) {
            calls++;
            return 'module.exports = "PATCHED";';
          }
          return origReadFileSync(...args);
        };
        try {
          const result = require(targetPath);
          console.log(JSON.stringify({ result, calls }));
        } finally {
          fs.readFileSync = origReadFileSync;
        }
      `,
      "target.js": `module.exports = "ORIGINAL";`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ result: "PATCHED", calls: 1 });
    expect(exitCode).toBe(0);
  });

  test("restoring the original fs.readFileSync returns to native reads", async () => {
    using dir = tempDir("fs-readfilesync-restore", {
      "main.cjs": `
        const fs = require('fs');
        const path = require('path');
        const targetPath = path.join(__dirname, 'target.js');
        const origReadFileSync = fs.readFileSync;
        const out = [];
        fs.readFileSync = function (...args) {
          if (args[0] === targetPath) return 'module.exports = "PATCHED";';
          return origReadFileSync(...args);
        };
        delete require.cache[targetPath];
        out.push(require(targetPath));
        fs.readFileSync = origReadFileSync;
        delete require.cache[targetPath];
        out.push(require(targetPath));
        console.log(JSON.stringify(out));
      `,
      "target.js": `module.exports = "ORIGINAL";`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["PATCHED", "ORIGINAL"]);
    expect(exitCode).toBe(0);
  });

  test("JSON modules are read through the override too", async () => {
    using dir = tempDir("fs-readfilesync-json", {
      "main.cjs": `
        const fs = require('fs');
        const path = require('path');
        const targetPath = path.join(__dirname, 'target.json');
        const origReadFileSync = fs.readFileSync;
        fs.readFileSync = function (...args) {
          if (args[0] === targetPath) return '{"patched": true}';
          return origReadFileSync(...args);
        };
        try {
          console.log(JSON.stringify(require(targetPath)));
        } finally {
          fs.readFileSync = origReadFileSync;
        }
      `,
      "target.json": `{"original": true}`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ patched: true });
    expect(exitCode).toBe(0);
  });

  test("errors thrown from the override propagate to require()", async () => {
    using dir = tempDir("fs-readfilesync-throw", {
      "main.cjs": `
        const fs = require('fs');
        const path = require('path');
        const targetPath = path.join(__dirname, 'target.js');
        const origReadFileSync = fs.readFileSync;
        fs.readFileSync = function (...args) {
          if (args[0] === targetPath) throw new Error('boom');
          return origReadFileSync(...args);
        };
        try {
          require(targetPath);
          console.log('FAIL');
        } catch (e) {
          console.log('caught: ' + e.message);
        } finally {
          fs.readFileSync = origReadFileSync;
        }
      `,
      "target.js": `module.exports = 1;`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("caught: boom");
    expect(exitCode).toBe(0);
  });

  // The volar.js pattern that vue-tsc uses: replace fs.readFileSync with a
  // wrapper that transforms a specific file, require() it, then restore.
  test("the vue-tsc/volar runTsc pattern sees the transformed source", async () => {
    using dir = tempDir("fs-readfilesync-volar", {
      "runTsc.cjs": `
        const fs = require('fs');
        const path = require('path');
        const tscPath = path.join(__dirname, 'fake-tsc.js');
        const readFileSync = fs.readFileSync;
        fs.readFileSync = (...args) => {
          if (args[0] === tscPath) {
            let tsc = readFileSync(...args);
            return tsc.replace(
              /supportedExtensions = \\[.*?\\]/,
              s => s.slice(0, -1) + ', ".vue"]',
            );
          }
          return readFileSync(...args);
        };
        try {
          const result = require(tscPath);
          console.log(JSON.stringify(result.supportedExtensions));
        } finally {
          fs.readFileSync = readFileSync;
          delete require.cache[tscPath];
        }
      `,
      "fake-tsc.js": `
        var supportedExtensions = [".ts", ".tsx", ".js"];
        module.exports = { supportedExtensions };
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "runTsc.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([".ts", ".tsx", ".js", ".vue"]);
    expect(exitCode).toBe(0);
  });

  test("Module._extensions['.js'] (the built-in loader) reads through the override", async () => {
    using dir = tempDir("fs-readfilesync-builtin-loader", {
      "main.cjs": `
        const fs = require('fs');
        const path = require('path');
        const Module = require('module');
        const targetPath = path.join(__dirname, 'target.js');
        const origReadFileSync = fs.readFileSync;
        fs.readFileSync = function (...args) {
          if (args[0] === targetPath) return 'module.exports = "VIA-EXTENSION";';
          return origReadFileSync(...args);
        };
        const origJs = Module._extensions['.js'];
        Module._extensions['.js'] = function (mod, filename) {
          return origJs(mod, filename);
        };
        try {
          delete require.cache[targetPath];
          console.log(require(targetPath));
        } finally {
          fs.readFileSync = origReadFileSync;
          Module._extensions['.js'] = origJs;
        }
      `,
      "target.js": `module.exports = "ORIGINAL";`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("VIA-EXTENSION");
    expect(exitCode).toBe(0);
  });
});
