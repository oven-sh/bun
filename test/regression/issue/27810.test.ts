import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27810
// When dynamically importing a CJS module with __esModule marker,
// .default should be module.exports (matching Node.js), not the
// unwrapped exports.default value.

test.concurrent("dynamic import of CJS with __esModule gives module.exports as default", async () => {
  using dir = tempDir("issue-27810", {
    "config.cjs": `
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      function loadConfig(phase, dir, opts) {
        return { phase, dir };
      }
      Object.defineProperty(exports, "default", {
        enumerable: true,
        get: function() { return loadConfig; }
      });
    `,
    "test.mjs": `
      const mod = await import('./config.cjs');
      const results = {
        defaultType: typeof mod.default,
        defaultIsObject: typeof mod.default === 'object' && mod.default !== null,
        defaultDefaultType: typeof mod.default?.default,
        defaultDefaultIsFunction: typeof mod.default?.default === 'function',
      };
      console.log(JSON.stringify(results));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const results = JSON.parse(stdout.trim());

  // .default should be the module.exports object (matching Node.js)
  expect(results.defaultType).toBe("object");
  expect(results.defaultIsObject).toBe(true);

  // .default.default should be the loadConfig function
  expect(results.defaultDefaultType).toBe("function");
  expect(results.defaultDefaultIsFunction).toBe(true);

  expect(exitCode).toBe(0);
});

test.concurrent("static import of CJS with __esModule gives module.exports as default", async () => {
  using dir = tempDir("issue-27810-static", {
    "config.cjs": `
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      function loadConfig(phase, dir) {
        return { phase, dir };
      }
      Object.defineProperty(exports, "default", {
        enumerable: true,
        get: function() { return loadConfig; }
      });
      exports.otherExport = 42;
    `,
    "test.mjs": `
      import config from './config.cjs';
      const results = {
        defaultType: typeof config,
        defaultIsObject: typeof config === 'object' && config !== null,
        hasDefault: 'default' in config,
        defaultDefaultType: typeof config?.default,
        hasOtherExport: 'otherExport' in config,
      };
      console.log(JSON.stringify(results));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const results = JSON.parse(stdout.trim());

  // default import should be the module.exports object
  expect(results.defaultType).toBe("object");
  expect(results.defaultIsObject).toBe(true);
  expect(results.hasDefault).toBe(true);
  expect(results.defaultDefaultType).toBe("function");
  expect(results.hasOtherExport).toBe(true);

  expect(exitCode).toBe(0);
});

test.concurrent("CJS without __esModule still gives module.exports as default", async () => {
  using dir = tempDir("issue-27810-no-marker", {
    "config.cjs": `
      function loadConfig(phase, dir) {
        return { phase, dir };
      }
      module.exports = loadConfig;
    `,
    "test.mjs": `
      const mod = await import('./config.cjs');
      const results = {
        defaultType: typeof mod.default,
        defaultIsFunction: typeof mod.default === 'function',
      };
      console.log(JSON.stringify(results));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const results = JSON.parse(stdout.trim());

  // .default should be the function (which is module.exports)
  expect(results.defaultType).toBe("function");
  expect(results.defaultIsFunction).toBe(true);

  expect(exitCode).toBe(0);
});
