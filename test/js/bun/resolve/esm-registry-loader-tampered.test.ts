import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The ESM registry map lazy initializer reads `globalThis.Loader.registry`.
// User code can replace or delete `Loader`, and `globalThis` can have a Proxy
// in its prototype chain whose `has` trap throws. These used to hit a debug
// assertion / null deref / bad jsCast instead of propagating a JS error.

test.concurrent("require() when globalThis prototype has a throwing `has` trap", async () => {
  using dir = tempDir("esm-registry-proxy-has", {
    "mod.js": "module.exports = 1;",
    "entry.js": `
      const orig = Object.getPrototypeOf(globalThis);
      Object.setPrototypeOf(globalThis, new Proxy(orig, {
        has(target, key) { throw new TypeError("has trap threw"); },
      }));
      delete globalThis.Loader;
      try {
        require("./mod.js");
        process.stdout.write("OK\\n");
      } catch (e) {
        process.stdout.write("caught: " + e.message + "\\n");
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("caught: has trap threw\n");
  expect(exitCode).toBe(0);
});

test.concurrent("require() when globalThis.Loader is overwritten with a non-object", async () => {
  using dir = tempDir("esm-registry-loader-primitive", {
    "mod.js": "module.exports = 1;",
    "entry.js": `
      globalThis.Loader = 5;
      require("./mod.js");
      process.stdout.write("OK\\n");
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});

test.concurrent("require() when globalThis.Loader.registry is not a Map", async () => {
  using dir = tempDir("esm-registry-not-a-map", {
    "mod.js": "module.exports = 1;",
    "entry.js": `
      globalThis.Loader = { registry: 5 };
      require("./mod.js");
      process.stdout.write("OK\\n");
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});

test.concurrent("require() when globalThis.Loader has a throwing `registry` getter", async () => {
  using dir = tempDir("esm-registry-throwing-getter", {
    "mod.js": "module.exports = 1;",
    "entry.js": `
      globalThis.Loader = { get registry() { throw new TypeError("getter threw"); } };
      try {
        require("./mod.js");
        process.stdout.write("OK\\n");
      } catch (e) {
        process.stdout.write("caught: " + e.message + "\\n");
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("caught: getter threw\n");
  expect(exitCode).toBe(0);
});
