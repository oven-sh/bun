import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { declared, of, runtimeUse, tsconfig, withDeclarations } from "./runtime-use-harness";
import { test } from "./supported";

describe.concurrent("prototypes that process and performance inherit from, and the program can write", () => {
  const declaredHere = `declare const process: any, performance: any, console: any, require: any, EventTarget: any, Performance: any;\n`;
  const used = async (text: string) => {
    const use = await runtimeUse({ "main.ts": declaredHere + text });
    return { world: use.world, whyOpen: use.whyOpen, process: use.facts.has("process *"), performance: use.facts.has("performance *") };
  };
  const me = `function (this: any) { return this; }`;

  test.each([
    ["a store", `import { EventEmitter } from "node:events"; EventEmitter.prototype.me = ${me};`],
    ["a store through the default export", `import EventEmitter from "node:events"; EventEmitter.prototype.me = ${me};`],
    ["a store through the namespace", `import * as events from "events"; events.EventEmitter.prototype.me = ${me};`],
    ["a store through require", `require("node:events").prototype.me = ${me};`],
    ["a store through what is taken out of require", `const { EventEmitter: Emitter } = require("events"); Emitter.prototype.me = ${me};`],
    ["a store through EventEmitter.EventEmitter", `import EventEmitter from "node:events"; EventEmitter.EventEmitter.prototype.me = ${me};`],
    ["a store under a computed name", `import { EventEmitter } from "node:events"; EventEmitter.prototype[process.argv[2]] = ${me};`],
    ["a store through a variable that holds it", `import { EventEmitter } from "node:events"; const held = EventEmitter.prototype; held.me = ${me};`],
    ["delete", `import { EventEmitter } from "node:events"; delete EventEmitter.prototype.setMaxListeners;`],
    ["Object.defineProperty", `import { EventEmitter } from "node:events"; Object.defineProperty(EventEmitter.prototype, "me", { get: ${me} });`],
    ["Object.assign", `import { EventEmitter } from "node:events"; Object.assign(EventEmitter.prototype, { me: ${me} });`],
    ["Reflect.set", `import { EventEmitter } from "node:events"; Reflect.set(EventEmitter.prototype, "me", ${me});`],
    ["Object.setPrototypeOf", `import { EventEmitter } from "node:events"; Object.setPrototypeOf(EventEmitter.prototype, { me: ${me} });`],
    ["a store to its __proto__", `import { EventEmitter } from "node:events"; EventEmitter.prototype.__proto__ = { me: ${me} };`],
    ["__defineGetter__", `import { EventEmitter } from "node:events"; EventEmitter.prototype.__defineGetter__("me", ${me});`],
    ["a function that is handed it", `import { EventEmitter } from "node:events"; function patch(given: any) { given.me = ${me}; } patch(EventEmitter.prototype);`],
    ["a pattern that takes it out", `import { EventEmitter } from "node:events"; const { prototype } = EventEmitter; prototype.me = ${me};`],
  ])("process escapes with %s on EventEmitter.prototype", async (_, text) => {
    expect(await used(text + "\nexport {};")).toMatchObject({ world: "open", whyOpen: ["process"] });
  });

  test.each([
    ["a method of it that is called", `import { EventEmitter } from "node:events"; const mine = {}; EventEmitter.prototype.on.call(mine, "a", () => {});`],
    ["Object.create", `import { EventEmitter } from "node:events"; console.log(Object.create(EventEmitter.prototype));`],
    ["Object.setPrototypeOf of a prototype of the program's own", `import { EventEmitter } from "node:events"; function Mine() {} Object.setPrototypeOf(Mine.prototype, EventEmitter.prototype);`],
    ["a store of it to the __proto__ of a prototype of the program's own", `import { EventEmitter } from "node:events"; function Mine() {} Mine.prototype.__proto__ = EventEmitter.prototype;`],
    ["Object.assign that copies from it", `import { EventEmitter } from "node:events"; console.log(Object.assign({}, EventEmitter.prototype));`],
    ["a comparison", `import { EventEmitter } from "node:events"; console.log(Object.getPrototypeOf({}) === EventEmitter.prototype);`],
    ["a variable that holds it and is only read", `import { EventEmitter } from "node:events"; const held = EventEmitter.prototype; console.log(typeof held.on, "on" in held);`],
    ["a store on the prototype of a class that extends it", `import { EventEmitter } from "node:events"; class Mine extends EventEmitter {} (Mine.prototype as any).me = ${me};`],
    ["a store on the prototype of another class with that name", `class EventEmitter {} (EventEmitter.prototype as any).me = ${me}; export {};`],
  ])("process does not escape with %s", async (_, text) => {
    expect(await used(text)).toMatchObject({ world: "closed", whyOpen: [] });
  });

  test("whoever can reach EventEmitter.prototype may be handed process: all of its members stay", async () => {
    expect(await used(`import { EventEmitter } from "node:events"; console.log(new EventEmitter());`)).toEqual({ world: "closed", whyOpen: [], process: true, performance: false });
    expect(await used(`console.log(1);`)).toEqual({ world: "closed", whyOpen: [], process: false, performance: false });
  });

  test.each([
    ["a call", `console.log(process.me());`],
    ["a read", `console.log(process.noDeprecation);`],
    ["typeof", `console.log(typeof process.type);`],
    ["a store, which may find a setter", `process.mine = 1;`],
  ])("with node:events in the program, %s of what is no member of process opens the world", async (_, text) => {
    expect(await used(`import { EventEmitter } from "node:events"; console.log(new EventEmitter());\n` + text)).toMatchObject({ world: "open", whyOpen: ["a member that process may inherit from EventEmitter.prototype"] });
    expect(await used(text)).toMatchObject({ world: "closed", whyOpen: [] });
  });

  test("members of process, and of the native prototype in front of EventEmitter.prototype, are found before it", async () => {
    const text = `import { EventEmitter } from "node:events"; console.log(new EventEmitter(), process.pid, process.argv, process.exitCode, process.listenerCount("exit"), process.eventNames());`;
    expect(await used(text)).toMatchObject({ world: "closed", whyOpen: [] });
  });

  test.each([
    ["EventTarget.prototype", `EventTarget.prototype.me = ${me};`],
    ["globalThis.EventTarget.prototype", `(globalThis as any).EventTarget.prototype.me = ${me};`],
    ["Performance.prototype", `Object.defineProperty(Performance.prototype, "me", { get: ${me} });`],
  ])("a write to %s leaves the world closed and keeps every member of performance", async (_, text) => {
    expect(await used(text)).toMatchObject({ world: "closed", whyOpen: [], performance: true });
  });

  test.each([
    ["no member of it", `console.log(performance.me());`, true],
    ["inherited from EventTarget.prototype", `performance.dispatchEvent(new Event("a"));`, true],
    ["its own", `console.log(performance.now());`, false],
    ["on Performance.prototype", `console.log(performance.timeOrigin);`, false],
  ])("what is read from performance and is %s", async (_, text, any) => {
    expect(await used(`declare const Event: any;\n` + text)).toMatchObject({ world: "closed", whyOpen: [], performance: any });
  });

  test("EventTarget.prototype that is only read keeps nothing", async () => {
    expect(await used(`console.log(typeof EventTarget.prototype.addEventListener);`)).toMatchObject({ world: "closed", performance: false });
  });
});

describe.concurrent("import name = a.b, which only TypeScript has", () => {
  const used = async (text: string) => {
    const use = await runtimeUse({ "main.ts": `declare const console: any;\n` + text });
    return { world: use.world, whyOpen: use.whyOpen, named: ["Bun color", "process report", "global Intl", "global HTMLRewriter", "property NumberFormat", "console *"].filter(fact => use.facts.has(fact)) };
  };
  const bun = `declare namespace Bun { function color(name: string, format: string): string; }\n`;

  test.each([
    ["a member of Bun", bun + `import paint = Bun.color; console.log(paint("red", "hex"));`, ["Bun color"]],
    ["a member of Bun of the global object", `declare namespace globalThis { namespace Bun { function color(name: string, format: string): string; } }\nimport paint = globalThis.Bun.color; console.log(paint("red", "hex"));`, ["Bun color"]],
    ["a member of process", `declare namespace process { const report: unknown; }\nimport report = process.report; console.log(report);`, ["process report"]],
    ["a global", `declare namespace HTMLRewriter { const one: number; }\nimport Rewriter = HTMLRewriter; console.log(Rewriter.one);`, ["global HTMLRewriter"]],
    ["a member of a global", `import Format = Intl.NumberFormat; console.log(new Format("de").format(1.5));`, ["global Intl", "property NumberFormat"]],
    ["console", `declare namespace console { function log(...values: unknown[]): void; }\nimport out = console; out.log(1);`, ["console *"]],
  ])("names %s", async (_, text, named) => {
    const use = await runtimeUse({ "main.ts": (text.includes("namespace console") ? "" : `declare const console: any;\n`) + text });
    expect({ world: use.world, whyOpen: use.whyOpen, named: named.filter(fact => use.facts.has(fact)) }).toEqual({ world: "closed", whyOpen: [], named });
  });

  test("Bun as a whole escapes", async () => {
    expect(await used(bun + `import B = Bun; console.log(B.color("red", "hex"));`)).toMatchObject({ world: "open", whyOpen: ["Bun"] });
  });

  test.each([
    ["a namespace of the program's own with that name", `namespace Bun { export function color(name: string, format: string) { return name + format; } }\nimport paint = Bun.color; console.log(paint("red", "hex"));`],
    ["an alias for a type alone", bun + `declare namespace Bun { interface Shade { name: string } }\nimport type Shade = Bun.Shade; let held: Shade | undefined; console.log(held);`],
  ])("names nothing of Bun with %s", async (_, text) => {
    expect(await used(text)).toEqual({ world: "closed", whyOpen: [], named: [] });
  });
});

describe.concurrent("the getter of self hands out the global object to whoever calls it", () => {
  test.each([
    ["the getter of self", `console.log((globalThis as any).__lookupGetter__("self")());`],
    ["the getter of self, through a variable", `const everything: any = globalThis; console.log(everything.__lookupGetter__("self")());`],
    ["the getter of a computed name", `console.log((globalThis as any).__lookupGetter__(process.argv[2])());`],
  ])("the global object escapes with %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: ["the global object"] });
  });

  test("the getter of another member names the member", async () => {
    const use = await of(`console.log((globalThis as any).__lookupGetter__("HTMLRewriter"));`);
    expect({ world: use.world, named: use.facts.has("global HTMLRewriter") }).toEqual({ world: "closed", named: true });
  });
});

describe.concurrent("require with a second argument is not the require that the build resolves", () => {
  test.each([
    ["a built-in module", `console.log(require("bun:sqlite", 0));`],
    ["Bun", `console.log(require("bun", 0).color("red", "hex"));`],
    ["a file", `console.log(require("./other", 0));`],
  ])("the world opens with %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared + text, "other.ts": `export const one = 1;` });
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: ["require"] });
  });
});

describe.concurrent("the descriptor of a member of the global object holds the member", () => {
  test.each([
    ["Bun", `console.log(Object.getOwnPropertyDescriptor(globalThis, "Bun")!.value.color("red", "hex"));`],
    ["process", `console.log(typeof Object.getOwnPropertyDescriptor(globalThis, "process")!.value.report);`],
  ])("%s escapes with the global object", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: ["the global object"] });
  });

  test("another member is named", async () => {
    const use = await of(`console.log(Object.getOwnPropertyDescriptor(globalThis, "HTMLRewriter")!.value);`);
    expect({ world: use.world, named: use.facts.has("global HTMLRewriter") }).toEqual({ world: "closed", named: true });
  });
});

describe.concurrent("Function makes code from text however it is called", () => {
  test.each([
    ["Function.call", `console.log(Function.call(null, "return 1")());`],
    ["Function.apply", `console.log(Function.apply(null, ["return 1"])());`],
    ["Function.bind", `console.log(Function.bind(null, "return 1")()());`],
    ["call in brackets", `console.log((Function as any)["call"](null, "return 1")());`],
    ["Function.valueOf", `console.log((Function.valueOf() as any)("return 1")());`],
    ["Function.constructor", `console.log(Function.constructor("return 1")());`],
    ["globalThis.Function.call", `console.log(globalThis.Function.call(null, "return 1")());`],
    ["Reflect.apply", `console.log(Reflect.apply(Function, null, ["return 1"])());`],
    ["Reflect.construct", `console.log(Reflect.construct(Function, ["return 1"])());`],
    ["a class that extends it", `class Mine extends Function {} console.log(new Mine("return 1")());`],
    ["call, taken out of it", `const { call } = Function; console.log(call);`],
  ])("%s opens the world", async (_, text) => {
    expect((await of(text)).world).toBe("open");
  });

  test.each([
    ["Function.prototype.toString", `console.log(Function.prototype.toString.call(() => 1));`],
    ["Function.prototype.call", `console.log(Function.prototype.call.call((one: number) => one, null, 1));`],
    ["Function.name and Function.length", `console.log(Function.name, Function.length);`],
    ["instanceof Function", `console.log((() => 1) instanceof Function);`],
    ["typeof Function", `console.log(typeof Function);`],
    ["call of a function of the program's own", `function mine(this: any, text: string) { return text; } console.log(mine.call(null, "return 1"));`],
    ["a class of the program's own with that name", `export {}; class Function { static call(one: any, text: string) { return text; } } console.log(Function.call(null, "return 1"));`],
  ])("%s does not", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("members of Bun that load or run code the compiler has not seen", () => {
  test.each([
    ["Bun.ModuleGraph", `console.log(await new Bun.ModuleGraph().import(process.argv[2]));\nexport {};`, "Bun.ModuleGraph"],
    ["Bun.ModuleGraph that is imported", `import { ModuleGraph } from "bun";\nconsole.log(new ModuleGraph());`, "Bun.ModuleGraph"],
    ["Bun.ModuleGraph that is taken out", `const { ModuleGraph } = Bun;\nconsole.log(new ModuleGraph());`, "Bun.ModuleGraph"],
  ])("%s", async (_, text, why) => {
    const use = await of(text);
    expect({ world: use.world, isSaid: use.whyOpen.includes(why) }).toEqual({ world: "open", isSaid: true });
  });

  test.each([
    ["Bun.build", `console.log(await Bun.build({ entrypoints: [process.argv[2]] }));\nexport {};`, "Bun build"],
    ["build that is imported from bun", `import { build } from "bun";\nconsole.log(await build({ entrypoints: [process.argv[2]] }));`, "Bun build"],
    ["Bun.build that is handed on", `const build = Bun.build;\nconsole.log(await build({ entrypoints: [process.argv[2]] }));\nexport {};`, "Bun build"],
    ["Bun.Transpiler", `console.log(new Bun.Transpiler().transformSync(process.argv[2]));`, "Bun Transpiler"],
  ])("%s turns text into text, which runs only if the program then loads or evaluates it: it is named and opens nothing", async (_, text, fact) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen, isNamed: use.facts.has(fact) }).toEqual({ world: "closed", whyOpen: [], isNamed: true });
  });

  test.each([
    ["the type of Bun.ModuleGraph", `console.log(typeof Bun.ModuleGraph, typeof Bun.build, typeof Bun.Transpiler);`],
    ["members of an object of the program's own", `const mine = { ModuleGraph: Map, build() {}, Transpiler: Map }; console.log(new mine.ModuleGraph(), mine.build(), new mine.Transpiler());`],
    ["Bun.build in a function that nothing mentions", `function never() { return Bun.build({ entrypoints: [] }); }\nconsole.log(1);`],
  ])("not %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("a library that SQLite is told to load is native code that the compiler has not seen", () => {
  const why = "a member that makes or loads code, read from what may be the global object, process or Bun";

  test.each([
    ["loadExtension of a database", `import { Database } from "bun:sqlite";\nnew Database(":memory:").loadExtension(process.argv[2]);`],
    ["loadExtension of a database of node:sqlite", `import { DatabaseSync } from "node:sqlite";\nnew DatabaseSync(":memory:", { allowExtension: true }).loadExtension(process.argv[2]);`],
    ["enableLoadExtension", `import { DatabaseSync } from "node:sqlite";\nnew DatabaseSync(":memory:", { allowExtension: true }).enableLoadExtension(true);`],
    ["setCustomSQLite", `import { Database } from "bun:sqlite";\nDatabase.setCustomSQLite(process.argv[2]);`],
    ["loadExtension of a database that a function is given", `function extend(database: any) { database.loadExtension(process.argv[2]); }\nconsole.log(extend);`],
  ])("the world opens with %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: [why] });
  });

  test.each([
    ["a database that loads nothing", `import { Database } from "bun:sqlite";\nconsole.log(new Database(":memory:").query("select 1").get());`],
    ["a method of that name of a class of the program's own", `class Mine { loadExtension(name: string) { return name; } }\nconsole.log(new Mine().loadExtension("a"));`],
    ["loadExtension in a function that nothing mentions", `import { Database } from "bun:sqlite";\nfunction never() { new Database(":memory:").loadExtension(process.argv[2]); }\nconsole.log(1);`],
  ])("the world stays closed with %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("in an executable built with --disallow-code-generation-from-strings no string becomes code through eval or Function", () => {
  const withTheFlag = (text: string, flag = "--disallow-code-generation-from-strings") => runtimeUse({ "main.ts": declared + text }, ["check", "--aot", "--no-pretty", flag]);
  const given = `const given: any = JSON.parse(process.argv[2]);\n`;

  test("the world stays closed with a direct eval", async () => {
    const files = { "main.ts": `eval("1");\nexport {};` };
    const [without, use] = await Promise.all([runtimeUse(files), runtimeUse(files, ["check", "--aot", "--no-pretty", "--disallow-code-generation-from-strings"])]);
    expect({ without: without.world, first: use.lines[0] }).toEqual({ without: "open", first: "closed" });
  });

  test.each([
    ["eval that is called indirectly", `(0, eval)("1");`],
    ["eval that is handed on", `console.log([eval].length);`],
    ["eval of the global object", `console.log((globalThis as any).eval("1"));`],
    ["the Function constructor", `new Function("return 1")();`],
    ["the Function constructor that is handed on", `console.log([Function].length);`],
    ["Function('return this')()", `console.log(Function("return this")().Object);`],
    ["Function.call", `console.log(Function.call(null, "return 1")());`],
    ["a class that extends Function", `class Mine extends Function {} console.log(new Mine("return 1")());`],
    ["eval of a value that is not known", given + `console.log(given.eval("1"));`],
    ["Function of a value that is not known", given + `console.log(new given.Function("return 1"));`],
  ])("the world stays closed with %s", async (_, text) => {
    const [without, use, strict] = await Promise.all([of(text), withTheFlag(text), withTheFlag(text, "--disallow-code-generation-from-strings=strict")]);
    expect({ without: without.world, first: use.lines[0], strict: strict.lines[0] }).toEqual({ without: "open", first: "closed", strict: "closed" });
  });

  test.each([
    ["the constructor of a function", `console.log((function () {}).constructor("return 1")());`],
    ["the constructor of an async function", `console.log((async function () {}).constructor("return 1"));`],
    ["a computed name read from what may be a function", given + `console.log(given[process.argv[3]]);`],
    ["constructor of a value that is not known", given + `console.log(given.constructor("return 1"));`],
  ])("the world is closed with and without the flag with %s", async (_, text) => {
    const [without, use, strict] = await Promise.all([of(text), withTheFlag(text), withTheFlag(text, "--disallow-code-generation-from-strings=strict")]);
    expect({ without: without.world, first: use.lines[0], strict: strict.lines[0] }).toEqual({ without: "closed", first: "closed", strict: "closed" });
  });

  test.each([
    ["require of a computed name", `console.log(require(process.argv[2]));`],
    ["import() of a computed name", `const name: string = process.argv[2]; import(name);`],
    ["a Worker", `new Worker("./worker.ts");`],
    ["node:vm", `import vm from "node:vm";\nconsole.log(vm.runInNewContext("1"));`],
    ["process.dlopen", `process.dlopen(module, "./addon.node");`],
    ["require of a value that is not known", given + `console.log(given.require("node:fs"));`],
    ["a computed name of Bun", `console.log(Bun[process.argv[2]]);`],
    ["a computed name read from what may be a database", `import { Database } from "bun:sqlite";\nconsole.log((new Database(":memory:") as any)[process.argv[2]]("a"));`],
  ])("the world is still open with %s", async (_, text) => {
    expect((await withTheFlag(text)).world).toBe("open");
  });

  test.each([
    ["node:http", `import http from "node:http";\nhttp.createServer((request, response) => response.end("hello")).listen(0);`],
    ["node:events", `import { EventEmitter } from "node:events";\nnew EventEmitter().emit("hello");`],
    ["node:fs", `import { readFileSync } from "node:fs";\nconsole.log(readFileSync("a").length);`],
  ])("the runtime's own JavaScript behind %s opens nothing", async (_, text) => {
    expect((await withTheFlag(text)).lines[0]).toBe("closed");
  });

  test("a regular expression may be made from text by the constructor of one", async () => {
    const use = await withTheFlag(given + `console.log(new given.constructor(process.argv[3], "u").test("a"));`);
    expect({ first: use.lines[0], isMadeFromText: use.facts.has("regexp computed") }).toEqual({ first: "closed", isMadeFromText: true });
  });

  test("eval and Function are named as other globals are", async () => {
    const use = await withTheFlag(`(0, eval)("1"); new Function("return 1");`);
    expect({ eval: use.facts.has("global eval"), Function: use.facts.has("global Function") }).toEqual({ eval: true, Function: true });
  });
});

describe.concurrent("an object literal that only one variable holds, read by a key that is not seen", () => {
  const key = `const key: string = process.argv[2];\n`;
  const table = `const table = { home: () => "home", about: () => "about" };\n`;
  const called = `const found = (table as any)[key];\nconsole.log(found ? found() : "none");`;
  const judged = async (text: string, entryPoint = "main.ts") => {
    const use = await runtimeUse({ [entryPoint]: (entryPoint.endsWith(".ts") ? declared + key : `const key = process.argv[2];\n`) + text }, undefined, entryPoint);
    return { readsAnyProperty: use.facts.has("property *"), exitCode: use.exitCode };
  };
  const none = { readsAnyProperty: false, exitCode: 0 };
  const any = { readsAnyProperty: true, exitCode: 0 };

  test.each([
    ["what is found is kept, tested and called", table + called],
    ["it is declared as a table of functions", `const table: Record<string, () => string> = { home: () => "home", "/about": () => "about" };\nconst found = table[key];\nconsole.log(found ? found() : "none");`],
    ["it is read inside a function", `${table}function run(name: string) {\n  const found = (table as any)[name];\n  return found ? found() : "none";\n}\nconsole.log(run(key));`],
    ["it is asserted where it is written", `const table = { home: () => "home" } as const;\n${called}`],
    ["it satisfies a type", `const table = { home: () => "home" } satisfies Record<string, () => string>;\n${called}`],
    ["it is asked for the key first", `${table}if (key in table) {\n  ${called}\n}`],
    ["it is asked whether the key is its own", `${table}if (Object.hasOwn(table, key)) {\n  ${called}\n}`],
    ["its keys are listed", `${table}console.log(Object.keys(table).join(", "), Object.getOwnPropertyNames(table).length);\n${called}`],
    ["its members are listed", `${table}for (const [name, member] of Object.entries(table)) console.log(name, member());\nconsole.log(Object.values(table).length);\n${called}`],
    ["its keys are gone through", `${table}for (const name in table) console.log(name);\n${called}`],
    ["it is read by written names too", `${table}console.log(typeof table.home);\n${called}`],
    ["it has methods", `const table = { home() { return "home"; } };\n${called}`],
    ["it lies in a function", `function run(name: string) {\n  const table: Record<string, () => string> = { home: () => "home" };\n  const found = table[name];\n  return found ? found() : "none";\n}\nconsole.log(run(key));`],
    ["its type is asked for", `${table}type Name = keyof typeof table;\nconst found = table[key as Name];\nconsole.log(found ? found() : "none");`],
    ["what is found or else another function is called", `${table}console.log(((table as any)[key] ?? (() => "none"))());`],
    ["what is found is compared", `${table}console.log((table as any)[key] === undefined ? "none" : "some");\n${called}`],
    ["what is found is compared by size", `const table = { low: 0, high: 2 };\nconst found = (table as any)[key] ?? 1;\nif (found > 0) console.log("some");`],
    ["what is found is joined to a text", "const table: Record<string, string> = { red: 'r' };\nconsole.log(table[key] + 'text', `${table[key]}text`);"],
    ["what is found is added up", `const table = { one: 1 };\nlet sum = 0;\nsum += (table as any)[key] ?? 0;\nconsole.log(sum, -(table as any)[key], +(table as any)[key] * 2);`],
    ["what is found is called if it is there", `${table}const found = (table as any)[key];\nconsole.log(found?.());`],
    ["a variable that is never stored to holds it", `let table = { home: () => "home" };\n${called}`],
    ["a var that is never stored to holds it, and what is found", `var table = { low: 1, high: 1 << 10 };\nfunction size(value: number, unit: string) {\n  var found = value / (table as any)[unit.toLowerCase()];\n  return found;\n}\nconsole.log(size(1, key));`],
    ["a number is stored under a key", `const table = {};\n(table as any)[key] = ((table as any)[key] ?? 0) + 1;\nif ((table as any)[key] > 1) console.log("again");`],
    ["a text is stored under a name", `${table}(table as any).more = "more";\n${called}`],
    ["a text, a number or nothing is stored under a key", `${table}(table as any)[key] = process.argv.length > 3 ? \`\${key}\` : (process.argv.length > 4 || null);\n${called}`],
    ["a member is counted up", `const table = { home: 1 };\n(table as any)[process.argv[3]]++;\n--(table as any)[process.argv[3]];\n${called}`],
    ["it is an enum", `enum Color {\n  Red,\n  Green = 1 << 2,\n  Blue = "blue",\n}\nconsole.log(Color[key as keyof typeof Color] === Color.Red, typeof Color[process.argv.length], Color.Green);\nconst found = (Color as any)[key];\nconsole.log(found ? found() : "none");`],
    ["a member is added to", `const table = { home: 1 };\n(table as any)[process.argv[3]] += process.argv.length;\n(table as any)[process.argv[3]] -= 1;\n${called}`],
    ["what is found is called in place and what it answers is dropped", `${table}(table as any)[key]();`],
    ["what is found is called in place with one argument", `${table}(table as any)[key](process.argv[3]);`],
    ["what is found under a key that is put together is called in place", `${table}(table as any)[String(process.argv[3]).trim()]();\n(table as any)[process.argv[3]]();`],
    ["what is found is called in place if it is there, and what it answers is dropped", `${table}(table as any)[key]?.();`],
    ["what is found is called in place, awaited and dropped", `${table}await (table as any)[key](process.argv[3]);\nexport {};`],
    ["what is found is called in place and what it answers is only tested", `${table}if ((table as any)[key]()) console.log("some");`],
    ["it has methods that do not say this, and what is found is called in place", `const table: Record<string, () => void> = { home() { console.log("home"); } };\ntable[key]();`],
    ["a member of it is called by its name, and what it answers is handed on", `${table}console.log(table.home());\n${called}`],
  ])("no other property is read where %s", async (_, text) => {
    expect(await judged(text)).toEqual(none);
  });

  const leftOutUnlessNamed = ["__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"].map(name => "property " + name);

  test.each([
    ["a table that one constant holds", table + called],
    ["an instance of a class of the program's own", `class Point {\n  x = 1;\n}\nconsole.log(typeof new Point()[key as keyof Point]);`],
  ])("the key may name what Object.prototype hands down: its members that an executable may leave out are named where %s is read by a key", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared + key + text });
    expect({ named: leftOutUnlessNamed.filter(line => use.facts.has(line)), readsAnyProperty: use.facts.has("property *") }).toEqual({ named: leftOutUnlessNamed, readsAnyProperty: false });
  });

  test("no other property is read in JavaScript", async () => {
    expect(await judged(`const table = { home: () => "home" };\nconst found = table[key];\nconsole.log(found ? found() : "none");`, "main.mjs")).toEqual(none);
  });

  test.each([
    ["what is found is called in place, with the table as this", `${table}console.log((table as any)[key]());`],
    ["what is found is called in place behind an assertion", `${table}console.log(((table as any)[key] as any)());`],
    ["what is found is called in place if it is there", `${table}console.log((table as any)[key]?.());`],
    ["what is found is constructed in place", `${table}console.log(new (table as any)[key]());`],
    ["what is found tags a template", `${table}console.log((table as any)[key]\`a\`);`],
    ["a method of it is called", `const table = { home() { return this; } };\nconsole.log(table.home());\n${called}`],
    ["what is found is called in place under a key that the tag another read finds makes", "const table = { home: () => 1 };\nconst other: any = { home: () => 1 };\nconsole.log(typeof other);\n(table as any)[other[key]`a`]();"],
    ["it is handed to a function of Object that hands it back", `${table}console.log(Object.freeze(table));\n${called}`],
    ["it is the second argument of a function of Object", `${table}console.log(Object.assign({}, table), Object.hasOwn({}, table as any));\n${called}`.replace("Object.assign({}, table), ", "")],
    ["it is handed to keys of an Object of the program's own", `${table}{\n  const Object = { keys: (given: unknown) => given };\n  console.log(Object.keys(table));\n}\n${called}`],
    ["what is found is called in place and what it answers is kept", `${table}const answer = (table as any)[key]();\nconsole.log(typeof answer);`],
    ["what is found is called in place and what it answers is returned", `${table}function run(name: string) {\n  return (table as any)[name]();\n}\nrun(key);`],
    ["what is found is called in place, awaited and handed on", `${table}console.log(await (table as any)[key]());\nexport {};`],
    ["what is found is called in place with two arguments", `${table}(table as any)[key](process.argv[3], () => 1);`],
    ["what is found is called in place with arguments that are spread", `${table}(table as any)[key](...process.argv);`],
    ["what is found is called in place, and a member says this", `const table = { home() { return this; } };\n(table as any)[key]();`],
    ["what is found is called in place, and a member says this in an arrow function", `const table = { home() { return () => this; } };\n(table as any)[key]();`],
    ["what is found is called in place, and a member says super", `const table = { home() { return super.valueOf(); } };\n(table as any)[key]();`],
    ["what is found is called in place, and a member is no function written in place", `function other(this: unknown) { return this; }\nconst table = { home: other };\n(table as any)[key]();`],
    ["what is found is constructed in place and dropped", `${table}new (table as any)[key]();`],
    ["what is found tags a template and what it answers is dropped", "const table = { home: () => 1 };\n(table as any)[key]`a`;"],
    ["a member of Object.prototype is called by its name, and what it answers is handed on", `${table}console.log(table.valueOf());\n${called}`],
    ["it is handed on", `${table}console.log(table);\n${called}`],
    ["its prototype is set", `${table}Object.setPrototypeOf(table, function () {});\n${called}`],
    ["another constant holds it too", `${table}const other: any = table;\nconsole.log(typeof other);\n${called}`],
    ["it is stored to by a key", `${table}(table as any)[process.argv[3]] = process.argv[4];\n${called}`],
    ["it is stored to by a name", `${table}(table as any).more = process.argv[4];\n${called}`],
    ["a member is deleted", `${table}delete (table as any)[process.argv[3]];\n${called}`],
    ["what may be an object is stored if nothing is there", `${table}(table as any)[process.argv[3]] ??= 1;\n${called}`],
    ["a function is stored under a key", `${table}(table as any)[process.argv[3]] = () => "more";\n${called}`],
    ["a number or what may be an object is stored under a key", `${table}(table as any)[process.argv[3]] = process.argv.length > 3 ? 1 : process.argv;\n${called}`],
    ["a list is stored under a name through the rest of a pattern", `${table}[...(table as any).__proto__] = [];\n${called}`],
    ["an object is stored under a key through the rest of a pattern", `${table}({ ...(table as any)[process.argv[3]] } = { more: 1 });\n${called}`],
    ["it is stored to through a pattern", `${table}[(table as any)[process.argv[3]]] = [1];\n${called}`],
    ["it is taken apart", `${table}const { home } = table;\nconsole.log(typeof home);\n${called}`],
    ["it is spread", `${table}console.log(typeof { ...table });\n${called}`],
    ["it is a member of another literal", `${table}console.log(typeof { table });\n${called}`],
    ["it is returned", `${table}function all() {\n  return table;\n}\nconsole.log(typeof all());\n${called}`],
    ["a member of it hands it out", `const table = { home: () => table };\n${called}`],
    ["it is exported where it is declared", `export ${table}${called}`],
    ["it is exported by name", `${table}export { table };\n${called}`],
    ["it is the default export", `${table}export default table;\n${called}`],
    ["it is a variable that is stored to", `let table = { home: () => "home" };\nif (process.argv.length > 5) table = process.argv as any;\n${called}`],
    ["it is a variable that is stored to through a pattern", `let table = { home: () => "home" };\nif (process.argv.length > 5) [table] = [process.argv as any];\n${called}`],
    ["it is a variable that a loop stores to", `let table = { home: () => "home" };\nfor (table of [process.argv as any]);\n${called}`],
    ["it is an enum that is handed on", `enum Color {\n  Red,\n}\nconsole.log(Color);\nconst found = (Color as any)[key];\nconsole.log(found ? found() : "none");`],
    ["it is an enum that is exported", `export enum Color {\n  Red,\n}\nconst found = (Color as any)[key];\nconsole.log(found ? found() : "none");`],
    ["it is an enum that is declared twice", `enum Color {\n  Red,\n}\nenum Color {\n  Green = 1,\n}\nconst found = (Color as any)[key];\nconsole.log(found ? found() : "none");`],
    ["it is an enum with a member that may be an object", `enum Color {\n  Red = process.argv as any,\n}\nconst found = (Color as any)[key];\nconsole.log(found ? found() : "none");`],
    ["it is an enum, and what is found is handed on", `enum Color {\n  Red,\n}\nconsole.log(Color[key as keyof typeof Color]);`],
    ["it is a var that is declared twice", `var table: any = { home: () => "home" };\nvar table: any = process.argv;\n${called}`],
    ["the literal names its prototype", `const table = { __proto__: function () {} };\n${called}`],
    ["the literal spreads another object", `const table = { ...process.env };\n${called}`],
    ["the literal has a key that is computed", `const table = { [process.argv[3]]: 1 };\n${called}`],
    ["the literal has a getter, which is handed the table", `const table = { get home() { return this; } };\n${called}`],
    ["the literal has a setter", `const table = { set home(value: unknown) {} };\n${called}`],
    ["the constant holds something else", `const table: any = process.argv.length > 5 ? {} : function () {};\n${called}`],
    ["the constant holds the literal or something else", `const table: any = process.argv.length > 5 ? { home: 1 } : function () {};\n${called}`],
    ["it is a parameter", `function run(table: Record<string, () => string>) {\n  const found = table[key];\n  return found ? found() : "none";\n}\nconsole.log(run({}));`],
    ["it is on the left of in", `${table}console.log((table as any) in ({} as any));\n${called}`],
  ])("any property may be read where %s", async (_, text) => {
    expect(await judged(text)).toEqual(any);
  });

  const parent = `const parent = Object.getPrototypeOf(() => {});\n`;
  test.each([
    ["is read by a key again", `console.log((table as any)[key][key]);`],
    ["is asked for a descriptor", `console.log((table as any)[key].getOwnPropertyDescriptor(parent, process.argv[3]).value("return 1"));`],
    ["is kept and asked for all descriptors", `const found = (table as any)[key];\nconsole.log(found.values(found.getOwnPropertyDescriptors(parent))[3].value("return 1"));`],
    ["becomes the prototype of a class's prototype", `class Child {\n  x = 1;\n}\nObject.setPrototypeOf(Child.prototype, (table as any)[key]);\nconsole.log((new Child() as any).getOwnPropertyDescriptor(parent, process.argv[3]).value("return 1"));`],
    [
      "is what a class extends, which asks super for a descriptor",
      `class Child extends (table as any)[key] {\n  static find(from: unknown, name: string) {\n    return (super.getOwnPropertyDescriptor as any)(from, name);\n  }\n}\nconsole.log(Child.find(parent, process.argv[3]).value("return 1"));`,
    ],
    [
      "is the prototype of a literal whose method asks super for all descriptors",
      `const child: any = {\n  __proto__: (table as any)[key],\n  find(from: unknown) {\n    return super.values(super.getOwnPropertyDescriptors(from));\n  },\n};\nconsole.log(child.find(parent)[3].value("return 1"));`,
    ],
    ["comes out of a literal that is stored to, whose shape the compiler knows", `let known = { one: 1 };\nknown.one = 2;\nconst other: any = known[key as keyof typeof known];\nconsole.log(other);`],
    ["comes out of an instance of a class of the program's own", `class Point {\n  x = 1;\n}\nconst other: any = new Point()[key as keyof Point];\nconsole.log(other);`],
    ["comes out of a literal that a function makes", `function make() {\n  return { one: 1 };\n}\nconst other: any = make()[key as "one"];\nconsole.log(other);`],
    ["comes out of what an interface describes", `interface Known {\n  one: number;\n}\nconst known: Known = { one: 1 };\nconsole.log(typeof known);\nconst other: any = known[key as keyof Known];\nconsole.log(other);`],
  ])("any property may be read where what is found %s", async (_, text) => {
    expect(await judged(table + parent + text)).toEqual(any);
  });

  test.each([
    ["is asked for its constructor", `console.log((table as any)[key].constructor("return 1"));`],
    ["is kept and read by Reflect.get", `const found = (table as any)[key];\nconsole.log(Reflect.get(found, "keys")(parent));`],
    ["is kept and asked for the descriptor of a member", `const found = (table as any)[key];\nconsole.log((Object.getOwnPropertyDescriptor(found, "keys") as any).value(parent));`],
    ["is returned", `function find(name: string) {\n  return (table as any)[name];\n}\nconsole.log(find(key).getOwnPropertyNames(parent));`],
    ["is handed on", `console.log((table as any)[key]);`],
    ["is stored", `const held = { found: (table as any)[key] };\nconsole.log(typeof held);`],
    ["is kept in a variable that is stored to", `let found = (table as any)[key];\nif (process.argv.length > 5) found = process.argv;\nconsole.log(found ? found() : "none");`],
    ["is kept in a constant that is exported", `export const found = (table as any)[key];\nconsole.log(found ? found() : "none");`],
    ["is kept and handed on", `const found = (table as any)[key];\nconsole.log(found);`],
    ["is kept by an assignment that asks first", `let held: unknown;\nheld ??= (table as any)[key];\nconsole.log(held);`],
    ["stands on the left of instanceof", `class Taker {\n  static [Symbol.hasInstance](value: unknown) {\n    console.log(value);\n    return false;\n  }\n}\nconsole.log((table as any)[key] instanceof Taker);`],
    ["is kept and called through call", `const found = (table as any)[key];\nconsole.log(found.call(table));`.replace("found.call(table)", "found.call(null)")],
    ["is kept and constructed", `const found = (table as any)[key];\nconsole.log(new found());`],
    ["is kept and kept again", `const found = (table as any)[key];\nconst again = found;\nconsole.log(again ? again() : "none");`],
    ["or else another value is handed on", `console.log((table as any)[key] ?? "none");`],
    ["is awaited", `console.log(await (table as any)[key]);\nexport {};`],
  ])("the program reads no other property, and may write any key, where what is found %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared + key + table + parent + text });
    const written = ["program-defined-key *"];
    const readsAnyProperty = use.lines.some(line => line.startsWith("escapes property ") && line.endsWith("main.ts"));
    expect({ readsAnyProperty, written: written.filter(fact => use.facts.has(fact)) }).toEqual({ readsAnyProperty: false, written });
  });
});

describe.concurrent("whether anything but the compiled program may run", () => {
  const build = ["build", "--compile", "--aot", "--outfile", "main"];
  const hello = { "main.ts": declared + `console.log("hello");` };
  const aboutTheWorld = (lines: string[]) => lines.filter(line => line.startsWith("world "));

  test("a closed world has no line that says it is open", async () => {
    const use = await runtimeUse(hello);
    expect({ first: use.lines[0], aboutTheWorld: aboutTheWorld(use.lines) }).toEqual({ first: "closed", aboutTheWorld: [] });
  });

  test("an open world says so in a line of its own", async () => {
    const use = await of(`eval("1");`);
    expect(use.whyOpen).toContain("a call of eval");
    expect(aboutTheWorld(use.lines)).toEqual(["world open"]);
  });

  test("an executable that holds its modules has a closed world", async () => {
    const use = await runtimeUse(hello, build);
    expect({ first: use.lines[0], aboutTheWorld: aboutTheWorld(use.lines), exitCode: use.exitCode }).toEqual({ first: "closed", aboutTheWorld: [], exitCode: 0 });
  });

  test.each([
    ["prints", "main.cjs", `console.log("run");`],
    ["exports an object with nothing to serve", "main.cjs", `module.exports = { value: 1 };`],
  ])("an executable whose entry point is CommonJS and %s has a closed world", async (_, entryPoint, text) => {
    const use = await runtimeUse({ [entryPoint]: text }, build, entryPoint);
    expect({ first: use.lines[0], exitCode: use.exitCode }).toEqual({ first: "closed", exitCode: 0 });
  });

  test.each([
    ["a number", "main.js", `module.exports = 1;`],
    ["a server", "main.cjs", `module.exports = { fetch() { return new Response("ok"); }, port: 0 };`],
  ])("what a CommonJS entry point exports is not followed: the options of the server are not seen where it exports %s", async (_, entryPoint, text) => {
    const use = await runtimeUse({ [entryPoint]: text }, build, entryPoint);
    expect({ world: use.world, whyOpen: use.whyOpen, exitCode: use.exitCode }).toEqual({ world: "open", whyOpen: ["options of Bun.serve that are not seen"], exitCode: 0 });
  });

  test.each([
    ["stores to module.exports", `module.exports = { value: 1 };`],
    ["requires a file", `console.log(require("./other.cjs").value === 1 ? "one" : "other");`],
    ["asks whether there is a module", `if (typeof module !== "undefined" && module.exports) console.log("run");`],
    ["asks whether it is the main module", `if (require.main === module) console.log("run");`],
  ])("a CommonJS entry point that %s reads no property under a name that is not seen", async (_, text) => {
    const use = await runtimeUse({ "main.cjs": text, "other.cjs": `exports.value = 1;` }, build, "main.cjs");
    expect({ first: use.lines[0], readsAnyProperty: use.facts.has("property *"), exitCode: use.exitCode }).toEqual({ first: "closed", readsAnyProperty: false, exitCode: 0 });
  });

  test("a key that the cache of modules is read by is counted where it is read", async () => {
    const use = await runtimeUse({ "main.cjs": `console.log(require("node:module")._cache[process.argv[2]]);` }, build, "main.cjs");
    expect({ readsAnyProperty: use.facts.has("property *"), exitCode: use.exitCode }).toEqual({ readsAnyProperty: true, exitCode: 0 });
  });

  const namedToServe = (lines: string[]) => ["Bun serve", "serve-option *", "serve-route-option *"].filter(line => lines.includes(line));
  const answers = `function () { return new Response("ok"); }`;
  const otherModules = { "other.cjs": `exports.value = 1;\nexports.fetch = ${answers};`, "stores.cjs": `require("./main.cjs").fetch = ${answers};` };

  test.each([
    ["nothing", `console.log("run");`],
    ["a name", `exports.value = 1;`],
    ["a literal", `module.exports = { value: 1, other() { return 2; } };`],
    ["nothing, and requires a module that exports fetch", `console.log(require("./other.cjs").value);`],
    ["nothing, and asks whether it is the main module", `if (require.main === module) console.log("run");`],
    ["nothing, and asks whether it is not the main module", `if (require.main !== module) console.log("required");`],
    ["nothing, and asks for its parent", `if (!module.parent) console.log("run");`],
    ["nothing, and asks whether there is a module", `if (typeof module !== "undefined") console.log("run");`],
    ["nothing, and asks whether modules are replaced while it runs", `if (module.hot) console.log("hot");`],
    ["nothing, and asks whether there is a module that exports", `if (typeof module !== "undefined" && module.exports) console.log("run");`],
    ["nothing, and asks what kind of thing its exports are", `if (typeof exports === "object" && typeof module.exports !== "function") console.log("run");`],
    ["nothing, and compares its exports with this", `console.log(this === module.exports ? "run" : "other");`],
    ["nothing, and tests its exports in a choice that is tested", `if (process.argv.length > 5 ? exports : module.exports) console.log("run");`],
    ["a name, where it finds that it has exports", `if (typeof exports !== "undefined") exports.value = 1;`],
    ["a function, and asks whether there is a module that exports", `if (typeof module !== "undefined" && module.exports) console.log("run");\nmodule.exports = function () {};`],
    ["nothing, and compares module with null", `if (module != null) console.log("run");`],
    ["nothing, and tests module", `console.log(module ? "run" : "none");`],
    ["a name, and asks whether it is the main module", `exports.value = 1;\nif (require.main === module) console.log("run");`],
    ["a function", `module.exports = function () { return 1; };`],
    ["a function that has a name", `module.exports = function app() { return 1; };`],
    ["an arrow function", `module.exports = () => 1;`],
    ["a function, and a name on it", `module.exports = function () {};\nmodule.exports.value = 1;`],
    ["a function, and asks whether it is the main module", `module.exports = function () {};\nif (require.main === module) console.log("run");`],
    ["the name of a function that it calls", `function main() {\n  console.log("run");\n}\nmodule.exports = main;\nif (require.main === module) main();`],
    ["the name of a constant that holds a function", `const main = async () => {\n  console.log("run");\n};\nmodule.exports = main;\nmain();`],
    ["the name of a function, and stores a name on it", `function main() {}\nmain.version = "1";\nmodule.exports = main;\nconsole.log(main.version, typeof main);`],
    ["nothing, and says that it was an ES module", `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nconsole.log("run");`],
    ["a name, and says that it was an ES module", `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.value = void 0;\nexports.value = 1;`],
    ["a function by its name, and says that it was an ES module", `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.main = main;\nfunction main() {\n  console.log("run");\n}\nmain();`],
    [
      "nothing, says that it was an ES module, and imports a default the way TypeScript compiles it",
      `"use strict";\nvar __importDefault = (this && this.__importDefault) || function (mod) {\n  return (mod && mod.__esModule) ? mod : { "default": mod };\n};\nObject.defineProperty(exports, "__esModule", { value: true });\nconst node_path_1 = __importDefault(require("node:path"));\nconsole.log(node_path_1.default.basename("/a/run"));`,
    ],
  ])("Bun.serve is not named for a CommonJS entry point that exports %s", async (_, text) => {
    const use = await runtimeUse({ "main.cjs": text, ...otherModules }, build, "main.cjs");
    expect({ first: use.lines[0], namedToServe: namedToServe(use.lines), exitCode: use.exitCode }).toEqual({ first: "closed", namedToServe: [], exitCode: 0 });
  });

  test.each([
    ["exports fetch", `exports.fetch = ${answers};`],
    ["exports app", `exports.app = {};`],
    ["exports then", `exports.then = function (resolve) { resolve({ default: { fetch: ${answers} } }); };`],
    ["exports a literal with fetch", `module.exports = { fetch: ${answers} };`],
    ["exports a value that is not seen", `function make() { return { fetch: ${answers} }; }\nconst made = make();\nmodule.exports = made;`],
    ["stores under a computed name", `exports[process.argv[2]] = ${answers};`],
    ["exports default", `module.exports.default = { fetch: ${answers} };`],
    ["defines a getter named default", `Object.defineProperty(exports, "default", { enumerable: true, get: function () { return served; } });\nconst served = { fetch: ${answers} };`],
    ["defines default", `Object.defineProperty(module.exports, "default", { value: { fetch: ${answers} } });`],
    ["says that it was an ES module", `Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = { fetch: ${answers} };`],
    ["says that it was an ES module, has no default and exports fetch", `Object.defineProperty(exports, "__esModule", { value: true });\nexports.fetch = ${answers};`],
    ["says that it was an ES module, and its default has nothing to serve", `Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = { value: 1 };`],
    ["stores through this", `this.fetch = ${answers};`],
    ["is required by a module that stores on what it gets", `require("./stores.cjs");`],
    ["hands its exports to Object.assign", `Object.assign(exports, { fetch: ${answers} });`],
    ["hands its exports to a function of its own", `function fill(given) { given.fetch = ${answers}; }\nfill(exports);`],
    ["calls a method of its exports, which stores through this", `exports.fill = function () { this.fetch = ${answers}; };\nexports.fill();`],
    ["holds module in a variable", `const held = module;\nheld.exports.fetch = ${answers};`],
    ["takes module out of a disjunction", `const held = module || null;\nheld.exports.fetch = ${answers};`],
    ["takes module out of a conjunction", `const held = 1 && module;\nheld.exports.fetch = ${answers};`],
    ["takes module out of a choice", `const held = process.argv.length ? module : null;\nheld.exports.fetch = ${answers};`],
    ["takes its exports out of a conjunction", `const held = typeof module !== "undefined" && module.exports;\nheld.fetch = ${answers};`],
    ["takes its exports out of a disjunction", `const held = exports || null;\nheld.fetch = ${answers};`],
    ["takes its exports out of a choice", `const held = process.argv.length ? exports : null;\nheld.fetch = ${answers};`],
    ["hands its exports to a function in a test", `function fill(given) { given.fetch = ${answers}; return true; }\nif (typeof module !== "undefined" && fill(module.exports)) console.log("run");`],
    ["compares its exports loosely with what is not seen", `if (exports == process.argv[2]) console.log("run");`],
    ["stores what a function makes where it finds that there is a module", `function make() { return { fetch: ${answers} }; }\nif (typeof module !== "undefined" && module.exports) module.exports = make();`],
    ["keeps its parent", `const parent = module.parent;\nconsole.log(parent);`],
    ["compares module loosely with what is not seen", `if (module == process.argv[2]) console.log("run");`],
    ["reads the modules that it required", `console.log(module.children.length);`],
    ["exports fetch, and asks whether it is the main module", `exports.fetch = ${answers};\nif (require.main === module) console.log("run");`],
    ["exports a function with fetch on it", `module.exports = function () {};\nmodule.exports.fetch = ${answers};`],
    ["exports a function that it calls, which stores on itself", `module.exports = function self() { self.fetch = ${answers}; };\nmodule.exports();`],
    ["exports a class", `module.exports = class { static fetch() { return new Response("ok"); } };`],
    ["exports the name of a function", `function app() {}\napp.fetch = ${answers};\nmodule.exports = app;`],
    ["exports a function and then something else", `module.exports = function () {};\nmodule.exports = { fetch: ${answers} };`],
    ["exports the name of a function that stores on itself without its name", `function app() {\n  arguments.callee.fetch = ${answers};\n}\napp();\nmodule.exports = app;`],
    ["exports the name of a function that it constructs", `function App() {\n  new.target.fetch = ${answers};\n}\nnew App();\nmodule.exports = App;`],
    ["exports the name of a function that it hands on", `function app() {}\nObject.assign(app, { fetch: ${answers} });\nmodule.exports = app;`],
    ["exports the name of a function, a member of which it calls", `function app() {}\napp.fill = function () {\n  this.fetch = ${answers};\n};\napp.fill();\nmodule.exports = app;`],
    ["exports the name of a function whose prototype it hands on", `function app() {}\nconsole.log(app.prototype);\nmodule.exports = app;`],
    ["exports the name of a function that it stores to under a computed name", `function app() {}\napp[process.argv[2]] = ${answers};\nmodule.exports = app;`],
    ["exports the name of a constant that holds a function with a name of its own", `const app = function self() {\n  self.fetch = ${answers};\n};\napp();\nmodule.exports = app;`],
    ["exports the name of a variable that is stored to", `let app = function () {};\napp = { fetch: ${answers} };\nmodule.exports = app;`],
    ["exports the name of a function that another variable holds too", `function app() {}\nconst held = app;\nheld.fetch = ${answers};\nmodule.exports = app;`],
    ["exports the name of a class", `class App {\n  static fetch() {\n    return new Response("ok");\n  }\n}\nmodule.exports = App;`],
    ["exports a function in a branch", `if (process.argv.length > 5) module.exports = function () {};\nelse module.exports = { fetch: ${answers} };`],
    ["exports a function and hands it on", `module.exports = function () {};\nObject.assign(module.exports, { fetch: ${answers} });`],
    ["gives its exports another prototype", `Object.setPrototypeOf(exports, { fetch: ${answers} });`],
  ])("Bun.serve stays named for a CommonJS entry point that %s", async (_, text) => {
    const use = await runtimeUse({ "main.cjs": text, ...otherModules }, build, "main.cjs");
    expect({ namedToServe: namedToServe(use.lines), exitCode: use.exitCode }).toEqual({ namedToServe: ["Bun serve", "serve-option *", "serve-route-option *"], exitCode: 0 });
  });

  test("an executable that runs in place has an open world, and names what it named", async () => {
    const use = await runtimeUse(hello, [...build, "--compile-in-place"]);
    expect({ first: use.lines[0], aboutTheWorld: aboutTheWorld(use.lines), exitCode: use.exitCode }).toEqual({ first: "open it runs in place", aboutTheWorld: ["world open"], exitCode: 0 });
    expect(use.lines).toContain("global console");
  });
});

describe.concurrent("what the build command knows", () => {
  const build = ["build", "--compile", "--aot", "--outfile", "main"];
  const hello = { "main.ts": declared + `console.log("hello");` };
  const known = async (...flags: string[]) => {
    const use = await runtimeUse(hello, [...build, ...flags]);
    expect(use.exitCode).toBe(0);
    return use.lines.filter(line => /^(autoload|exec-argv|option) /.test(line));
  };

  test("what the environment of any executable can ask for is always there", async () => {
    const use = await runtimeUse(hello, build);
    expect(use.lines.filter(line => line.startsWith("environment "))).toEqual(["environment BUN_DESTRUCT_VM_ON_EXIT", "environment BUN_JSC", "environment BUN_OPTIONS"]);
  });

  test("by default an executable reads bunfig.toml, and neither package.json nor tsconfig.json", async () => {
    expect(await known()).toEqual(["autoload bunfig"]);
  });

  test.each([
    ["--no-compile-autoload-bunfig", []],
    ["--compile-autoload-package-json", ["autoload bunfig", "autoload package-json"]],
    ["--compile-autoload-tsconfig", ["autoload bunfig", "autoload tsconfig"]],
    ["--compile-exec-argv=--smol", ["autoload bunfig", "exec-argv --smol", "option compile-exec-argv"]],
    ["--compile-exec-argv=--title 'a -b' --inspect=127.0.0.1:0 -c own.toml --smol --smol", ["autoload bunfig", "exec-argv --inspect", "exec-argv --smol", "exec-argv --title", "exec-argv -c", "option compile-exec-argv"]],
    ["--compile-exec-argv=-cown.toml", ["autoload bunfig", "exec-argv *", "option compile-exec-argv"]],
    ["--compile-exec-argv=--trace-exitx --smol", ["autoload bunfig", "exec-argv *", "exec-argv --smol", "option compile-exec-argv"]],
    ["--compile-exec-argv=--trace-exit -Z", ["autoload bunfig", "exec-argv *", "exec-argv --trace-exit", "option compile-exec-argv"]],
    ["--disallow-code-generation-from-strings", ["autoload bunfig", "exec-argv --disallow-code-generation-from-strings"]],
    ["--disallow-code-generation-from-strings=strict", ["autoload bunfig", "exec-argv --disallow-code-generation-from-strings"]],
    ["--compile-exec-argv=--disallow-code-generation-from-strings", ["autoload bunfig", "exec-argv --disallow-code-generation-from-strings"]],
    ["--sourcemap", ["autoload bunfig", "option sourcemap"]],
  ])("%s", async (flag, facts) => {
    expect(await known(flag)).toEqual(facts);
  });

  test.each(["--disallow-code-generation-from-strings", "--disallow-code-generation-from-strings=strict", "--compile-exec-argv=--smol --disallow-code-generation-from-strings"])("built with %s, eval opens nothing", async flag => {
    const files = { "main.ts": declared + `console.log([eval].length);` };
    const [without, use] = await Promise.all([runtimeUse(files, build), runtimeUse(files, [...build, flag])]);
    expect({ without: without.world, first: use.lines[0] }).toEqual({ without: "open", first: "closed" });
  });

  test("a package that is not there, in a file of a program with two entry points that may load one of them where it never comes", async () => {
    const files = {
      "main.ts": declared + `function never() { return new Worker("./worker.ts"); }\ntry { console.log(require("late-package")); } catch {}`,
      "worker.ts": declared + `console.log("worker");\nexport {};`,
    };
    expect((await runtimeUse(files, [...build, "worker.ts"])).whyOpen).toEqual(["a module that the executable does not hold, loaded at run time"]);
  });

  test("a package that tries one that is not there opens the world; a package that is there does not", async () => {
    const wrapper = { "node_modules/wrapper/package.json": `{ "name": "wrapper", "main": "index.js" }`, "node_modules/wrapper/index.js": `let found;\ntry { found = require("late-package"); } catch {}\nmodule.exports = found;` };
    const held = { "node_modules/held/package.json": `{ "name": "held", "main": "index.js" }`, "node_modules/held/index.js": `module.exports = { a: 1 };` };
    const [late, there] = await Promise.all([
      runtimeUse({ "main.ts": declared + `// @ts-ignore\nimport found from "wrapper";\nconsole.log(found);`, ...wrapper }, build),
      runtimeUse({ "main.ts": declared + `// @ts-ignore\nimport found from "held";\nconsole.log(found);`, ...held }, build),
    ]);
    expect({ late: late.whyOpen, there: there.whyOpen }).toEqual({ late: ["a module that the executable does not hold, loaded at run time"], there: [] });
  });

  test("a trimmed executable reads bunfig.toml only if it is built to", async () => {
    const trimmed = await runtimeUse(hello, [...build, "--compile-trim-runtime"]);
    if (trimmed.stderr.includes("nothing can be left out of this Bun")) return;
    expect(await known("--compile-trim-runtime")).toEqual([]);
    expect(await known("--compile-trim-runtime", "--compile-autoload-bunfig")).toEqual(["autoload bunfig"]);
  });

  test("bun check, which builds nothing, says nothing about a build", async () => {
    const use = await runtimeUse(hello);
    expect(use.lines.filter(line => /^(autoload|environment|exec-argv|option) /.test(line))).toEqual([]);
  });
});

describe.concurrent("the scripts of a page are checked as a program of their own", () => {
  const files = {
    "main.ts": `// @ts-ignore\nimport page from "./index.html";\nimport { greeting } from "./shared";\n` + declared + `console.log(greeting("the server"), typeof page);`,
    "index.html": `<html><head><script type="module" src="./client.ts"></script></head><body></body></html>`,
    "client.ts": `import { greeting } from "./shared";\ndeclare const document: any;\ndocument.body.textContent = greeting("the browser");`,
    "shared.ts": `export function greeting(who: string): string {\n  return "Hello, " + who;\n}`,
  };

  test.each(["1", "2", "3", "4"])("on %s threads, what the server names is still what the server names", async threads => {
    const use = await runtimeUse(files, undefined, undefined, { GOMAXPROCS: threads });
    expect({ exitCode: use.exitCode, namesConsole: use.facts.has("global console"), namesDocument: use.facts.has("global document") }).toEqual({ exitCode: 0, namesConsole: true, namesDocument: false });
  });
});

describe.concurrent("Bun.serve for the default export of the entry point", () => {
  const build = ["build", "--compile", "--aot", "--outfile", "main"];
  const server = `{ port: 0, fetch() { return new Response("served"); } }`;
  const named = async (files: Record<string, string>, entryPoint?: string) => {
    const use = await runtimeUse(withDeclarations(files), build, entryPoint);
    return { serve: use.facts.has("Bun serve"), world: use.world, exitCode: use.exitCode };
  };

  test.each([
    ["no exports", { "main.ts": `console.log("hello");` }],
    ["no exports, in JavaScript", { "main.js": `console.log("hello");` }],
    ["other exports", { "main.ts": `export const port = 3000;\nexport function fetch() { return new Response("not served"); }` }],
    ["export * from a module that has a default export, which a star does not carry", { "main.ts": `export * from "./other";`, "other.ts": `export default ${server};\nexport const port = 3000;` }],
    ["export * in a circle", { "main.ts": `export * from "./other";`, "other.ts": `export * from "./main";\nexport const port = 3000;` }],
    ["an export named then that is a number", { "main.ts": `export const then = 1;` }],
    ["a CommonJS module that exports nothing", { "main.cjs": `console.log("hello");` }],
  ])("is not named with %s", async (_, files) => {
    expect(await named(files, Object.keys(files)[0])).toEqual({ serve: false, world: "closed", exitCode: 0 });
  });

  test.each([
    ["export default of an object", { "main.ts": `export default ${server};` }],
    ["export default of a variable", { "main.ts": `const config = ${server};\nexport default config;` }],
    ["export default of a class", { "main.ts": `export default class Server {}` }],
    ["export default of a function", { "main.ts": `export default function serve() {}` }],
    ["export default of a promise", { "main.ts": `export default Promise.resolve(${server});` }],
    ["export { config as default }", { "main.ts": `const config = ${server};\nexport { config as default };` }],
    ["export { default } from", { "main.ts": `export { default } from "./other";`, "other.ts": `export default ${server};` }],
    ["export { config as default } from", { "main.ts": `export { config as default } from "./other";`, "other.ts": `export const config = ${server};` }],
    ["export * as default from", { "main.ts": `export * as default from "./other";`, "other.ts": `export const port = 0;\nexport function fetch() { return new Response("served"); }` }],
    ["export default, in JavaScript", { "main.js": `export default ${server};` }],
    ["an export named then that is a function", { "main.ts": `export function then(resolve: (namespace: object) => void) { resolve({ default: ${server} }); }` }],
    ["export * from a module that exports then", { "main.ts": `export * from "./other";`, "other.ts": `export function then(resolve: (namespace: object) => void) { resolve({ default: ${server} }); }` }],
    ["export * from a CommonJS module", { "main.ts": `// @ts-ignore\nexport * from "./other.cjs";`, "other.cjs": `exports.then = function (resolve) { resolve({ default: ${server} }); };` }],
    ["module.exports", { "main.cjs": `module.exports = ${server};` }],
    ["exports.default", { "main.cjs": `exports.default = ${server};` }],
  ])("is named with %s", async (_, files) => {
    expect(await named(files, Object.keys(files)[0])).toMatchObject({ serve: true, exitCode: 0 });
  });

  const optionsIn = async (files: Record<string, string>) => {
    const use = await runtimeUse(withDeclarations(files), build, Object.keys(files)[0]);
    const of = (kind: string) => use.lines.filter(line => line.startsWith(kind + " ")).map(line => line.slice(kind.length + 1));
    return { world: use.world, options: of("serve-option").sort(), routeOptions: of("serve-route-option").sort(), exitCode: use.exitCode };
  };

  test.each([
    ["an object", { "main.ts": `export default ${server};` }, ["fetch", "port"], []],
    ["an object, in JavaScript", { "main.js": `export default ${server};` }, ["fetch", "port"], []],
    ["an object that is asserted to be something else", { "main.ts": `export default ${server} as object;` }, ["fetch", "port"], []],
    ["a variable that goes nowhere else", { "main.ts": `const config = ${server};\nexport default config;` }, ["fetch", "port"], []],
    ["an object with a spread variable", { "main.ts": `const shared = { port: 0 };\nexport default { ...shared, fetch() { return new Response("served"); } };` }, ["fetch", "port"], []],
    ["an object with routes", { "main.ts": `export default { port: 0, routes: { "/files/*": { dir: "." } } };` }, ["port", "routes"], ["dir"]],
    ["a function that is declared and called", { "main.ts": `export default function main() { console.log(1); }\nif (import.meta.main) main();` }, [], []],
    ["a function without a name", { "main.ts": `export default function () { console.log(1); }` }, [], []],
    ["an arrow function", { "main.ts": `export default async () => { console.log(1); };` }, [], []],
    ["the name of a function", { "main.ts": `function main() { console.log(typeof main, main.name); }\nexport default main;\nmain();` }, [], []],
    ["a function on which options are stored by name", { "main.ts": `export default function app() {}\napp.fetch = () => new Response("served");\napp.port = 0;` }, ["fetch", "port"], []],
  ])("its options are listed by name for export default of %s", async (_, files, options, routeOptions) => {
    expect(await optionsIn(files)).toEqual({ world: "closed", options, routeOptions, exitCode: 0 });
  });

  test.each([
    ["an object with a route that has a style", { "main.ts": `export default { port: 0, routes: { "/*": { dir: ".", style: "nextjs-pages" } } };` }, ["port", "routes"], ["dir", "style"]],
    ["an object that asks for the development server", { "main.ts": `export default { port: 0, app: {} };` }, ["app", "port"], []],
  ])("the world is open for export default of %s", async (_, files, options, routeOptions) => {
    expect(await optionsIn(files)).toEqual({ world: "open", options, routeOptions, exitCode: 0 });
  });

  test.each([
    ["a function that is handed on", `export default function app() {}\nObject.assign(app, { fetch() { return new Response("served"); } });`],
    ["a function that is constructed, whose instance leads back to it", `export default function App(this: any) { this.constructor.fetch = () => new Response("served"); }\nnew (App as any)();`],
    ["a function whose prototype is read", `export default function app() {}\nconsole.log(app.prototype);`],
    ["a function a member of which is called, which may answer the function", `export default function app() {}\nconsole.log(app.valueOf());`],
    ["a function on which an option is stored through the rest of a pattern", `export default function app() {}\napp.fetch = () => new Response("served");\n({ ...(app as any).tls } = { key: "k" });`],
    ["a function on which an option is stored through the rest of a list", `export default function app() {}\n[...(app as any).routes] = [];`],
    ["a function that is stored to under a key", `export default function app() {}\n(app as any)[process.argv[2]] = 1;`],
    ["a function that another variable holds too", `export default function app() {}\nconst held: any = app;\nheld.fetch = () => new Response("served");`],
    ["a function that is stored to", `function app() {}\n(app as any) = { fetch() { return new Response("served"); } };\nexport default app;`.replace("(app as any) =", "// @ts-ignore\napp =")],
    ["a class, whose instances lead back to it", `export default class App {}\nconsole.log(new App());`],
  ])("any option may be there for export default of %s", async (_, text) => {
    expect((await optionsIn({ "main.ts": text })).options).toContain("*");
  });

  test.each([
    ["an instance", { "main.ts": `class Server { port = 0; fetch() { return new Response("served"); } }\nexport default new Server();` }],
    ["the result of a call", { "main.ts": `declare const JSON: any;\nexport default JSON.parse(process.argv[2]);` }],
    ["a variable that is stored to", { "main.ts": `const config: any = ${server};\nconfig.app = {};\nexport default config;` }],
    ["a variable that is handed on", { "main.ts": `const config = ${server};\nconsole.log(config);\nexport default config;` }],
    ["an object that another file imports", { "main.ts": `import "./other";\nexport default ${server};`, "other.ts": `import config from "./main";\nsetTimeout(() => ((config as any).app = {}));` }],
    ["an object that its own file imports", { "main.ts": `import config from "./main";\nsetTimeout(() => ((config as any).app = {}));\nexport default ${server};` }],
    ["export { config as default }", { "main.ts": `const config = ${server};\nexport { config as default };` }],
    ["export { default } from", { "main.ts": `export { default } from "./other";`, "other.ts": `export default ${server};` }],
    ["module.exports", { "main.cjs": `module.exports = ${server};` }],
  ])("its options may be any for %s", async (_, files) => {
    const { world, options, routeOptions, exitCode } = await optionsIn(files);
    expect({ world, any: options.includes("*"), anyOfARoute: routeOptions.includes("*"), exitCode }).toEqual({ world: "open", any: true, anyOfARoute: true, exitCode: 0 });
  });
});

describe.concurrent("what is done with the exports of the entry point does not depend on how the program runs", () => {
  async function said(cmd: string[], cwd: string) {
    await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.replace(/^Started (development )?server: http:\/\/localhost:\d+$/gm, "Started a server"), stderr, exitCode };
  }

  const leaves = `setTimeout(() => process.exit(0), 50);`;

  test.each([
    ["no exports", { "main.ts": `console.log("hello");` }, "hello\n"],
    ["a server's configuration", { "main.ts": `export default { port: 0, fetch() { return new Response("served"); } };\n${leaves}` }, "Started a server\n"],
    ["a server's configuration out of another module", { "main.ts": `export { default } from "./other";\n${leaves}`, "other.ts": `export default { port: 0, fetch() { return new Response("served"); } };` }, "Started a server\n"],
    ["a server's configuration behind a star", { "main.ts": `export * from "./other";`, "other.ts": `export default { port: 0, fetch() { return new Response("served"); } };` }, ""],
    ["a server's configuration in a CommonJS module", { "main.cjs": `module.exports = { port: 0, fetch() { return new Response("served"); } };\n${leaves}` }, "Started a server\n"],
    ["a server", { "main.ts": `const server = Bun.serve({ port: 0, fetch() { return new Response("served"); } });\nexport default server;\n${leaves}` }, ""],
    ["a class", { "main.ts": `export default class Server { static fetch = "no function"; }` }, ""],
    ["the global object", { "main.ts": `export default globalThis;` }, ""],
    [
      "an object that says what is read of it",
      { "main.ts": `export default new Proxy({}, { get(_, name) { console.log("read", String(name)); return undefined; } });` },
      "read fetch\nread app\n",
    ],
    [
      "a binding that changes while it is looked at",
      {
        "main.ts": `
          const second = { get port() { console.log("the second is served"); return 0; }, fetch() { return new Response("second"); } };
          let config = { get port() { console.log("the first is served"); return 0; }, get fetch() { config = second; return () => new Response("first"); } };
          export { config as default };
          ${leaves}
        `,
      },
      "the second is served\nStarted a server\n",
    ],
    [
      "a function named then",
      {
        "main.ts": `
          export function then(this: object, resolve: (namespace: object) => void, reject: unknown) {
            console.log("then", Object.prototype.toString.call(this), Object.keys(this).join(), reject === reportError);
            resolve({ default: { port: 0, fetch() { return new Response("served"); } } });
            ${leaves}
          }
          export default { get fetch() { console.log("the default export is not looked at"); return undefined; } };
        `,
      },
      "then [object Module] default,then true\nStarted a server\n",
    ],
  ])("%s", async (_, files, stdout) => {
    using dir = tempDir("aot-runtime-use-entry", { "tsconfig.json": tsconfig, ...withDeclarations(files) });
    const [cwd, entryPoint] = [String(dir), Object.keys(files)[0]];
    const built = await Promise.all([
      said([bunExe(), "build", "--compile", entryPoint, "--outfile", "bundled"], cwd),
      said([bunExe(), "build", "--compile", "--aot", entryPoint, "--outfile", "compiled"], cwd),
    ]);
    expect(built.map(it => ({ stderr: it.stderr, exitCode: it.exitCode }))).toEqual([{ stderr: "", exitCode: 0 }, { stderr: "", exitCode: 0 }]);
    const expected = { stdout, stderr: "", exitCode: 0 };
    expect(await Promise.all([said([bunExe(), entryPoint], cwd), said([join(cwd, "bundled")], cwd), said([join(cwd, "compiled")], cwd)])).toEqual([expected, expected, expected]);
  });
});

using probe = tempDir("aot-runtime-use-probe", { "main.ts": `console.log("hello");` });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "main.ts", "--outfile", "main"],
  cwd: String(probe),
  env: bunEnv,
  stdout: "pipe",
  stderr: "pipe",
});

describe.skipIf(probed.exitCode !== 0)("what the writer of the executable finds", () => {
  const hello = declared + `console.log("hello");`;

  async function built(files: Record<string, string>, entryPoints = ["main.ts"]) {
    using dir = tempDir("aot-runtime-use-writer", { "tsconfig.json": tsconfig, ...files });
    const contents: string[] = [];
    for (const [folder, without] of [
      ["by-use", undefined],
      ["without-a-part-that-is-not-named", "htmlrewriter"],
    ] as const) {
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "--aot", "--compile-trim-runtime", ...entryPoints, "--outfile", join(folder, "main")],
        cwd: String(dir),
        env: { ...bunEnv, BUN_TRIM_RUNTIME_WITHOUT: without },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
      if (buildExitCode !== 0) throw new Error(buildErrors);
      const executable = await Bun.file(join(String(dir), folder, process.platform === "win32" ? "main.exe" : "main")).bytes();
      contents.push(new Bun.CryptoHasher("sha256").update(executable).digest("hex"));
    }
    await using proc = Bun.spawn({ cmd: [join(String(dir), "by-use", "main")], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode, leavesOutWhatIsNotNamed: contents[0] === contents[1] };
  }

  test("every module is compiled: what the program does not name is left out", async () => {
    expect(await built({ "main.ts": hello })).toEqual({ stdout: "hello\n", exitCode: 0, leavesOutWhatIsNotNamed: true });
  });

  test("a module that is not compiled: nothing is left out for not being named", async () => {
    expect(await built({ "main.ts": hello, "data.json": `{ "a": 1 }` }, ["main.ts", "data.json"])).toEqual({ stdout: "hello\n", exitCode: 0, leavesOutWhatIsNotNamed: false });
  });

  test("a package that was not there at the build may be there at run time: nothing is left out for not being named", async () => {
    expect(await built({ "main.ts": hello + `\ntry { require("late-package"); } catch {}` })).toEqual({ stdout: "hello\n", exitCode: 0, leavesOutWhatIsNotNamed: false });
  });

  test("it runs in place: nothing is left out for not being named", async () => {
    expect(await built({ "main.ts": hello }, ["main.ts", "--compile-in-place"])).toEqual({ stdout: "hello\n", exitCode: 0, leavesOutWhatIsNotNamed: false });
  });

  test("an option of --compile-exec-argv: what the program does not name is left out", async () => {
    expect(await built({ "main.ts": hello }, ["main.ts", "--compile-exec-argv=--smol"])).toEqual({ stdout: "hello\n", exitCode: 0, leavesOutWhatIsNotNamed: true });
  });

  test.each(["--stack-trace-limit=3", "--trace-exitx", "--sql-preconnect"])("--compile-exec-argv=%s runs built-in JavaScript from its text: nothing is built", async option => {
    expect(built({ "main.ts": hello }, ["main.ts", "--compile-exec-argv=" + option])).rejects.toThrow(
      option.split("=")[0] + " cannot be used with this executable: the part of Bun that it needs was left out",
    );
  });

  test("the script of a page runs in a browser, not here: what the program does not name is left out", async () => {
    const files = {
      "main.ts": `// @ts-ignore\nimport page from "./index.html";\n` + declared + `console.log(typeof page);`,
      "index.html": `<html><body><script type="module" src="./client.ts"></script></body></html>`,
      "client.ts": `export {};\n(globalThis as any).ready = 1 + 1;`,
    };
    expect(await built(files)).toEqual({ stdout: "object\n", exitCode: 0, leavesOutWhatIsNotNamed: true });
  });
});

describe.concurrent("the report of a build names a native addon that only the bundler sees", () => {
  test.each([
    ["the main file of a package", { "main.ts": `// @ts-ignore\nimport addon from "addon";\n${declared}console.log(addon);`, "node_modules/addon/package.json": `{ "name": "addon", "main": "./addon.node" }`, "node_modules/addon/addon.node": "no addon" }, []],
  ])("%s", async (_, files, flags) => {
    const use = await runtimeUse(files, ["build", "--compile", "--aot", "--outfile", "main", ...flags]);
    expect({ world: use.world, whyOpen: use.whyOpen, exitCode: use.exitCode }).toEqual({ world: "open", whyOpen: ["a native addon"], exitCode: 0 });
  });
});
