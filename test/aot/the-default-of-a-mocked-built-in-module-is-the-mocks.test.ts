import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `mock.module("node:buffer", () => ({ isUtf8: fake, default: { isUtf8: fake } }))`: the `default` of the module is the mock's from then on, through
// `import T from`, `import * as N` and `await import(..)`. For a module of native code the build took `default` for the object that it knows, which nothing replaces.
// Over a module that an import has loaded the mock is laid: the names that it lacks stay, and import() goes on answering the same namespace object.
// There a compiled run asked the loader, which had not seen the import of compiled code and answered with the names of the mock alone.
const modules: [specifier: string, mocked: string, other: string][] = [
  // Native code.
  ["node:buffer", "isUtf8", "isAscii"],
  ["node:constants", "O_RDONLY", "O_WRONLY"],
  ["node:module", "isBuiltin", "createRequire"],
  ["node:process", "uptime", "hrtime"],
  ["node:string_decoder", "StringDecoder", "StringDecoder"],
  ["node:util/types", "isDate", "isRegExp"],
  ["bun:jsc", "heapSize", "heapStats"],
  // JavaScript.
  ["node:fs", "existsSync", "readFileSync"],
  ["node:path", "join", "resolve"],
  ["node:os", "cpus", "platform"],
];

const helpers = `const is = v => (v === fake ? "mock" : typeof v);
const tell = (label, make) => { let said; try { said = is(make()); } catch (error) { said = "throws " + error.constructor.name; } return label + " " + said; };
`;
const imports = (specifier: string) => `import { test, mock } from "bun:test";
import T from "${specifier}";
import * as N from "${specifier}";
`;

function filesOf(isMockedByPreload: boolean) {
  const files: Record<string, string> = { "package.json": `{ "name": "mocks-of-built-in-modules", "type": "module" }` };
  const mocks: string[] = [];
  for (const [specifier, f, g] of modules) {
    const name = specifier.replace(/[^a-z]+/g, "-");
    const whole = `() => ({ ${f}: fake, default: { ${f}: fake } })`;
    if (isMockedByPreload) {
      mocks.push(`mock.module("${specifier}", ${whole});`);
      files[`${name}.test.js`] = `${imports(specifier)}const fake = globalThis.fakeOfPreload;
${helpers}test("x", async () => {
  const S = await import("${specifier}");
  console.log("SEEN ${name} behind a preload:", [tell("T", () => T.${f}), tell("N.default", () => N.default.${f}), tell("S.default", () => S.default.${f}), tell("N", () => N.${f})].join(" | "));
});
`;
      continue;
    }
    files[`${name}.first.test.js`] = `${imports(specifier)}const fake = function fake() {};
${helpers}mock.module("${specifier}", ${whole});
const TOP = await import("${specifier}");
async function load() { const L = await import("${specifier}"); return L.default.${f}; }
const arrow = async () => (await import("${specifier}")).default.${f};
test("x", async () => {
  const S = await import("${specifier}");
  const promise = import("${specifier}");
  const Q = await promise;
  const { default: D } = await import("${specifier}");
  const [inFunction, inArrow] = [await load(), await arrow()];
  console.log("SEEN ${name} mocked at the top:", [tell("T", () => T.${f}), tell("N.default", () => N.default.${f}), tell("S.default", () => S.default.${f}), tell("TOP.default", () => TOP.default.${f}),
    tell("in a function", () => inFunction), tell("in an arrow", () => inArrow), tell("Q.default", () => Q.default.${f}), tell("D", () => D.${f}), tell("N", () => N.${f}), tell("require", () => require("${specifier}").${f}),
    "one object " + (S.default === T && N.default === T && S === N)].join(" | "));
  mock.restore();
  const A = await import("${specifier}");
  console.log("SEEN ${name} restored:", [tell("T", () => T.${f}), tell("N.default", () => N.default.${f}), tell("A.default", () => A.default.${f})].join(" | "));
});
`;
    files[`${name}.later.test.js`] = `${imports(specifier)}const fake = function fake() {};
${helpers}test("x", async () => {
  const B = await import("${specifier}");
  const before = [tell("T", () => T.${f}), tell("N.default", () => N.default.${f}), tell("B.default", () => B.default.${f})].join(" | ");
  mock.module("${specifier}", ${whole});
  const S = await import("${specifier}");
  console.log("SEEN ${name} mocked in the test:", before, "||", [tell("T", () => T.${f}), tell("N.default", () => N.default.${f}), tell("B.default", () => B.default.${f}), tell("S.default", () => S.default.${f})].join(" | "));
});
`;
    files[`${name}.over.test.js`] = `${imports(specifier)}const fake = function fake() {};
${helpers}mock.module("${specifier}", () => ({ ${f}: fake }));
test("x", async () => {
  const S = await import("${specifier}");
  const promise = import("${specifier}");
  const Q = await promise;
  const { default: D, ${g}: other } = await import("${specifier}");
  console.log("SEEN ${name} names alone, laid over:", [tell("T", () => T), tell("N.default", () => N.default), tell("S.default", () => S.default), tell("Q.default", () => Q.default), tell("D", () => D),
    tell("another name: N", () => N.${g}), tell("S", () => S.${g}), tell("Q", () => Q.${g}), tell("by a pattern", () => other), tell("the name: S", () => S.${f}), tell("Q", () => Q.${f}), tell("N", () => N.${f}),
    "one object " + (Q === N && S === N)].join(" | "));
});
`;
    files[`${name}.alone.test.js`] = `import { test, mock } from "bun:test";
const fake = function fake() {};
${helpers}mock.module("${specifier}", () => ({ ${f}: fake }));
test("x", async () => {
  const S = await import("${specifier}");
  const promise = import("${specifier}");
  const Q = await promise;
  console.log("SEEN ${name} names alone, nothing loaded:", [tell("S.default", () => S.default), tell("Q.default", () => Q.default), tell("S", () => S.${f}), "keys " + Object.keys(Q).join()].join(" | "));
});
`;
  }
  if (isMockedByPreload) {
    files["preload.js"] = `import { mock } from "bun:test";
const fake = (globalThis.fakeOfPreload = function fake() {});
${mocks.join("\n")}
`;
  }
  return files;
}

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return {
    stdout: stdout
      .split("\n")
      .filter(line => line.startsWith("SEEN"))
      .sort(),
    exitCode,
  };
}

for (const [way, words] of [
  ["at default flags", undefined],
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:8"],
] as const) {
  test(`what a test file mocks is read as under plain bun test, ${way}`, async () => {
    using dir = tempDir("aot-default-of-a-mocked-built-in-module", filesOf(false));
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout.length).toBe(modules.length * 5);
    expect(plain.stdout).toContain(
      "SEEN node-buffer mocked at the top: T mock | N.default mock | S.default mock | TOP.default mock | in a function mock | in an arrow mock | Q.default mock | D mock | N mock | require mock | one object true",
    );
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 300_000);

  test(`what a preload mocks is read as under plain bun test, ${way}`, async () => {
    using dir = tempDir("aot-default-of-a-built-in-module-that-a-preload-mocks", filesOf(true));
    const plain = await runTests(String(dir), undefined, "--preload", "./preload.js");
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout.length).toBe(modules.length);
    expect(await runTests(String(dir), words, "--aot", "--preload", "./preload.js")).toEqual(plain);
  }, 300_000);
}
