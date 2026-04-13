// https://github.com/oven-sh/bun/issues/29253
//
// `new Module(id, parent)` produced an instance whose prototype
// did not expose `Module.prototype.load(filename)`, so packages
// that construct a module by hand and then call `.load()` on it
// (the same pattern Node's internal cjs loader uses) threw:
//
//   TypeError: targetModule.load is not a function
//
// `requizzle` — a dependency of `jsdoc` — does exactly this
// inside its `exports.load` helper, so `bun run .../jsdoc.js`
// crashed before jsdoc got a chance to run.
//
// The fix adds `Module.prototype.load` as a real method on the
// prototype shared by instances created via `new Module(...)`
// and unifies `require("module").prototype` with that same
// prototype, so patching one is reflected in the other (Node
// semantics).
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import Module from "node:module";

test("Module.prototype.load is a function (#29253)", () => {
  // The one the ticket is about: the stub on the instance prototype.
  expect(typeof Module.prototype.load).toBe("function");

  // An instance created via `new Module(...)` must inherit `.load`.
  const m = new Module("/tmp/does-not-matter-29253.js", null);
  expect(typeof m.load).toBe("function");
});

test("Module.prototype is the instance prototype (#29253)", () => {
  // Node guarantees these are the same object — so patching
  // `Module.prototype.foo` is visible on every instance. Several
  // libraries (next.js, requizzle, etc.) rely on this.
  const m = new Module("/tmp/does-not-matter-29253-proto.js", null);
  expect(Object.getPrototypeOf(m)).toBe(Module.prototype);
});

test("new Module().load(filename) reads and evaluates the file (#29253)", async () => {
  // Spawn a separate Bun so the test doesn't pollute its own
  // require cache or Module.wrap state.
  using dir = tempDir("issue-29253-load", {
    "target.js": `
      module.exports = { answer: 42, filename: __filename, dirname: __dirname };
    `,
    "driver.js": `
      const Module = require("node:module");
      const path = require("node:path");
      const target = path.resolve(__dirname, "target.js");

      const m = new Module(target, module);
      m.load(target);

      // After load(): the file has been read, wrapped, and
      // executed. The module's exports must be the object the
      // file assigned to module.exports, and the bookkeeping
      // fields must be populated the way Node does.
      console.log(JSON.stringify({
        loaded: m.loaded,
        filename: m.filename,
        exports: m.exports,
      }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "driver.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("TypeError");
  expect(stderr).not.toContain("Error");
  expect(exitCode).toBe(0);

  const result = JSON.parse(stdout.trim());
  expect(result.loaded).toBe(true);
  expect(result.filename).toMatch(/target\.js$/);
  expect(result.exports.answer).toBe(42);
  expect(result.exports.filename).toBe(result.filename);
});

test("Module.prototype.load honors an overridden Module.wrapper (#29253)", async () => {
  // `load()` must compile the file through the CURRENT module
  // wrapper (`Module.wrapper[0] + source + Module.wrapper[1]`)
  // — not a hard-coded one. Mutating the wrapper array is how
  // Bun exposes Node's wrapper-override hook.
  using dir = tempDir("issue-29253-wrap", {
    "target.js": `module.exports = { wrappedVar: typeof __swizzled };`,
    "driver.js": `
      const Module = require("node:module");
      const path = require("node:path");
      const originalWrapper0 = Module.wrapper[0];

      // Inject a local 'const __swizzled = 1;' at the top of
      // the module scope; if the wrapper is honored, the module
      // sees typeof __swizzled === "number".
      Module.wrapper[0] = originalWrapper0 + "const __swizzled = 1;\\n";

      try {
        const target = path.resolve(__dirname, "target.js");
        const m = new Module(target, module);
        m.load(target);
        console.log(m.exports.wrappedVar);
      } finally {
        Module.wrapper[0] = originalWrapper0;
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "driver.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("TypeError");
  expect(stderr).not.toContain("ReferenceError");
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("number");
});

test("new Module().load populates filename/paths/loaded (#29253)", async () => {
  // Node's `Module.prototype.load` writes `filename`, `paths`,
  // and `loaded` before returning. `requizzle` and any other
  // package that reads those fields after `.load()` depends on
  // this, even if it doesn't touch the wrapper.
  using dir = tempDir("issue-29253-fields", {
    "leaf.js": `module.exports = 'ok';`,
    "driver.js": `
      const Module = require("node:module");
      const path = require("node:path");

      const target = path.resolve(__dirname, "leaf.js");
      const m = new Module(target, module);

      // Pre-load state: loaded=false, no filename.
      if (m.loaded !== false) throw new Error("pre-load 'loaded' should be false, got " + m.loaded);

      m.load(target);

      if (m.loaded !== true) throw new Error("post-load 'loaded' should be true");
      if (m.filename !== target) throw new Error("filename mismatch: " + m.filename);
      if (!Array.isArray(m.paths)) throw new Error("paths should be an array");
      if (m.exports !== 'ok') throw new Error("exports mismatch: " + m.exports);
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "driver.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("TypeError");
  expect(stderr).not.toContain("Error:");
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("ok");
});
