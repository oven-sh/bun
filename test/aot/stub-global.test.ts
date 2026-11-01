import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const imported = `import { test, vi } from "bun:test";`;
const reads = (form: string) =>
  `export const read = () => { try { return ${form}; } catch (error) { return error.name; } };\n`;
const stubs = (stub: string, head = imported) =>
  `${head}\nimport { read } from "./lib.js";\ntest("t", () => { const before = read(); ${stub}; const stubbed = read(); vi.unstubAllGlobals(); console.log("SEEN", before, stubbed, read()); });\n`;
const constant = `vi.stubGlobal("someGlobal", "stubbed")`;
const copied = `import { test, vi as real } from "bun:test";\nconst vi = { ...real };`;
const asType = "SEEN undefined string undefined";
const asValue = "SEEN undefined stubbed undefined";

const cases: [name: string, seen: string[], files: Record<string, string>][] = [
  ["typeof name", [asType], { "lib.js": reads("typeof someGlobal"), "a.test.js": stubs(constant) }],
  ["globalThis.name", [asValue], { "lib.js": reads("globalThis.someGlobal"), "a.test.js": stubs(constant) }],
  [
    "typeof globalThis.name",
    [asType],
    { "lib.js": reads("typeof globalThis.someGlobal"), "a.test.js": stubs(constant) },
  ],
  [
    "the bare name",
    ["SEEN ReferenceError stubbed ReferenceError"],
    { "lib.js": reads("someGlobal"), "a.test.js": stubs(constant) },
  ],
  [
    "through a local and ?.",
    ["SEEN none there none"],
    {
      "lib.js": `const global = globalThis;\nexport const read = () => (global?.someGlobal !== undefined ? "there" : "none");\n`,
      "a.test.js": stubs(constant),
    },
  ],
  [
    "a name that the build can't read",
    [asType],
    {
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": stubs(`vi.stubGlobal(process.env.NO_SUCH_NAME ?? ["some", "Global"].join(""), "stubbed")`),
    },
  ],
  [
    "spread operands",
    [asType],
    { "lib.js": reads("typeof someGlobal"), "a.test.js": stubs(`vi.stubGlobal(...["someGlobal", "stubbed"])`) },
  ],
  [
    "a chain",
    [asType],
    {
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": stubs(`vi.stubGlobal("other", 1).stubGlobal("someGlobal", "stubbed")`),
    },
  ],
  [
    "a chain from stubEnv",
    [asType],
    {
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": stubs(`vi.stubEnv("SOME_NAME", "1").stubGlobal("someGlobal", "stubbed")`),
    },
  ],
  [
    "a chain from useFakeTimers",
    [asValue],
    {
      "lib.js": reads("globalThis.someGlobal"),
      "a.test.js": stubs(`vi.useFakeTimers().stubGlobal("someGlobal", "stubbed"); vi.useRealTimers()`),
    },
  ],
  [
    "a chain from clearAllMocks",
    [asType],
    {
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": stubs(`vi.clearAllMocks().stubGlobal("someGlobal", "stubbed")`),
    },
  ],
  [
    "the function handed on",
    [asType],
    {
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": stubs(`const run = f => f("someGlobal", "stubbed"); run(vi.stubGlobal)`),
    },
  ],
  [
    "the function handed into another file",
    [asType],
    {
      "lib.js": reads("typeof someGlobal"),
      "helper.js": `export const run = f => f("someGlobal", "stubbed");\n`,
      "a.test.js": stubs(`run(vi.stubGlobal)`, `${imported}\nimport { run } from "./helper.js";`),
    },
  ],
  [
    "the function out of a list",
    [asType],
    { "lib.js": reads("typeof someGlobal"), "a.test.js": stubs(`[vi.stubGlobal][0]("someGlobal", "stubbed")`) },
  ],
  [
    "the function kept in an object",
    [asValue],
    {
      "lib.js": reads("globalThis.someGlobal"),
      "a.test.js": stubs(`const held = { stub: vi.stubGlobal }; held.stub("someGlobal", "stubbed")`),
    },
  ],
  [
    "the function called with a third operand",
    [asType],
    {
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": stubs(`class Kept { static stub = vi.stubGlobal; } Kept.stub("someGlobal", "stubbed", { a: 1 })`),
    },
  ],
  [
    "a copy of the runner's object",
    [asType],
    { "lib.js": reads("typeof someGlobal"), "a.test.js": stubs(constant, copied) },
  ],
  [
    "a copy stubs a built-in",
    ["SEEN function number function"],
    { "lib.js": reads("typeof fetch"), "a.test.js": stubs(`vi.stubGlobal("fetch", 1)`, copied) },
  ],
  [
    "another object's stubGlobal behind a chain",
    ["SEEN own 2", "SEEN undefined undefined undefined"],
    {
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": stubs(
        `const own = { stubEnv: () => own, stubGlobal: (...all) => "own " + all.length }; console.log("SEEN", (process.env.NO_SUCH_NAME ? vi : own).stubEnv("A", "1").stubGlobal("someGlobal", "stubbed"))`,
      ),
    },
  ],
  [
    "the function kept",
    [asType],
    {
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": stubs(`const stub = vi.stubGlobal; stub("someGlobal", "stubbed")`),
    },
  ],
  [
    "a third operand is evaluated",
    [asType],
    {
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": stubs(
        `let times = 0; vi.stubGlobal("someGlobal", "stubbed", times++); if (times !== 1) throw new Error("not evaluated")`,
      ),
    },
  ],
  [
    "vitest",
    [asType],
    { "lib.js": reads("typeof someGlobal"), "a.test.js": stubs(constant, `import { test, vi } from "vitest";`) },
  ],
  ["the runner's own name", [asType], { "lib.js": reads("typeof someGlobal"), "a.test.js": stubs(constant, "") }],
  [
    "in a helper that is handed the name",
    [asValue],
    {
      "lib.js": reads("globalThis.someGlobal"),
      "helper.js": `import { vi } from "bun:test";\nexport const stub = (name, value) => vi.stubGlobal(name, value);\n`,
      "a.test.js": stubs(`stub("someGlobal", "stubbed")`, `${imported}\nimport { stub } from "./helper.js";`),
    },
  ],
  [
    "in a preload",
    ["SEEN string"],
    {
      "bunfig.toml": `[test]\npreload = ["./setup.js"]\n`,
      "setup.js": `import { beforeEach, vi } from "bun:test";\nbeforeEach(() => { vi.stubGlobal("someGlobal", "stubbed"); });\n`,
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": `import { test } from "bun:test";\nimport { read } from "./lib.js";\ntest("t", () => { console.log("SEEN", read()); });\n`,
    },
  ],
  [
    "a function is called",
    ["SEEN none called none"],
    {
      "lib.js": reads(`typeof someGlobal === "function" ? someGlobal() : "none"`),
      "a.test.js": stubs(`vi.stubGlobal("someGlobal", () => "called")`),
    },
  ],
  [
    "a class is constructed",
    ["SEEN none made none"],
    {
      "lib.js": reads(`typeof someGlobal === "function" ? new someGlobal().m() : "none"`),
      "a.test.js": stubs(`vi.stubGlobal("someGlobal", class { m() { return "made"; } })`),
    },
  ],
  [
    "typeof window",
    ["SEEN none stubbed none"],
    {
      "lib.js": reads(
        `typeof window !== "undefined" && typeof window.document !== "undefined" ? window.document.title : "none"`,
      ),
      "a.test.js": stubs(`vi.stubGlobal("window", { document: { title: "stubbed" } })`),
    },
  ],
  [
    "ahead of the load",
    ["SEEN string"],
    {
      "lib.js": `export const atLoad = typeof someGlobal;\n`,
      "a.test.js": `${imported}\ntest("t", async () => { ${constant}; const { atLoad } = await import("./lib.js"); console.log("SEEN", atLoad); });\n`,
    },
  ],
  [
    "unstubGlobals",
    ["SEEN string", "SEEN undefined"],
    {
      "bunfig.toml": `[test]\nunstubGlobals = true\n`,
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": `${imported}\nimport { read } from "./lib.js";\ntest("one", () => { ${constant}; console.log("SEEN", read()); });\ntest("two", () => { console.log("SEEN", read()); });\n`,
    },
  ],
  [
    "one file of two",
    ["SEEN a number", "SEEN b undefined"],
    {
      "lib.js": reads("typeof someGlobal"),
      "a.test.js": `${imported}\nimport { read } from "./lib.js";\ntest("a", () => { vi.stubGlobal("someGlobal", 1); console.log("SEEN a", read()); });\n`,
      "b.test.js": `import { test } from "bun:test";\nimport { read } from "./lib.js";\ntest("b", () => { console.log("SEEN b", read()); });\n`,
    },
  ],
];

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

test.concurrent.each(cases)(
  "a compiled file sees a stubbed global: %s",
  async (name, seen, files) => {
    using dir = tempDir("aot-stub-global", { "package.json": `{ "name": "p", "type": "module" }`, ...files });
    const [plain, oneProgram, layers] = await Promise.all([
      runTests(String(dir), undefined),
      runTests(String(dir), undefined, "--aot"),
      runTests(String(dir), "TestRunLayers:2", "--aot"),
    ]);
    expect({ name, plain, oneProgram, layers }).toEqual({
      name,
      plain: { seen, exitCode: 0 },
      oneProgram: { seen, exitCode: 0 },
      layers: { seen, exitCode: 0 },
    });
  },
  240_000,
);
