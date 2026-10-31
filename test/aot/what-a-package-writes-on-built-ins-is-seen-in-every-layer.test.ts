import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// A package stands in the lowest layer of a test run, the files of the project in the layer over it, a test file in a program over both. What the package stores on a
// built-in object, as a polyfill does, is what the code of every layer finds there from then on: under the name, and where a built-in function looks the name up itself, as
// join() does with toString. The build of a layer does not see the stores of the layer below.
const patches = `export const hook = { called: () => {} };
const kept = [];
function put(holder, name, value) { kept.push([holder, name, Object.getOwnPropertyDescriptor(holder, name)]); holder[name] = value; }
export function patch() {
  put(Date.prototype, "toString", function () { hook.called("Date.toString"); return "patched date"; });
  put(Date.prototype, "toLocaleString", function () { hook.called("Date.toLocaleString"); return "patched local date"; });
  put(Error.prototype, "toString", function () { hook.called("Error.toString"); return "patched error"; });
  put(Function.prototype, "toString", function () { hook.called("Function.toString"); return "patched function"; });
  put(String.prototype, "at", function (index) { hook.called("String.at"); return "patched at " + index; });
  put(String.prototype, "trim", function () { hook.called("String.trim"); return "patched trim"; });
  put(Set.prototype, "union", function () { hook.called("Set.union"); return "patched union"; });
  put(Performance.prototype, "toJSON", function () { hook.called("Performance.toJSON"); return "patched performance"; });
  put(Number, "parseFloat", () => { hook.called("Number.parseFloat"); return "patched parseFloat"; });
  put(globalThis, "parseInt", () => { hook.called("parseInt"); return "patched parseInt"; });
  put(globalThis, "structuredClone", () => { hook.called("structuredClone"); return "patched clone"; });
}
export function restore() { while (kept.length) { const [holder, name, descriptor] = kept.pop(); Object.defineProperty(holder, name, descriptor); } }
`;
const rows = `
  const rows = [];
  const row = (label, run) => { let calls = 0; const names = []; hook.called = name => { calls++; names.push(name); }; let answer; try { answer = String(run()); } catch (error) { answer = error.name + ": " + error.message; } rows.push(where + " | " + label + " | " + answer.replace(/GMT.*/, "GMT..") + " | " + calls + " " + names.join(",")); };
  row("dates joined", () => [new Date(0), new Date(0)].join("|"));
  row("a date in a template", () => \`\${new Date(0)}\`);
  row("String(date)", () => String(new Date(0)));
  row("date + text", () => new Date(0) + "");
  row("dates sorted", () => [new Date(1), new Date(0)].sort().length);
  row("dates toLocaleString", () => [new Date(0)].toLocaleString() === new Date(0).toLocaleString());
  row("errors joined", () => [new Error("e")].join());
  row("String(error)", () => String(new RangeError("r")));
  row("functions joined", () => [function f() {}].join().length < 30);
  row("function + text", () => (function g() {} + "").slice(0, 16));
  row("text.at", () => "abc".at(1));
  row("text.trim", () => " x ".trim());
  row("set.union", () => { const u = new Set([1]).union(new Set([2])); return typeof u === "string" ? u : [...u].join(); });
  row("performance stringified", () => JSON.stringify({ p: performance }).slice(0, 30).replace(/[0-9.]+/g, "N"));
  row("Number.parseFloat", () => Number.parseFloat("1.5"));
  row("parseInt", () => parseInt("12"));
  row("structuredClone", () => JSON.stringify(structuredClone({ a: 1 })));
  row("a local that the patch changes while join runs", () => { let n = 0; const before = hook.called; hook.called = name => { n++; before(name); }; const text = [new Date(0), new Date(0), new Date(0)].join().length; return n + " " + (text > 0); });
  return rows;
`;

test("what a package stores on built-in objects is found by the code of every layer", async () => {
  using dir = tempDir("a-package-writes-on-built-ins", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": "{}",
    "node_modules/patches/package.json": `{ "name": "patches", "version": "1.0.0", "type": "module", "main": "index.js" }`,
    "node_modules/patches/index.js": patches,
    "src/uses.js": `import { hook } from "patches";\nexport function uses(where) {${rows}}\n`,
    "a.test.js": `
      import { test } from "bun:test";
      import { hook, patch, restore } from "patches";
      import { uses } from "./src/uses.js";
      function usesHere(where) {${rows}}
      test("a", () => {
        for (const state of ["before", "patched", "restored"]) {
          if (state === "patched") patch();
          if (state === "restored") restore();
          for (const line of [...uses(state + " src"), ...usesHere(state + " test file")]) process.stdout.write(line + "\\n");
        }
      });`,
    "z.test.js": `import { test } from "bun:test";\ntest("z", () => {});\n`,
  });
  const seen = async (env: Record<string, string | undefined>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), {
      ...env,
      TZ: "UTC",
    });
    if (exitCode !== 0) console.error(stderr);
    return { exitCode, lines: stdout.split("\n").filter(line => line.includes(" | ")) };
  };
  const plain = await seen(bunEnv);
  expect(plain.exitCode).toBe(0);
  expect(plain.lines.length).toBe(108);
  expect(plain.lines).toContain(
    "patched src | dates joined | patched date|patched date | 2 Date.toString,Date.toString",
  );
  expect(plain.lines).toContain(
    "patched test file | a local that the patch changes while join runs | 3 true | 3 Date.toString,Date.toString,Date.toString",
  );
  expect(await seen(bunEnv, "--aot")).toEqual(plain);
  expect(await seen({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot")).toEqual(
    plain,
  );
});

// The stores stand in the body of the package, so they are done before a file of the project begins, and each value is made in the function that converts it: flow knows
// where it was born, and the build of that function has seen no store.
const storesAtLoad = `export const seen = [];
Date.prototype.toString = function () { seen.push("Date.toString"); return "patched date"; };
Date.prototype.toLocaleString = function () { seen.push("Date.toLocaleString"); return "patched local"; };
Error.prototype.toString = function () { seen.push("Error.toString"); return "patched error"; };
Function.prototype.toString = function () { seen.push("Function.toString"); return "patched function"; };
Set.prototype.union = function () { seen.push("Set.union"); return "patched union"; };
Set.prototype.isSubsetOf = function () { seen.push("Set.isSubsetOf"); return "patched isSubsetOf"; };
Map.prototype.getOrInsert = function () { seen.push("Map.getOrInsert"); return "patched getOrInsert"; };
String.prototype.at = function () { seen.push("String.at"); return "patched at"; };
String.prototype.trim = function () { seen.push("String.trim"); return "patched trim"; };
String.prototype.trimStart = function () { seen.push("String.trimStart"); return "patched trimStart"; };
Number.parseInt = function () { seen.push("Number.parseInt"); return "patched Number.parseInt"; };
globalThis.parseFloat = function () { seen.push("parseFloat"); return "patched parseFloat"; };
globalThis.isNaN = function () { seen.push("isNaN"); return "patched isNaN"; };
Error.prototype.constructor = function Other() {};
`;
const rowsOfValuesBornHere = `
  const rows = [];
  const row = (label, run) => { seen.length = 0; let answer; try { answer = String(run()); } catch (error) { answer = error.name + ": " + error.message; } rows.push(where + " | " + label + " | " + answer + " | " + seen.join(",")); };
  row("a date born here, String()", () => { const d = new Date(0); return String(d); });
  row("a date born here, template", () => { const d = new Date(0); return \`\${d}\`; });
  row("a date born here, + text", () => { const d = new Date(0); return d + "!"; });
  row("a date born here, .toString()", () => { const d = new Date(0); return d.toString(); });
  row("a date born here, .toLocaleString()", () => { const d = new Date(0); return d.toLocaleString(); });
  row("dates born here, joined", () => { const l = [new Date(0), new Date(1)]; return l.join("+"); });
  row("dates born here, list.toString()", () => { const l = [new Date(0)]; return l.toString(); });
  row("dates born here, sorted by default", () => { const l = [new Date(5), new Date(0)]; l.sort(); return seen.length > 0; });
  row("a set born here, union", () => { const a = new Set([1]); const b = new Set([2]); return a.union(b); });
  row("a set born here, isSubsetOf", () => { const a = new Set([1]); return a.isSubsetOf(new Set([1, 2])); });
  row("a map born here, getOrInsert", () => { const m = new Map(); return m.getOrInsert("k", 1); });
  row("an error born here, String()", () => { const e = new TypeError("t"); return String(e); });
  row("an error born here, template", () => { const e = new Error("t"); return \`\${e}\`; });
  row("an error born here, constructor", () => { const e = new Error("t"); return e.constructor.name; });
  row("a function born here, String()", () => { const f = function named() {}; return String(f); });
  row("a function born here, + text", () => { const f = () => 1; return f + ""; });
  row("a text born here, at", () => { const t = "abc"; return t.at(0); });
  row("a text born here, trim", () => { const t = "  abc "; return t.trim(); });
  row("a text born here, trimStart", () => { const t = "  abc "; return t.trimStart(); });
  row("Number.parseInt", () => Number.parseInt("7"));
  row("parseFloat", () => parseFloat("7.5"));
  row("isNaN", () => isNaN(1));
  row("a loop over dates born here", () => { let text = ""; for (let i = 0; i < 3; i++) { const d = new Date(i); text += d; } return text; });
  return rows;
`;

test("what a package stores on built-in objects as it loads is found on values that the layers over it make", async () => {
  using dir = tempDir("a-package-writes-on-built-ins-at-load", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": "{}",
    "node_modules/atload/package.json": `{ "name": "atload", "version": "1.0.0", "type": "module", "main": "index.js" }`,
    "node_modules/atload/index.js": storesAtLoad,
    "src/uses.js": `import { seen } from "atload";\nexport function uses(where) {${rowsOfValuesBornHere}}\n`,
    "a.test.js": `
      import { test } from "bun:test";
      import { seen } from "atload";
      import { uses } from "./src/uses.js";
      function usesHere(where) {${rowsOfValuesBornHere}}
      test("a", () => {
        for (const line of [...uses("src"), ...usesHere("test file")]) process.stdout.write(line + "\\n");
      });`,
    "z.test.js": `import { test } from "bun:test";\ntest("z", () => {});\n`,
  });
  const seen = async (env: Record<string, string | undefined>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), {
      ...env,
      TZ: "UTC",
    });
    if (exitCode !== 0) console.error(stderr);
    return { exitCode, lines: stdout.split("\n").filter(line => line.includes(" | ")) };
  };
  const plain = await seen(bunEnv);
  expect(plain.exitCode).toBe(0);
  expect(plain.lines.length).toBe(46);
  expect(plain.lines).toContain(
    "src | dates born here, joined | patched date+patched date | Date.toString,Date.toString",
  );
  expect(plain.lines).toContain("test file | a set born here, union | patched union | Set.union");
  expect(await seen(bunEnv, "--aot")).toEqual(plain);
  expect(await seen({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot")).toEqual(
    plain,
  );
});
