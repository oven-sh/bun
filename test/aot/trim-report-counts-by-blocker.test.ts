// How many features --trim keeps for a small program that has exactly one reason to keep more than hello world.
// A count that rises means that --trim removes less from every program of that kind: find out why before changing the number.
// A new feature changes some counts by one. `bun check` decides like a build and needs no Bun that can be trimmed.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

async function report(name: string, text: string) {
  using dir = tempDir("aot-trim-report-counts", { [name]: text });
  const command = [bunExe(), "check", "--aot", "--no-pretty", "--trim", "--explain=trim", name];
  const { stderr } = await run(command, String(dir), { ...bunEnv, NO_COLOR: "1" });
  const prefix = "aot: trim: ";
  const lines = stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
  const blockers = lines.flatMap(line => /^blocked by ([a-z-]+):/.exec(line)?.[1] ?? []);
  return {
    kept: lines.filter(line => line.startsWith("kept ")).length,
    removed: lines.filter(line => line.startsWith("removed ")).length,
    blockers: [...new Set(blockers)].sort().join(" "),
  };
}

const fromOutside = `process.argv[2]`;
const helloWorld = `console.log("hi");`;
const everyBlocker = "dynamic-import eval native-code runtime-code";

type Row = readonly [title: string, name: string, text: string, kept: number, blockers: string];

function eachRow(rows: Row[]) {
  const whole = report("main.mjs", helloWorld).then(({ kept, removed }) => kept + removed);
  test.each(rows)("%s", async (_, name, text, kept, blockers) => {
    const said = await report(name, text);
    expect({ kept: said.kept, blockers: said.blockers }).toEqual({ kept, blockers });
    expect(said.kept + said.removed).toBe(await whole);
  });
}

describe.concurrent("one reason to keep more", () => {
  eachRow([
    ["hello world", "main.mjs", helloWorld, 5, ""],
    ["eval", "main.mjs", `console.log(eval(${fromOutside}));`, 87, "dynamic-import eval"],
    ["new Function", "main.mjs", `console.log(new Function(${fromOutside})());`, 86, "dynamic-import eval"],
    [
      "import() of a computed path",
      "main.mjs",
      `console.log(typeof (await import(${fromOutside})));`,
      152,
      "dynamic-import eval native-code",
    ],
    [
      "require() of a computed path",
      "main.cjs",
      `console.log(typeof require(${fromOutside}));`,
      161,
      "dynamic-import eval native-code",
    ],
    [
      "createRequire and a constant path",
      "main.mjs",
      `import { createRequire } from "node:module";\nconsole.log(typeof createRequire(import.meta.url)("node:path").join);`,
      145,
      "dynamic-import runtime-code",
    ],
    [
      "node:vm",
      "main.mjs",
      `import vm from "node:vm";\nconsole.log(vm.runInNewContext(${fromOutside}));`,
      147,
      "dynamic-import runtime-code",
    ],
    ["Bun.plugin", "main.mjs", `Bun.plugin({ name: "made up", setup() {} });`, 215, everyBlocker],
    ["process.dlopen", "main.mjs", `process.dlopen({ exports: {} }, ${fromOutside});`, 142, "native-code"],
  ]);
});

// No symbol names a member that hangs under a string, so such a key opens nothing.
describe.concurrent("a key that is proven to be one symbol keeps what a name of the program's own keeps", () => {
  const key = `Symbol.for("made.up")`;
  eachRow([
    [
      "a name of the program's own is read off the global object",
      "main.mjs",
      `console.log(globalThis.madeUp);`,
      10,
      "",
    ],
    ["a registered symbol is read", "main.mjs", `console.log(globalThis[${key}]);`, 10, ""],
    ["a registered symbol is stored under", "main.mjs", `globalThis[${key}] = 1;`, 5, ""],
    ["a registered symbol is defined", "main.mjs", `Object.defineProperty(globalThis, ${key}, { value: 1 });`, 10, ""],
    [
      "a symbol that the module makes once",
      "main.mjs",
      `const key = Symbol("made up");\nglobalThis[key] = 1;\nconsole.log(globalThis[key]);`,
      10,
      "",
    ],
    [
      "the key is a constant that a function reads",
      "main.mjs",
      `const key = ${key};\nfunction read() {\n  return globalThis[key];\n}\nconsole.log(read());`,
      10,
      "",
    ],
  ]);
});

// Link carries what a closure captures like the fields of a literal, and says where it goes out of sight.
describe.concurrent("an alias of the global object that a closure captures", () => {
  const outer = (body: string) => `function outer() {\n  const g = globalThis;\n  return ${body};\n}\n`;
  eachRow([
    ["is read under a name", "main.mjs", outer("() => typeof g.Array") + `console.log(outer()());`, 5, ""],
    [
      "is read under a name of the program's own",
      "main.mjs",
      outer("() => g.madeUp") + `console.log(outer()());`,
      10,
      "",
    ],
    [
      "is read under a registered symbol",
      "main.mjs",
      outer(`() => g[Symbol.for("made.up")]`) + `console.log(outer()());`,
      10,
      "",
    ],
    [
      "is read under a name in a class",
      "main.mjs",
      outer("class {\n    kind = typeof g.Array;\n  }") + `console.log(new (outer())().kind);`,
      6,
      "",
    ],
    [
      "is read under a string from outside",
      "main.mjs",
      outer("key => typeof g[key]") + `console.log(outer()(${fromOutside}));`,
      164,
      "dynamic-import eval native-code",
    ],
  ]);
});

// A bound Object.defineProperty on the global object, in a constructor that also returns what it read under the key.
test("the first lines of signal-exit open nothing", async () => {
  const said = await report(
    "main.mjs",
    `const kExitEmitter = Symbol.for("signal-exit emitter");
const global = globalThis;
const ObjectDefineProperty = Object.defineProperty.bind(Object);
class Emitter {
  constructor() {
    if (global[kExitEmitter]) return global[kExitEmitter];
    ObjectDefineProperty(global, kExitEmitter, { value: this, writable: false, enumerable: false, configurable: false });
  }
}
console.log(new Emitter() === new Emitter());`,
  );
  expect({ kept: said.kept, blockers: said.blockers }).toEqual({ kept: 11, blockers: "" });
});

describe.concurrent("a key that may be a string keeps what the object leads to", () => {
  eachRow([
    ["a string from outside", "main.mjs", `console.log(typeof globalThis[${fromOutside}]);`, 218, everyBlocker],
    [
      "a symbol or a string",
      "main.mjs",
      `const key = process.argv.length > 9 ? Symbol.for("made.up") : ${fromOutside};\nconsole.log(typeof globalThis[key]);`,
      218,
      everyBlocker,
    ],
    [
      "a variable that is assigned again",
      "main.mjs",
      `let key = Symbol.for("made.up");\nfunction change() {\n  key = ${fromOutside};\n}\nchange();\nconsole.log(typeof globalThis[key]);`,
      218,
      everyBlocker,
    ],
    [
      "a symbol made on every call",
      "main.mjs",
      `function mark() {\n  const key = Symbol("made up");\n  return globalThis[key];\n}\nconsole.log(mark());`,
      218,
      everyBlocker,
    ],
  ]);
});
