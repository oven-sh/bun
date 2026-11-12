// require(esm) of a module that is still evaluating — the require() sits
// inside that module's own evaluation (a.mjs → require(b.mjs) → b imports
// a.mjs). The namespace is live: hoisted functions and already-initialized
// bindings are visible, later `const`s are in TDZ. Code-split bundler
// output (target bun) relies on this for require() cycles across chunks.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

// What a.mjs needs to print what require() returned: "custom" for the value of
// its `"module.exports"` export, and the tag of any other object.
const tag = `v => (v?.custom === true ? "custom" : Object.prototype.toString.call(v))`;

async function run(files: Record<string, string>, entry: string) {
  using dir = tempDir("require-esm-evaluating-cycle-interop", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

// An export in TDZ hides only itself. The `"module.exports"` export is
// initialized when require() runs, so require() returns its value, then and
// on every later call.
describe.concurrent('require(esm) while `__esModule` is in TDZ and "module.exports" is initialized', () => {
  // a.mjs runs `body` between the two exports.
  const a = (body: string) => `
    const custom = { custom: true }
    export { custom as "module.exports" }
    ${body}
    export let __esModule = true
  `;
  // `load` is the entry's import, which begins the load of a.mjs.
  const entry = (load: string) => `
    import "${load}"
    const tag = ${tag}
    const later = require("./a.mjs")
    console.log(JSON.stringify({ inner: tag(globalThis.inner), later: tag(later) }))
  `;
  const cases: [name: string, files: Record<string, string>][] = [
    [
      "the module requires itself",
      { "a.mjs": a(`globalThis.inner = require("./a.mjs")`), "entry.mjs": entry("./a.mjs") },
    ],
    [
      "the module requires itself with import.meta.require()",
      { "a.mjs": a(`globalThis.inner = import.meta.require("./a.mjs")`), "entry.mjs": entry("./a.mjs") },
    ],
    [
      "the module requires itself with createRequire()",
      {
        "a.mjs": `import { createRequire } from "node:module"\n${a(`globalThis.inner = createRequire(import.meta.url)("./a.mjs")`)}`,
        "entry.mjs": entry("./a.mjs"),
      },
    ],
    [
      "the module requires itself with Module.prototype.require",
      {
        "a.mjs": `import Module from "node:module"\n${a(`globalThis.inner = Module.prototype.require.call(null, import.meta.path)`)}`,
        "entry.mjs": entry("./a.mjs"),
      },
    ],
    [
      "a CommonJS file that the module requires requires it back",
      {
        "a.mjs": a(`require("./b.cjs")`),
        "b.cjs": `globalThis.inner = require("./a.mjs")`,
        "entry.mjs": entry("./a.mjs"),
      },
    ],
    // a.mjs has finished here. Its `__esModule` is the binding of late.mjs, which is still running.
    [
      "the module re-exports `__esModule` from a module that is still evaluating",
      {
        "a.mjs": `
          const custom = { custom: true }
          export { custom as "module.exports" }
          export { __esModule } from "./late.mjs"
        `,
        "late.mjs": `
          globalThis.inner = require("./a.mjs")
          export let __esModule = true
        `,
        "entry.mjs": entry("./late.mjs"),
      },
    ],
  ];
  test.each(cases)("%s", async (_, files) => {
    const { stdout, stderr, exitCode } = await run(files, "entry.mjs");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ inner: "custom", later: "custom" });
    expect(exitCode).toBe(0);
  });
});

// What require() returns for each other state of the two exports, when the
// module requires itself while it evaluates. `before` is initialized when
// require() runs, and `after` is in TDZ. Each module also has an export of
// another name.
test('require(esm) inside a require cycle: the other states of `__esModule` and "module.exports"', async () => {
  const states: Record<string, { before?: string; after?: string }> = {
    "neither export": {},
    '"module.exports" is an object': {
      before: `const custom = { custom: true }; export { custom as "module.exports" }`,
    },
    '"module.exports" is 0': { before: `const zero = 0; export { zero as "module.exports" }` },
    '"module.exports" is null': { before: `const nothing = null; export { nothing as "module.exports" }` },
    '"module.exports" is undefined': { before: `const nothing = undefined; export { nothing as "module.exports" }` },
    '"module.exports" is in TDZ': { after: `const custom = { custom: true }; export { custom as "module.exports" }` },
    "`__esModule` is false": { before: `export const __esModule = false` },
    "`__esModule` is in TDZ": { after: `export let __esModule = true` },
    "both are in TDZ": {
      after: `export let __esModule = true; const custom = { custom: true }; export { custom as "module.exports" }`,
    },
    '`__esModule` is false and "module.exports" is in TDZ': {
      before: `export const __esModule = false`,
      after: `const custom = { custom: true }; export { custom as "module.exports" }`,
    },
    '`__esModule` is false and "module.exports" is an object': {
      before: `export const __esModule = false; const custom = { custom: true }; export { custom as "module.exports" }`,
    },
  };
  const names = Object.keys(states);
  const files: Record<string, string> = {
    "entry.mjs": `
      ${names.map((_, i) => `import * as ns${i} from "./state${i}.mjs"`).join("\n")}
      const tag = v => (v === null || typeof v !== "object" ? String(v) : (${tag})(v))
      const read = ns => { try { return ns.__esModule } catch (e) { return e.constructor.name } }
      const report = {}
      ${names
        .map(
          (name, i) => `report[${JSON.stringify(name)}] = {
            inner: tag(globalThis.inner${i}),
            later: tag(require("./state${i}.mjs")),
            innerIsNamespace: globalThis.inner${i} === ns${i},
            esModule: read(ns${i}),
          }`,
        )
        .join("\n")}
      console.log(JSON.stringify(report))
    `,
  };
  names.forEach((name, i) => {
    const { before = "", after = "" } = states[name];
    files[`state${i}.mjs`] =
      `export const other = 1\n${before}\nglobalThis.inner${i} = require("./state${i}.mjs")\n${after}\n`;
  });

  const { stdout, stderr, exitCode } = await run(files, "entry.mjs");
  const namespace = { inner: "[object Module]", later: "[object Module]", innerIsNamespace: true };
  const value = (tag: string) => ({ inner: tag, later: tag, innerIsNamespace: false });
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    "neither export": { ...namespace, esModule: true },
    '"module.exports" is an object': { ...value("custom"), esModule: true },
    '"module.exports" is 0': { ...value("0"), esModule: true },
    '"module.exports" is null': { ...namespace, esModule: true },
    '"module.exports" is undefined': { ...namespace, esModule: true },
    // The namespace stays in require.cache after the export is initialized.
    '"module.exports" is in TDZ': { ...namespace, esModule: true },
    "`__esModule` is false": { ...namespace, esModule: false },
    "`__esModule` is in TDZ": { ...namespace, esModule: true },
    "both are in TDZ": { ...namespace, esModule: true },
    '`__esModule` is false and "module.exports" is in TDZ': { ...namespace, esModule: false },
    '`__esModule` is false and "module.exports" is an object': { ...value("custom"), esModule: false },
  });
  expect(exitCode).toBe(0);
});
