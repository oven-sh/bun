// https://github.com/oven-sh/bun/issues/29253
// `new Module(id, parent).load(filename)` threw "m.load is not a function"
// because the instance prototype lacked `load` (and `isPreloading`). Packages
// like requizzle/jsdoc and import-fresh hit this.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import Module from "node:module";

test("new Module() instances inherit load() (#29253)", () => {
  const m = new Module("/tmp/does-not-matter-29253.js", null);
  expect(typeof m.load).toBe("function");
  expect(Object.prototype.hasOwnProperty.call(m, "load")).toBe(false);
  expect(typeof Object.getPrototypeOf(m).load).toBe("function");

  // `require("module").prototype` is a separate object from the instance
  // prototype; both must expose `load`.
  expect(typeof Module.prototype.load).toBe("function");

  // Node's own `load` is an anonymous function (`.name === ""`); Bun
  // deliberately names it "load" rather than leaking the internal
  // builtin identifier.
  expect(m.load.name).toBe("load");
  expect(Module.prototype.load.name).toBe("load");
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

  expect(stderr).toBe("");

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

  expect(stderr).toBe("");

  expect(stdout.trim()).toBe("number");
  expect(exitCode).toBe(0);
});

test.concurrent("new Module().load populates filename/paths/loaded (#29253)", async () => {
  // Node's `Module.prototype.load` writes `filename`, `paths`,
  // and `loaded` before returning. `requizzle` and any other
  // package that reads those fields after `.load()` depends on
  // this, even if it doesn't touch the wrapper.
  // The leaf file sits in a subdir, and the Module is constructed with
  // a DIFFERENT id from the load path. This matters: the C++ constructor
  // initializes \`m_dirname\` from the id, so if \`load()\` doesn't
  // update \`this.path\` from the filename, \`__dirname\` inside the
  // loaded file would be stale (dirname of the constructor id instead
  // of dirname of the load path).
  using dir = tempDir("issue-29253-fields", {
    "sub/leaf.js": `module.exports = { msg: 'ok', seen_dirname: __dirname, seen_filename: __filename };`,
    "driver.js": `
      const Module = require("node:module");
      const path = require("node:path");

      const target = path.resolve(__dirname, "sub/leaf.js");
      // Deliberately pass a DIFFERENT id to the constructor.
      const m = new Module(path.resolve(__dirname, "unrelated/placeholder.js"), module);
      const expectedPaths = Module._nodeModulePaths(path.dirname(target));

      // Pre-load state: loaded=false.
      if (m.loaded !== false) throw new Error("pre-load 'loaded' should be false, got " + m.loaded);

      m.load(target);

      if (m.loaded !== true) throw new Error("post-load 'loaded' should be true");
      if (m.filename !== target) throw new Error("filename mismatch: " + m.filename);
      if (JSON.stringify(m.paths) !== JSON.stringify(expectedPaths)) {
        throw new Error("paths mismatch: " + JSON.stringify(m.paths) + " vs " + JSON.stringify(expectedPaths));
      }
      if (m.exports.msg !== 'ok') throw new Error("exports.msg mismatch: " + m.exports.msg);
      // __filename inside the loaded file must match the load path.
      if (m.exports.seen_filename !== target) {
        throw new Error("seen_filename mismatch: " + m.exports.seen_filename + " vs " + target);
      }
      // __dirname inside the loaded file must be the dirname of the
      // LOAD path, not the dirname of the constructor id. This is the
      // regression: previously load() only set this.filename, so
      // __dirname stayed at the constructor's dirname.
      if (m.exports.seen_dirname !== path.dirname(target)) {
        throw new Error("seen_dirname mismatch: " + m.exports.seen_dirname + " vs " + path.dirname(target));
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

  expect(stderr).toBe("");

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

  expect(stderr).toBe("");

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

  expect(stderr).toBe("");

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test.concurrent("load() preserves caller-preset filename and paths (#29253)", async () => {
  // Node's load() uses `??=` for filename/paths, so values the caller set
  // before calling load() survive.
  using dir = tempDir("module-load-preset", {
    "leaf.js": `module.exports = "ok";`,
    "driver.js": `
      const Module = require("node:module");
      const path = require("node:path");

      const target = path.resolve(__dirname, "leaf.js");
      const m = new Module(target, module);
      m.filename = "/preset/filename.js";
      m.paths = ["/my/custom/lookup/node_modules"];
      m.load(target);

      console.log(JSON.stringify({ filename: m.filename, paths: m.paths, exports: m.exports }));
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

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result).toEqual({
    filename: "/preset/filename.js",
    paths: ["/my/custom/lookup/node_modules"],
    exports: "ok",
  });
  expect(exitCode).toBe(0);
});

test("module.isPreloading is a boolean getter on the prototype", () => {
  // Node defines `isPreloading` as a getter on `Module.prototype`; before
  // the fix Bun returned `undefined` here.
  const m = new Module("/tmp/does-not-matter-29253.js", null);
  expect(m.isPreloading).toBe(false);
  expect(typeof m.isPreloading).toBe("boolean");
  expect(Object.prototype.hasOwnProperty.call(m, "isPreloading")).toBe(false);

  // Node defines the accessor with enumerable/configurable both false.
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(m), "isPreloading");
  expect(typeof desc?.get).toBe("function");
  expect(desc?.enumerable).toBe(false);
  expect(desc?.configurable).toBe(false);

  // Also present on the disposable `require("module").prototype` object.
  expect(Module.prototype.isPreloading).toBe(false);
  const protoDesc = Object.getOwnPropertyDescriptor(Module.prototype, "isPreloading");
  expect(typeof protoDesc?.get).toBe("function");
  expect(protoDesc?.enumerable).toBe(false);
  expect(protoDesc?.configurable).toBe(false);
});

test.concurrent("module.isPreloading is true during --preload and false afterwards", async () => {
  using dir = tempDir("issue-29253-preload", {
    "preload.cjs": `
      const Module = require("node:module");
      const m = new Module("x", module);
      console.log(JSON.stringify({
        where: "preload",
        module: module.isPreloading,
        fresh: m.isPreloading,
        proto: Module.prototype.isPreloading,
      }));
    `,
    "main.cjs": `
      console.log(JSON.stringify({
        where: "main",
        module: module.isPreloading,
      }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.cjs", "main.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const lines = stdout
    .trim()
    .split("\n")
    .map(l => JSON.parse(l));
  expect(lines).toEqual([
    { where: "preload", module: true, fresh: true, proto: true },
    { where: "main", module: false },
  ]);
  expect(exitCode).toBe(0);
});
