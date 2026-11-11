// require(esm) of a module that is still evaluating — the require() sits
// inside that module's own evaluation (a.mjs → require(b.mjs) → b imports
// a.mjs). The namespace is live: hoisted functions and already-initialized
// bindings are visible, later `const`s are in TDZ. Code-split bundler
// output (target bun) relies on this for require() cycles across chunks.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

test("require(esm) inside a require cycle returns the live namespace, not an empty placeholder", async () => {
  using dir = tempDir("require-esm-evaluating-cycle", {
    "a.mjs": `
      export function hoisted() { return "h" }
      export const before = "before"
      const b = require("./b.mjs")
      const self = require("./a.mjs")
      console.log(JSON.stringify({
        fromB: b.fromB(),
        selfHoisted: typeof self.hoisted,
        selfBefore: self.before,
        selfLaterTdz: (() => { try { return self.later } catch (e) { return e.constructor.name } })(),
      }))
      export const later = "later"
    `,
    "b.mjs": `
      import { hoisted, before } from "./a.mjs"
      export function fromB() { return hoisted() + ":" + before }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "a.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    fromB: "h:before",
    selfHoisted: "function",
    selfBefore: "before",
    selfLaterTdz: "ReferenceError",
  });
  expect(exitCode).toBe(0);
});

// The CommonJS side reads `__esModule` / `"module.exports"` off that live
// namespace; when the module happens to export a binding by that name that is
// still in TDZ, require() itself must not throw (reading it afterwards does).
test("require(esm) inside a require cycle tolerates a TDZ `__esModule` export", async () => {
  using dir = tempDir("require-esm-evaluating-cycle-tdz", {
    "a.mjs": `
      const self = require("./a.mjs")
      const read = (() => { try { return self.__esModule } catch (e) { return e.constructor.name } })()
      console.log(typeof self, read)
      export let __esModule = true
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "a.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("object ReferenceError");
  expect(exitCode).toBe(0);
});

// The same cycle when a require() began the module's load. The require map
// then holds a Module object that stands in for the ES module while it loads.
// A require() that finds that object gets what the registry answers, as above,
// and not the empty `exports` that the object was made with.
describe.concurrent("require(esm) inside a require cycle that a require() began", () => {
  async function run(files: Record<string, string>, ...cmd: string[]) {
    using dir = tempDir("require-esm-cycle-require-began", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // What a require() of a.mjs got, read by the file that made the call.
  const report = `
    const read = (a, name) => { try { return a[name] } catch (e) { return e.constructor.name } }
    module.exports = a => ({
      tag: Object.prototype.toString.call(a),
      early: read(a, "early"),
      later: read(a, "later"),
      esModule: a.__esModule,
    })
  `;
  // a.mjs exports `early`, runs `requireB` (b requires a.mjs again), then exports `later`.
  const a = (requireB: string) => `
    export const early = 1
    globalThis.evaluations = (globalThis.evaluations ?? 0) + 1
    export const got = ${requireB}
    export const later = 2
  `;
  const print = `console.log(JSON.stringify({
    inner: a.got,
    held: globalThis.held === a,
    later: globalThis.held.later,
    evaluations: globalThis.evaluations,
  }))`;
  const live = {
    inner: { tag: "[object Module]", early: 1, later: "ReferenceError", esModule: true },
    held: true,
    later: 2,
    evaluations: 1,
  };

  const throughCommonJS = {
    "report.cjs": report,
    "a.mjs": `import { createRequire } from "node:module"\n` + a(`createRequire(import.meta.url)("./b.cjs").saw`),
    "b.cjs": `exports.saw = require("./report.cjs")((globalThis.held = require("./a.mjs")))`,
  };
  const forms: [name: string, cmd: string[], files: Record<string, string>][] = [
    [
      "require() in a CommonJS file",
      ["main.cjs"],
      { ...throughCommonJS, "main.cjs": `const a = require("./a.mjs")\n${print}` },
    ],
    [
      "module.require()",
      ["main.cjs"],
      {
        ...throughCommonJS,
        "b.cjs": `exports.saw = require("./report.cjs")((globalThis.held = module.require("./a.mjs")))`,
        "main.cjs": `const a = module.require("./a.mjs")\n${print}`,
      },
    ],
    [
      "createRequire() in an ES module",
      ["main.mjs"],
      {
        ...throughCommonJS,
        "main.mjs": `import { createRequire } from "node:module"\nconst a = createRequire(import.meta.url)("./a.mjs")\n${print}`,
      },
    ],
    [
      "import.meta.require()",
      ["main.mjs"],
      {
        "report.cjs": report,
        "a.mjs": a(`import.meta.require("./b.mjs").saw`),
        "b.mjs": `export const saw = import.meta.require("./report.cjs")((globalThis.held = import.meta.require("./a.mjs")))`,
        "main.mjs": `const a = import.meta.require("./a.mjs")\n${print}`,
      },
    ],
    [
      "require() in ES modules",
      ["main.mjs"],
      {
        "report.cjs": report,
        "a.mjs": a(`require("./b.mjs").saw`),
        "b.mjs": `export const saw = require("./report.cjs")((globalThis.held = require("./a.mjs")))`,
        "main.mjs": `const a = require("./a.mjs")\n${print}`,
      },
    ],
    [
      "TypeScript `import a = require()`",
      ["main.ts"],
      {
        "report.cjs": report,
        "a.ts": a(`require("./b").saw`),
        "b.ts": `import a = require("./a")\nimport report = require("./report.cjs")\nexport const saw = report((globalThis.held = a))`,
        "main.ts": `import a = require("./a")\n${print}`,
      },
    ],
    [
      "a module that requires itself",
      ["main.cjs"],
      {
        "report.cjs": report,
        "a.mjs": a(`require("./report.cjs")((globalThis.held = require("./a.mjs")))`),
        "main.cjs": `const a = require("./a.mjs")\n${print}`,
      },
    ],
    ["bun -e", ["-e", `const a = require("./a.mjs")\n${print}`], throughCommonJS],
  ];
  test.each(forms)("%s", async (_, cmd, files) => {
    const { stdout, stderr, exitCode } = await run(files, ...cmd);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(live);
    expect(exitCode).toBe(0);
  });

  // A graph has a require map and a module registry of its own.
  test("inside a Bun.ModuleGraph", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "a.mjs": `
          export const early = 1
          export const b = require("./b.cjs")
          export const later = 2
        `,
        "b.cjs": `
          const a = require("./a.mjs")
          exports.held = a
          exports.saw = [Object.prototype.toString.call(a), a.early, a.__esModule].join()
        `,
        "in-graph.mjs": `
          export const a = import.meta.require("./a.mjs")
          export const report = { saw: a.b.saw, held: a.b.held === a, later: a.b.held.later }
        `,
        "main.mjs": `
          import { join } from "node:path"
          const load = () => new Bun.ModuleGraph().import(join(import.meta.dirname, "in-graph.mjs"))
          const [one, two] = [await load(), await load()]
          console.log(JSON.stringify({ one: one.report, two: two.report, separate: one.a !== two.a }))
        `,
      },
      "main.mjs",
    );
    expect(stderr).toBe("");
    const report = { saw: "[object Module],1,true", held: true, later: 2 };
    expect(JSON.parse(stdout)).toEqual({ one: report, two: report, separate: true });
    expect(exitCode).toBe(0);
  });

  // Each file that is required becomes a chunk, and a chunk requires another with import.meta.require().
  test("chunks of `bun build --splitting --target=bun`", async () => {
    using dir = tempDir("require-esm-cycle-split-chunks", {
      "a.mjs": `
        export const early = 1
        export const got = require("./b.mjs").saw
      `,
      "b.mjs": `
        const a = require("./a.mjs")
        export const saw = [Object.prototype.toString.call(a), a.early, a.__esModule].join()
      `,
      "main.mjs": `
        const a = require("./a.mjs")
        console.log(a.got, Object.keys(a).join())
      `,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--splitting", "--target=bun", "--outdir=out", "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildStderr, buildExitCode] = await Promise.all([build.stderr.text(), build.exited, build.stdout.text()]);
    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);
    expect(readdirSync(join(String(dir), "out")).filter(name => name.endsWith(".js")).length).toBeGreaterThan(2);

    await using proc = Bun.spawn({
      cmd: [bunExe(), join("out", "main.js")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("[object Module],1,true early,got");
    expect(exitCode).toBe(0);
  });

  test("an ES module that a.mjs imports requires a.mjs before the body of a.mjs starts", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "report.cjs": report,
        "a.mjs": `
          import { saw } from "./b.mjs"
          export function hoisted() { return "h" }
          export const early = 1
          export const got = saw
          export const later = 2
        `,
        "b.mjs": `
          import "./a.mjs"
          const a = require("./a.mjs")
          export const saw = { ...require("./report.cjs")(a), hoisted: a.hoisted() }
        `,
        "main.cjs": `console.log(JSON.stringify(require("./a.mjs").got))`,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      tag: "[object Module]",
      early: "ReferenceError",
      later: "ReferenceError",
      esModule: true,
      hoisted: "h",
    });
    expect(exitCode).toBe(0);
  });

  // require() returns the value of an export named "module.exports". The inner
  // require() returns it too once it is initialized, and the namespace before that.
  test('an export named "module.exports"', async () => {
    const files = (initializedFirst: boolean) => ({
      "a.mjs": `
        ${initializedFirst ? `const custom = { custom: true }` : ""}
        require("./b.cjs")
        ${initializedFirst ? "" : `const custom = { custom: true }`}
        export { custom as "module.exports" }
      `,
      "b.cjs": `globalThis.inner = require("../tag.cjs")(require("./a.mjs"))`,
    });
    const { stdout, stderr, exitCode } = await run(
      {
        "tag.cjs": `module.exports = a => (a.custom === true ? "custom" : Object.prototype.toString.call(a))`,
        ...Object.fromEntries(Object.entries(files(true)).map(([name, text]) => ["before/" + name, text])),
        ...Object.fromEntries(Object.entries(files(false)).map(([name, text]) => ["after/" + name, text])),
        "main.cjs": `
          const result = {}
          for (const dir of ["before", "after"]) {
            const a = require("./" + dir + "/a.mjs")
            result[dir] = { inner: globalThis.inner, outer: require("./tag.cjs")(a), again: require("./" + dir + "/a.mjs") === a }
          }
          console.log(JSON.stringify(result))
        `,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      before: { inner: "custom", outer: "custom", again: true },
      after: { inner: "[object Module]", outer: "custom", again: true },
    });
    expect(exitCode).toBe(0);
  });

  test("a module with top-level await: the inner require() throws what the outer one throws", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "a.mjs": `
          try { require("./b.cjs") } catch (e) { globalThis.inner = e.message }
          await 0
        `,
        "b.cjs": `require("./a.mjs")`,
        "main.cjs": `
          let outer
          try { require("./a.mjs") } catch (e) { outer = e.message }
          console.log(JSON.stringify({
            inner: globalThis.inner === outer,
            outer: outer.replace(require.resolve("./a.mjs"), "<a.mjs>"),
          }))
        `,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      inner: true,
      outer: 'require() async module "<a.mjs>" is unsupported. use "await import()" instead.',
    });
    expect(exitCode).toBe(0);
  });

  test("a module that throws after the inner require(): every require() of it throws, and none is cached", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "a.mjs": `
          export const early = 1
          require("./b.cjs")
          throw new Error("a.mjs failed")
        `,
        "b.cjs": `globalThis.inner = Object.prototype.toString.call(require("./a.mjs"))`,
        "main.cjs": `
          const messages = [1, 2].map(() => { try { require("./a.mjs") } catch (e) { return e.message } })
          console.log(JSON.stringify({ inner: globalThis.inner, messages, cached: require.resolve("./a.mjs") in require.cache }))
        `,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      inner: "[object Module]",
      messages: ["a.mjs failed", "a.mjs failed"],
      cached: false,
    });
    expect(exitCode).toBe(0);
  });

  // Before the graph of a.mjs is linked there is no namespace to hand out. A
  // CommonJS file that a.mjs imports runs then: no load of a.mjs starts inside
  // its require(), so the modules run in the order they ran in before.
  test("a CommonJS file that a.mjs imports requires a.mjs: the modules run in the same order", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "a.mjs": `
          import c from "./c.cjs"
          console.log("a.mjs runs, c.cjs is done:", c.done)
          export const early = 1
        `,
        "c.cjs": `
          console.log("c.cjs runs, a.mjs is an", typeof require("./a.mjs"))
          exports.done = true
        `,
        "main.cjs": `console.log("main.cjs sees", Object.keys(require("./a.mjs")).join())`,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(stdout).toBe(
      ["c.cjs runs, a.mjs is an object", "a.mjs runs, c.cjs is done: true", "main.cjs sees early"].join("\n"),
    );
    expect(exitCode).toBe(0);
  });
});
