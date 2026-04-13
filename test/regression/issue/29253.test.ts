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
// prototype backing `new Module(...)` instances, and also puts it
// on `require("module").prototype` so Node-compat property lookups
// see a function in both places. (The two objects are still
// distinct — full prototype unification is deferred because the
// existing `_compile` CustomAccessor depends on the instance cast.)
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import Module from "node:module";

test("new Module() instances inherit load() (#29253)", () => {
  // The ticket: `targetModule.load(targetModule.id)` on a freshly
  // constructed Module was throwing "load is not a function" because
  // the instance prototype had no `load` method.
  const m = new Module("/tmp/does-not-matter-29253.js", null);
  expect(typeof m.load).toBe("function");

  // And it should be inherited from the prototype chain, not an own
  // property on every instance (which would be wasteful).
  expect(Object.prototype.hasOwnProperty.call(m, "load")).toBe(false);
  expect(typeof Object.getPrototypeOf(m).load).toBe("function");

  // `require("module").prototype` is a separate disposable object from
  // the instance prototype (see the header comment). It also needs to
  // expose `load` so code that does `typeof Module.prototype.load` or
  // `Module.prototype.load = wrapper` sees a function. If the C++
  // registration in getModulePrototypeObject were reverted, the other
  // assertions above would still pass — so guard that code path too.
  expect(typeof Module.prototype.load).toBe("function");
});

test.concurrent("new Module().load(filename) reads and evaluates the file (#29253)", async () => {
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.loaded).toBe(true);
  expect(result.filename).toMatch(/target\.js$/);
  expect(result.exports.answer).toBe(42);
  expect(result.exports.filename).toBe(result.filename);
  expect(exitCode).toBe(0);
});

test.concurrent("Module.prototype.load honors an overridden Module.wrapper (#29253)", async () => {
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("number");
  expect(exitCode).toBe(0);
});

test.concurrent("new Module().load populates filename/paths/loaded (#29253)", async () => {
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
      // paths must come from Module._nodeModulePaths(dirname(filename)).
      const expectedPaths = Module._nodeModulePaths(path.dirname(target));

      // Pre-load state: loaded=false, no filename.
      if (m.loaded !== false) throw new Error("pre-load 'loaded' should be false, got " + m.loaded);

      m.load(target);

      if (m.loaded !== true) throw new Error("post-load 'loaded' should be true");
      if (m.filename !== target) throw new Error("filename mismatch: " + m.filename);
      if (JSON.stringify(m.paths) !== JSON.stringify(expectedPaths)) {
        throw new Error("paths mismatch: " + JSON.stringify(m.paths) + " vs " + JSON.stringify(expectedPaths));
      }
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

// Retry guard: a thrown extension handler must NOT leave the module
// permanently marked `loaded`, otherwise the next `.load(...)` call on
// the same instance would hit the "Module already loaded" assert and
// make failure recovery impossible.
test.concurrent("failed load() clears loaded so the instance can be retried (#29253)", async () => {
  using dir = tempDir("issue-29253-retry", {
    "broken.js": `throw new Error("boom");`,
    "good.js": `module.exports = 'good-exports';`,
    "driver.js": `
      const Module = require("node:module");
      const path = require("node:path");

      const broken = path.resolve(__dirname, "broken.js");
      const good = path.resolve(__dirname, "good.js");
      const m = new Module(broken, module);

      let threw = false;
      try {
        m.load(broken);
      } catch (e) {
        threw = true;
        if (!String(e).includes("boom")) throw new Error("unexpected error: " + e);
      }
      if (!threw) throw new Error("expected load() to throw");
      if (m.loaded) throw new Error("loaded should be false after a failed load()");

      // Now reuse the instance with a good file — must not hit the
      // "Module already loaded" guard.
      m.load(good);
      if (m.exports !== 'good-exports') throw new Error("retry exports mismatch: " + m.exports);
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

// Compound-extension dispatch: `Module._extensions['.test.js']` must win
// over `Module._extensions['.js']` when `.load()` is called on a file
// ending in `.test.js`. `path.extname` alone would return `.js` and
// silently bypass the compound handler.
test.concurrent("load() picks the longest registered extension handler (#29253)", async () => {
  using dir = tempDir("issue-29253-ext", {
    "foo.test.js": `module.exports = 'raw-source-never-loaded';`,
    "driver.js": `
      const Module = require("node:module");
      const path = require("node:path");

      const target = path.resolve(__dirname, "foo.test.js");
      Module._extensions['.test.js'] = function (module, filename) {
        module.exports = { hookedBy: '.test.js', filename };
      };

      try {
        const m = new Module(target, module);
        m.load(target);
        if (m.exports.hookedBy !== '.test.js') {
          throw new Error("handler not used; exports=" + JSON.stringify(m.exports));
        }
      } finally {
        delete Module._extensions['.test.js'];
      }
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
