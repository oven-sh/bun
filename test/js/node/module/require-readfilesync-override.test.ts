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

async function run(files: Record<string, string>, entry: string) {
  using dir = tempDir("fs-readfilesync-override", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("require() reads module source through fs.readFileSync", () => {
  test("a replaced fs.readFileSync supplies the source for require()", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
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
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ result: "PATCHED", calls: 1 });
    expect(exitCode).toBe(0);
  });

  test("restoring the original fs.readFileSync returns to native reads", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
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
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["PATCHED", "ORIGINAL"]);
    expect(exitCode).toBe(0);
  });

  test("JSON modules are read through the override (string and Buffer returns)", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "main.cjs": `
          const fs = require('fs');
          const path = require('path');
          const a = path.join(__dirname, 'a.json');
          const b = path.join(__dirname, 'b.json');
          const origReadFileSync = fs.readFileSync;
          fs.readFileSync = function (...args) {
            if (args[0] === a) return '{"patched": "string"}';
            if (args[0] === b) return Buffer.from('{"patched": "buffer"}');
            return origReadFileSync(...args);
          };
          try {
            console.log(JSON.stringify([require(a), require(b)]));
          } finally {
            fs.readFileSync = origReadFileSync;
          }
        `,
        "a.json": `{"original": true}`,
        "b.json": `{"original": true}`,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([{ patched: "string" }, { patched: "buffer" }]);
    expect(exitCode).toBe(0);
  });

  test("errors thrown from the override propagate to require()", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
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
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("caught: boom");
    expect(exitCode).toBe(0);
  });

  test("a non-string, non-Buffer return is a TypeError rather than a silent disk read", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "main.cjs": `
          const fs = require('fs');
          const path = require('path');
          const targetPath = path.join(__dirname, 'target.js');
          const origReadFileSync = fs.readFileSync;
          fs.readFileSync = function (...args) {
            if (args[0] === targetPath) return 42;
            return origReadFileSync(...args);
          };
          try {
            require(targetPath);
            console.log('FAIL: evaluated disk source');
          } catch (e) {
            console.log('caught: ' + e.constructor.name);
          } finally {
            fs.readFileSync = origReadFileSync;
          }
        `,
        "target.js": `module.exports = "ORIGINAL";`,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("caught: TypeError");
    expect(exitCode).toBe(0);
  });

  // The volar.js pattern that vue-tsc uses: replace fs.readFileSync with a
  // wrapper that transforms a specific file, require() it, then restore.
  test("the vue-tsc/volar runTsc pattern sees the transformed source", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
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
      },
      "runTsc.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([".ts", ".tsx", ".js", ".vue"]);
    expect(exitCode).toBe(0);
  });

  test("the override fires once per require when Module._extensions['.js'] is wrapped", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "main.cjs": `
          const fs = require('fs');
          const path = require('path');
          const Module = require('module');
          const targetPath = path.join(__dirname, 'target.js');
          const origReadFileSync = fs.readFileSync;
          let calls = 0;
          fs.readFileSync = function (...args) {
            if (args[0] === targetPath) {
              calls++;
              return 'module.exports = "VIA-EXTENSION";';
            }
            return origReadFileSync(...args);
          };
          const origJs = Module._extensions['.js'];
          Module._extensions['.js'] = function (mod, filename) {
            return origJs(mod, filename);
          };
          try {
            delete require.cache[targetPath];
            console.log(JSON.stringify({ result: require(targetPath), calls }));
          } finally {
            fs.readFileSync = origReadFileSync;
            Module._extensions['.js'] = origJs;
          }
        `,
        "target.js": `module.exports = "ORIGINAL";`,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ result: "VIA-EXTENSION", calls: 1 });
    expect(exitCode).toBe(0);
  });

  test("installing via Object.defineProperty is observed too", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "main.cjs": `
          const fs = require('fs');
          const path = require('path');
          const targetPath = path.join(__dirname, 'target.js');
          const origReadFileSync = fs.readFileSync;
          Object.defineProperty(fs, 'readFileSync', {
            value(...args) {
              if (args[0] === targetPath) return 'module.exports = "DEFINED";';
              return origReadFileSync(...args);
            },
            writable: true, configurable: true, enumerable: true,
          });
          try {
            console.log(require(targetPath));
          } finally {
            fs.readFileSync = origReadFileSync;
          }
        `,
        "target.js": `module.exports = "ORIGINAL";`,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("DEFINED");
    expect(exitCode).toBe(0);
  });

  test("fs.readFileSync is a writable data property and spyOn round-trips", async () => {
    using dir = tempDir("fs-readfilesync-spy", {
      "spy.test.cjs": `
        const { test, expect, spyOn } = require('bun:test');
        const fs = require('fs');
        test('descriptor and spyOn', () => {
          const d = Object.getOwnPropertyDescriptor(fs, 'readFileSync');
          expect(d.enumerable).toBe(true);
          expect(d.writable).toBe(true);
          expect('value' in d).toBe(true);
          const orig = fs.readFileSync;
          const spy = spyOn(fs, 'readFileSync');
          expect(fs.readFileSync).not.toBe(orig);
          spy.mockRestore();
          expect(fs.readFileSync).toBe(orig);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "spy.test.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
    void stdout;
  });
});
