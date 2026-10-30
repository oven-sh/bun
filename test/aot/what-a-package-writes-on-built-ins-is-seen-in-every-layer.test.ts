import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(120_000);

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
