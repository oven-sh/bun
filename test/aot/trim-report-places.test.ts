// --explain=trim says where: each way in which code that the compiler has not seen can come to run has a `blocked by` line with the place in the program,
// each feature that is kept because the program uses it has the place where the program names the API, and so has a locale that is no constant.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { describe, test } from "./supported";

const build = ["build", "--compile", "--aot", "--outfile", "main"];
const evaluates = "eval: the program calls eval() or new Function()";
const loadsByName = "dynamic-import: the program calls import() or require() with a dynamic path";
const runsOtherCode = "runtime-code: the program can run code that isn't in the executable";
const importsFromOutside = "external-import: the program imports a module that isn't in the executable";

// The text of a program starts in line 2.
async function report(text: string, files: Record<string, string> = {}, command = ["check", "--aot", "--no-pretty"]) {
  using dir = tempDir("aot-trim-report-places", { "main.ts": "// @ts-nocheck\n" + text, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...command, "--explain=trim", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  const prefix = "aot: trim: ";
  const lines = stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
  return {
    lines,
    whyOpen: lines.filter(line => line.startsWith("blocked by ")).map(line => line.slice("blocked by ".length)),
  };
}

describe.concurrent("a way for unseen code to run has its place in the program", () => {
  test.each([
    ["a direct eval", `eval(process.argv[2]);`, `${evaluates} at main.ts:2:1`],
    ["an indirect eval", `(0, eval)(process.argv[2]);`, `${evaluates} (eval) at main.ts:2:5`],
    ["eval under another name", `const run = eval;\nrun(process.argv[2]);`, `${evaluates} (eval) at main.ts:3:1`],
    [
      "eval that a promise calls",
      `Promise.resolve(process.argv[2]).then(eval);`,
      `${evaluates} (eval) at main.ts:2:39`,
    ],
    ["eval that a timer calls", `setTimeout(eval, 0, process.argv[2]);`, `${evaluates} (eval) at main.ts:2:12`],
    [
      "eval that Reflect.apply calls",
      `Reflect.apply(eval, null, [process.argv[2]]);`,
      `${evaluates} (eval) at main.ts:2:15`,
    ],
    ["eval that is bound", `queueMicrotask(eval.bind(null, process.argv[2]));`, `${evaluates} (eval) at main.ts:2:16`],
    ["new Function", `new Function(process.argv[2]);`, `${evaluates} (Function) at main.ts:2:5`],
    ["a call of Function", `Function(process.argv[2]);`, `${evaluates} (Function) at main.ts:2:1`],
    [
      "Function that Reflect.construct calls",
      `Reflect.construct(Function, [process.argv[2]]);`,
      `${evaluates} (Function) at main.ts:2:19`,
    ],
    ["Function that apply calls", `Function.apply(null, [process.argv[2]]);`, `${evaluates} (Function) at main.ts:2:1`],
    [
      "the constructor of a function",
      `(() => {}).constructor(process.argv[2]);`,
      `${evaluates} (Function) at main.ts:2:12`,
    ],
    [
      "the constructor of async functions",
      `const make = (async () => {}).constructor;\nmake(process.argv[2]);`,
      `${evaluates} (%AsyncFunction%) at main.ts:3:1`,
    ],
    [
      "ShadowRealm.prototype.evaluate",
      `new ShadowRealm().evaluate(process.argv[2]);`,
      `${evaluates} (ShadowRealm.prototype.evaluate) at main.ts:2:19`,
    ],
    ["a computed require", `require(process.argv[2]);`, `${loadsByName} at main.ts:2:1`],
    ["a computed import", `await import(process.argv[2]);`, `${loadsByName} at main.ts:2:7`],
    [
      "require under another name",
      `function load(from) {\n  return from(process.argv[2]);\n}\nload(require);`,
      `${loadsByName} (%ModuleRequire%) at main.ts:3:10`,
    ],
    [
      "process.getBuiltinModule of a computed name",
      `process.getBuiltinModule(process.argv[2]);`,
      `${loadsByName} (process.getBuiltinModule) at main.ts:2:9`,
    ],
    [
      "process.dlopen",
      `process.dlopen({ exports: {} }, process.argv[2]);`,
      `${runsOtherCode} (process.dlopen) at main.ts:2:9`,
    ],
    ["Bun.plugin", `Bun.plugin({ name: "p", setup() {} });`, `${runsOtherCode} (Bun.plugin) at main.ts:2:5`],
    [
      "Bun.Transpiler",
      `new Bun.Transpiler().transformSync(process.argv[2]);`,
      `${runsOtherCode} (Bun.Transpiler) at main.ts:2:9`,
    ],
  ])("%s", async (_, text, line) => {
    expect((await report(text)).whyOpen).toContain(line);
  });

  // The call that lets the code in stands in one of Bun's own modules. The place is the statement of the program that leads there.
  test.each([
    [
      "vm.runInThisContext",
      `import vm from "node:vm";\nvm.runInThisContext(process.argv[2]);`,
      `${runsOtherCode} (%NodeVMBinding%.Script) at main.ts:3:4`,
    ],
    [
      "vm.runInNewContext of what require answers",
      `require("node:vm").runInNewContext(process.argv[2]);`,
      `${runsOtherCode} (%NodeVMBinding%.Script) at main.ts:2:20`,
    ],
    [
      "new vm.Script",
      `import { Script } from "node:vm";\nnew Script(process.argv[2]);`,
      `${runsOtherCode} (%NodeVMBinding%.Script) at main.ts:3:5`,
    ],
    [
      "vm.compileFunction",
      `import { compileFunction } from "node:vm";\ncompileFunction(process.argv[2]);`,
      `${runsOtherCode} (%NodeVMBinding%.compileFunction) at main.ts:3:1`,
    ],
    [
      "dlopen of bun:ffi",
      `import { dlopen } from "bun:ffi";\ndlopen(process.argv[2], {});`,
      `${runsOtherCode} (bun:ffi.dlopen) at main.ts:3:1`,
    ],
    [
      "cc of bun:ffi",
      `import { cc } from "bun:ffi";\ncc({ source: process.argv[2], symbols: {} });`,
      `${runsOtherCode} (bun:ffi.cc) at main.ts:3:1`,
    ],
  ])("%s", async (_, text, line) => {
    const { whyOpen } = await report(text);
    expect(whyOpen).toContain(line);
    expect(whyOpen.filter(why => / at (node|bun|internal)[:/]/.test(why))).toEqual([]);
  });

  test("a native addon that is required", async () => {
    expect((await report(`require("./hello.node");`, { "hello.node": "no addon" })).whyOpen).toContain(
      `${runsOtherCode} (process.dlopen) at main.ts:2:1`,
    );
  });

  test("a call in a dependency", async () => {
    const files = {
      "node_modules/dep/package.json": `{ "name": "dep", "main": "index.js" }`,
      "node_modules/dep/index.js": `exports.make = function (text) {\n  return new Function(text);\n};\n`,
    };
    expect((await report(`import { make } from "dep";\nmake(process.argv[2]);`, files)).whyOpen).toContain(
      `${evaluates} (Function) at node_modules/dep/index.js:2:14`,
    );
  });

  test.each([
    ["is imported", `import value from "outside";\nconsole.log(value);`, "main.ts:3:13"],
    ["is required", `console.log(require("outside"));`, "main.ts:2:13"],
    ["is loaded by import()", `console.log(await import("outside"));`, "main.ts:2:19"],
  ])("a package that is marked --external and %s", async (_, text, place) => {
    expect((await report(text, {}, [...build, "--external", "outside"])).whyOpen).toContain(
      `${importsFromOutside} at ${place}`,
    );
  });

  test("evaluated text imports by name, and no statement of the program does: that line has the place of the evaluator", async () => {
    expect((await report(`new Function(process.argv[2]);`)).whyOpen).toEqual([
      `${evaluates} (Function) at main.ts:2:5`,
      `${loadsByName} (Function) at main.ts:2:5`,
    ]);
  });

  // A Worker has a global of its own and starts with an entry point of the build: nothing comes to run in this program.
  test("a Worker from a computed path lets no code in", async () => {
    const { whyOpen } = await report(`const worker = new Worker(process.argv[2]);\nconsole.log(worker);`);
    expect(whyOpen).toEqual([]);
  });
});

describe.concurrent(
  "a feature that is kept because the program uses it has the place where the program names the API",
  () => {
    const kept = (lines: string[], api: string) =>
      lines
        .filter(line => line.startsWith("kept ") && line.includes(`: used (${api})`))
        .map(line => line.slice(line.indexOf(": used") + 2));

    test.each([
      ["a call", `Bun.serve({ port: 0, fetch: () => new Response("") });`, "Bun.serve", "main.ts:2:1"],
      [
        "a method of a primitive",
        `const price = 1234.5;\nconsole.log(price.toLocaleString("de"));`,
        "Number.prototype.toLocaleString",
        "main.ts:3:13",
      ],
      ["a construction", `console.log(new Bun.Glob("*.ts").match("a.ts"));`, "Bun.Glob", "main.ts:2:17"],
      [
        "an import",
        `import { Database } from "bun:sqlite";\nconsole.log(new Database(":memory:").filename);`,
        "bun:sqlite",
        "main.ts:1:1",
      ],
      ["a require", `console.log(require("bun:sqlite").Database.name);`, "bun:sqlite", "main.ts:2:13"],
      [
        "the first of two",
        `function late() {\n  return Bun.hash("b");\n}\nconsole.log(Bun.hash("a"), late());`,
        "Bun.hash",
        "main.ts:3:10",
      ],
    ])("%s", async (_, text, api, place) => {
      expect(kept((await report(text)).lines, api)).toContain(`used (${api}) at ${place}`);
    });

    test("an API that only one of Bun's own modules names has the statement of the program that leads there", async () => {
      const { lines } = await report(`import { createServer } from "node:http";\ncreateServer(() => {}).listen(0);`);
      const places = lines
        .filter(line => line.startsWith("kept ") && / at \S+:\d+:\d+$/.test(line))
        .map(line => line.slice(line.lastIndexOf(" at ") + 4));
      expect(places).not.toBeEmpty();
      expect(places.filter(place => !place.startsWith("main.ts:"))).toEqual([]);
    });

    test("a method that a read under a computed key hands out has the place of the read", async () => {
      const { lines } = await report(
        `const cookies = JSON.parse(process.argv[2]);\nconsole.log(cookies[process.argv[3]]("b"));`,
      );
      expect(kept(lines, "String.prototype.normalize")).toEqual(["used (String.prototype.normalize) at main.ts:3:13"]);
      expect(lines).toContain("removed Intl.Collator and localeCompare (intl): unused");
    });

    // The function is there and prints its name. Nobody calls it, so what is behind it is not kept.
    test("a method that a read under a computed key hands out and that is only printed is not kept", async () => {
      const { lines } = await report(
        `const cookies = JSON.parse(process.argv[2]);\nconsole.log(cookies[process.argv[3]]);`,
      );
      expect(kept(lines, "String.prototype.localeCompare")).toEqual([]);
      expect(lines).toContain("removed Intl.Collator and localeCompare (intl): unused");
    });
  },
);
