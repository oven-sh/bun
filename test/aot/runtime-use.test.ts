import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, allowJs: true, types: [] },
});

async function runtimeUse(files: Record<string, string>, command = ["check", "--aot", "--no-pretty"], entryPoint = "main.ts") {
  using dir = tempDir("aot-runtime-use", { "tsconfig.json": tsconfig, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...command, "--aot-explain=runtime-use", entryPoint],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const prefix = "aot: runtime use: ";
  const lines = stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
  const opened = lines.filter(line => line.startsWith("open "));
  const byTheProgram = opened.filter(line => !/ in \/\$bun\/js\/\S+$/.test(line));
  const whyOpen = byTheProgram.map(line => line.slice("open ".length).replace(/ in \S+$/, ""));
  const world = lines[0] === "closed" || (opened.length > 0 && byTheProgram.length === 0) ? "closed" : "open";
  return { lines, facts: new Set(lines), world, whyOpen, isOpenedByTheRuntime: opened.length > byTheProgram.length, stdout, stderr, exitCode };
}

const declared = `declare const HTMLRewriter: any, Bun: any, process: any, console: any, require: any, module: any, Worker: any, addEventListener: any;\n`;
const of = (text: string) => runtimeUse({ "main.ts": declared + text });
const declaredForServers = `declare const Response: any, Bun: any, process: any, console: any, setTimeout: any, reportError: any;\n`;
const withDeclarations = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([path, text]) => [path, path.endsWith(".ts") ? declaredForServers + text : text]));

describe.concurrent("what a program names of the runtime", () => {
  test("a program that names nothing special has a closed world", async () => {
    const use = await of(`console.log("hello");`);
    expect(use.lines[0]).toBe("closed");
    expect(use.facts.has("global console")).toBe(true);
    expect(use.facts.has("global HTMLRewriter")).toBe(false);
    expect(use.exitCode).toBe(0);
  });

  test.each([
    ["a free identifier", `new HTMLRewriter();`],
    ["typeof", `console.log(typeof HTMLRewriter);`],
    ["a property of globalThis", `new globalThis.HTMLRewriter();`],
    ["a property of globalThis in brackets", `new (globalThis as any)["HTMLRewriter"]();`],
    ["a property of self", `declare const self: any; new self.HTMLRewriter();`],
    ["a property of globalThis.globalThis", `new (globalThis as any).globalThis.HTMLRewriter();`],
    ["a destructured global object", `const { HTMLRewriter: Rewriter } = globalThis as any; new Rewriter();`],
    ["a variable that holds the global object", `const everything: any = globalThis; new everything.HTMLRewriter();`],
    ["the base of a class", `class Mine extends HTMLRewriter {} new Mine();`],
    ["a shorthand property", `console.log({ HTMLRewriter });`],
  ])("a global is named by %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen, named: use.facts.has("global HTMLRewriter") }).toEqual({ world: "closed", whyOpen: [], named: true });
  });

  test.each([
    ["a class of the program's own", `export {}; class HTMLRewriter {} new HTMLRewriter();`],
    ["a parameter", `function f(HTMLRewriter: any) { return new HTMLRewriter(); } f(Map);`],
    ["a type", `let rewriter: typeof HTMLRewriter | undefined; console.log(rewriter);`],
    ["a property of another object", `const mine: any = { HTMLRewriter: Map }; new mine.HTMLRewriter();`],
    ["a string", `console.log("HTMLRewriter");`],
  ])("a global is not named by %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared.replace("HTMLRewriter: any, ", "") + (text.includes("typeof HTMLRewriter |") ? "declare const HTMLRewriter: any;\n" : "") + text });
    expect({ world: use.world, named: use.facts.has("global HTMLRewriter") }).toEqual({ world: "closed", named: false });
  });

  test("properties of Bun and process are listed by name", async () => {
    const use = await runtimeUse({
      "main.ts": `import { file } from "bun";\ndeclare const Bun: any, process: any, console: any;\nconst { write } = Bun;\nconsole.log(Bun.serve, file, write, process.env.HOME, process["argv"]);`,
    });
    expect(use.lines[0]).toBe("closed");
    for (const fact of ["Bun serve", "Bun file", "Bun write", "process env", "process argv"]) expect(use.lines).toContain(fact);
    expect(use.facts.has("Bun build")).toBe(false);
    expect(use.facts.has("process binding")).toBe(false);
  });

  test("console that escapes leaves the world closed and may be read by any name", async () => {
    const use = await of(`const logger = [console]; logger[0].log(1);`);
    expect(use.world).toBe("closed");
    expect(use.lines).toContain("console *");
  });

  test("built-in modules, what they require, and the native code they name", async () => {
    const without = await of(`console.log(1);`);
    const use = await runtimeUse({ "main.ts": `import { Database } from "bun:sqlite";\ndeclare const console: any;\nconsole.log(Database);` });
    expect(use.lines[0]).toBe("closed");
    expect(use.lines).toContain("module bun:sqlite");
    expect(use.lines).toContain("native JSSQLStatement.cpp:createJSSQLStatementConstructor");
    expect(without.facts.has("module bun:sqlite")).toBe(false);
    expect(without.facts.has("native JSSQLStatement.cpp:createJSSQLStatementConstructor")).toBe(false);
  });

  test("names in a built-in module count only when the module is compiled in", async () => {
    const without = await of(`console.log(1);`);
    const use = await runtimeUse({ "main.ts": `import { createServer } from "node:http";\ndeclare const console: any;\nconsole.log(createServer);` });
    expect(use.world).toBe("closed");
    expect(use.lines).toContain("module node:http");
    expect(use.lines).toContain("Bun serve");
    expect(without.facts.has("Bun serve")).toBe(false);
  });

  test.each([
    ["eval", `eval("1");`, "a call of eval"],
    ["eval that is handed on", `console.log([eval].length);`, "eval"],
    ["the Function constructor", `new Function("return 1")();`, "a call of Function"],
    ["the Function constructor that is handed on", `console.log([Function].length);`, "Function"],
    ["Function('return this')()", `console.log(Function("return this")().Object);`, "a call of Function"],
    ["import() of a computed name", `const name: string = process.argv[2]; import(name);`, "import() of a name that is computed"],
    ["import() of a computed path", `const name: string = process.argv[2]; import("./" + name);`, "import() of a path that is computed"],
    ["require that escapes", `console.log([require].length);`, "require"],
    ["a Worker", `new Worker("./other.ts");`, "Worker"],
    ["Bun.plugin", `Bun.plugin({});`, "Bun.plugin"],
    ["Bun that escapes", `console.log(Object.keys(Bun));`, "Bun"],
    ["process that escapes", `console.log(Object.keys(process));`, "process"],
    ["the global object that escapes", `console.log(Object.keys(globalThis));`, "the global object"],
    ["a computed property of the global object", `console.log((globalThis as any)[process.argv[2]]);`, "the global object"],
    ["a computed property of globalThis.self", `console.log((globalThis as any).self[process.argv[2]]);`, "the global object"],
    ["eval in brackets", `(globalThis as any)["eval"]("1");`, "a call of eval"],
    ["a listener on the global object", `addEventListener("error", function (this: any) { console.log(this); });`, "addEventListener of the global object"],
    ["a listener for an event that the program dispatches", `declare const dispatchEvent: any; addEventListener("mine", function (this: any) { console.log(this); }); dispatchEvent(new Event("mine"));`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for a computed event", `addEventListener(process.argv[2], function (this: any) { console.log(this); });`, "addEventListener of the global object"],
    ["a function of its own called on the global object", `(globalThis as any).mine = function (this: any) { return this; }; console.log((globalThis as any).mine());`, "what may be a function that sees the global object, stored on it"],
    ["an accessor on the global object", `Object.defineProperty(globalThis, "mine", { get() { return this; } }); console.log((globalThis as any).mine);`, "an accessor on the global object"],
    ["require.cache", `console.log(require.cache);`, "require.main, require.cache or require.extensions"],
    ["node:vm", `import vm from "node:vm"; console.log(vm);`, "a module that loads modules or evaluates text"],
  ])("the world is open with %s", async (_, text, why) => {
    const use = await of(text);
    expect(use.world).toBe("open");
    expect(use.whyOpen).toContain(why);
  });

  test.each([
    ["typeof globalThis.x", `console.log(typeof (globalThis as any).navigator);`],
    ["a default for a missing global", `console.log((globalThis as any).crypto ?? null);`],
    ["a comparison with undefined", `console.log((globalThis as any).navigator !== undefined);`],
    ["in", `console.log("navigator" in globalThis);`],
    ["typeof globalThis", `console.log(typeof globalThis !== "undefined");`],
    ["require.main === module", `console.log(require.main === module);`],
    ["a value stored on the global object", `(globalThis as any).mine = { count: 1 }; console.log((globalThis as any).mine.count);`],
    ["a value defined on the global object", `Object.defineProperty(globalThis, "mine", { value: 1 }); console.log((globalThis as any).mine);`],
    ["a native function called on the global object", `console.log((globalThis as any).structuredClone(1));`],
    ["a constant name", `const name = "Buffer"; console.log((globalThis as any)[name]);`],
    ["process out of the global object", `const { process: found } = globalThis as any; console.log(found?.versions?.node);`],
    ["a type", `let scope: typeof globalThis | undefined; console.log(scope);`],
    ["the descriptor of a property", `console.log(Object.getOwnPropertyDescriptor(globalThis, "navigator"));`],
    ["a listener for an event that nothing dispatches", `addEventListener("fetch", function (this: any) { console.log(this); });`],
    ["a native function bound to the global object", `declare const self: any; console.log(self.removeEventListener.bind(self));`],
  ])("a feature test leaves the world closed: %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("process as a member of the global object", () => {
  test.each([
    ["behind a type assertion", `console.log((globalThis as any).process.title);`],
    ["in brackets", `console.log((globalThis as any)["process"].title);`],
  ])("names what is read of it, %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
    expect(use.lines).toContain("process title");
  });

  test.each([
    ["behind a type assertion", `console.log(Object.keys((globalThis as any).process));`],
    ["in brackets", `console.log(Object.keys((globalThis as any)["process"]));`],
  ])("opens the world when it escapes, %s", async (_, text) => {
    const use = await of(text);
    expect(use.whyOpen).toContain("process");
  });
});

describe.concurrent("delete makes the engine create every lazy property of the object", () => {
  const wildcards = (lines: string[]) => lines.filter(line => line.endsWith(" *") && line !== "property *" && line !== "symbol *");

  test.each([
    ["the global object", `delete (globalThis as any).fetch;`, "global *"],
    ["the global object, in brackets", `delete (globalThis as any)["fetch"];`, "global *"],
    ["the global object, by a constant name", `const name = "fetch"; const scope: any = globalThis; delete scope[name];`, "global *"],
    ["the global object, in an optional chain", `delete (globalThis as any)?.fetch;`, "global *"],
    ["globalThis.self", `delete (globalThis as any).self.fetch;`, "global *"],
    ["a variable that holds the global object", `const scope: any = globalThis; delete scope.fetch;`, "global *"],
    ["process", `delete process.title;`, "process *"],
    ["globalThis.process", `delete (globalThis as any).process.title;`, "process *"],
    ["globalThis.process, in brackets", `delete (globalThis as any)["process"].title;`, "process *"],
    ["process of a variable that holds the global object", `const scope: any = globalThis; delete scope.process.title;`, "process *"],
    ["a variable that holds process", `const held: any = process; delete held.title;`, "process *"],
    ["Bun", `delete Bun.color;`, "Bun *"],
    ["console", `delete console.table;`, "console *"],
  ])("of a member of %s", async (_, text, wildcard) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
    expect(wildcards(use.lines)).toContain(wildcard);
  });

  test("the built-in modules that the members of process load are compiled in", async () => {
    const modules = (lines: string[]) => lines.filter(line => line.startsWith("module "));
    const [without, named, every] = await Promise.all([of(`console.log(1);`), of(`console.log(process.stdin);`), of(`delete process.title;`)]);
    expect(modules(named.lines).length).toBeGreaterThan(modules(without.lines).length);
    expect(modules(every.lines)).toEqual(expect.arrayContaining(modules(named.lines)));
  });

  test.each([
    ["this in a function that is not strict", `module.exports = function () { delete this.fetch; };`],
    ["a free name in a file that is not strict", `module.exports = function () { delete fetch; };`],
  ])("of a member of the global object that is written as %s", async (_, lib) => {
    const use = await runtimeUse({ "main.ts": `import lib from "./lib.cjs";\ndeclare const console: any;\nconsole.log(lib);`, "lib.cjs": lib });
    expect({ world: use.world, whyOpen: use.whyOpen, wildcards: wildcards(use.lines) }).toEqual({ world: "closed", whyOpen: [], wildcards: ["global *"] });
  });

  test.each([
    ["a member of a member", `delete process.env.HOME;`],
    ["a member of an object of the program's own", `const mine: any = { fetch: 1, title: 2 }; delete mine.fetch; delete mine.title;`],
    ["a variable of the program's own that has the name", `function f(process: any) { delete process.title; } f({});`],
    ["members that are read", `console.log(process.title, (globalThis as any).fetch, Bun.color, void process.title);`],
  ])("not of %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen, wildcards: wildcards(use.lines) }).toEqual({ world: "closed", whyOpen: [], wildcards: [] });
  });
});

describe.concurrent("asking an object for a member makes the engine create the member", () => {
  const wildcards = (lines: string[]) => lines.filter(line => line.endsWith(" *") && line !== "property *" && line !== "symbol *");

  test.each([
    ["in, of the global object", `console.log("HTMLRewriter" in globalThis);`, "global HTMLRewriter"],
    ["in, by a constant name", `const name = "HTMLRewriter"; console.log(name in globalThis);`, "global HTMLRewriter"],
    ["in, of a variable that holds the global object", `const scope: any = globalThis; console.log("HTMLRewriter" in scope);`, "global HTMLRewriter"],
    ["in, of process", `console.log("binding" in process);`, "process binding"],
    ["in, of globalThis.process", `console.log("binding" in (globalThis as any).process);`, "process binding"],
    ["in, of Bun", `console.log("Transpiler" in Bun);`, "Bun Transpiler"],
    ["hasOwnProperty of the global object", `console.log((globalThis as any).hasOwnProperty("HTMLRewriter"));`, "global HTMLRewriter"],
    ["hasOwnProperty of a variable that holds the global object", `const scope: any = globalThis; console.log(scope.hasOwnProperty("HTMLRewriter"));`, "global HTMLRewriter"],
    ["hasOwnProperty of process", `console.log(process.hasOwnProperty("binding"));`, "process binding"],
    ["propertyIsEnumerable of Bun", `console.log(Bun.propertyIsEnumerable("Transpiler"));`, "Bun Transpiler"],
    ["__lookupGetter__ of the global object", `console.log((globalThis as any).__lookupGetter__("HTMLRewriter"));`, "global HTMLRewriter"],
  ])("%s, by a literal name", async (_, text, fact) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen, wildcards: wildcards(use.lines) }).toEqual({ world: "closed", whyOpen: [], wildcards: [] });
    expect(use.lines).toContain(fact);
  });

  test.each([
    ["in, of the global object", `console.log(process.argv[2] in globalThis);`, "global *"],
    ["in, of process", `console.log(process.argv[2] in process);`, "process *"],
    ["in, of Bun", `console.log(process.argv[2] in Bun);`, "Bun *"],
    ["in, of console", `console.log(process.argv[2] in console);`, "console *"],
    ["hasOwnProperty of the global object", `console.log((globalThis as any).hasOwnProperty(process.argv[2]));`, "global *"],
    ["hasOwnProperty of Bun", `console.log(Bun.hasOwnProperty(process.argv[2]));`, "Bun *"],
  ])("%s, by a computed name: any member", async (_, text, wildcard) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
    expect(wildcards(use.lines)).toContain(wildcard);
  });

  test("asking for what makes code or loads it does not open the world", async () => {
    const use = await of(`console.log("Worker" in globalThis, "eval" in globalThis, "Function" in globalThis, "getBuiltinModule" in process, "addEventListener" in globalThis);`);
    expect({ world: use.world, whyOpen: use.whyOpen, wildcards: wildcards(use.lines) }).toEqual({ world: "closed", whyOpen: [], wildcards: [] });
    expect(use.lines).toContain("global Worker");
  });

  test("an object of the program's own may be asked anything", async () => {
    const use = await of(`const mine: any = { a: 1 }; console.log(process.argv[2] in mine, mine.hasOwnProperty(process.argv[2]), mine.valueOf());`);
    expect({ world: use.world, whyOpen: use.whyOpen, wildcards: wildcards(use.lines) }).toEqual({ world: "closed", whyOpen: [], wildcards: [] });
  });
});

describe.concurrent("functions of every object that hand the object on", () => {
  test("what valueOf() returns is followed like the object", async () => {
    const use = await of(`console.log((globalThis as any).valueOf().HTMLRewriter, process.valueOf().title);`);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
    expect(use.lines).toContain("global HTMLRewriter");
    expect(use.lines).toContain("process title");
  });

  test.each([
    ["valueOf() of the global object that is read by a computed name", `console.log((globalThis as any).valueOf()[process.argv[2]]);`, "the global object"],
    ["valueOf() of the global object, in brackets", `console.log((globalThis as any)["valueOf"]()[process.argv[2]]);`, "the global object"],
    ["valueOf() of the global object that escapes", `console.log([(globalThis as any).valueOf()].length);`, "the global object"],
    ["valueOf() of process that escapes", `console.log(Object.keys(process.valueOf()));`, "process"],
    ["valueOf() of Bun that escapes", `console.log(Object.keys(Bun.valueOf()));`, "Bun"],
    ["__defineGetter__ of the global object", `(globalThis as any).__defineGetter__("mine", function (this: any) { return this; });`, "the global object"],
    ["__defineSetter__ of process", `process.__defineSetter__("mine", function (this: any) { console.log(this); });`, "process"],
  ])("the world is open with %s", async (_, text, why) => {
    const use = await of(text);
    expect(use.world).toBe("open");
    expect(use.whyOpen).toContain(why);
  });
});

describe.concurrent("only what is part of the compiled program counts", () => {
  test("a function that nothing mentions does not open the world", async () => {
    const use = await of(`function never() { return eval("1"); }\nconsole.log(1);`);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });

  test("a function that is mentioned does", async () => {
    const use = await of(`function sometimes() { return eval("1"); }\nconsole.log(sometimes);`);
    expect(use.whyOpen).toContain("a call of eval");
  });

  test.each([
    ["a function that nothing mentions", `function never() { return new HTMLRewriter(); }\nconsole.log(1);`],
    ["a function nested in one that nothing mentions", `function never() { return () => new HTMLRewriter(); }\nconsole.log(1);`],
    ["a function that only such a function mentions", `function inner() { return new HTMLRewriter(); }\nfunction never() { return inner(); }\nconsole.log(1);`],
    ["a method of a class that nothing mentions", `class Never { make() { return new HTMLRewriter(); } }\nconsole.log(1);`],
    ["a getter of a class that nothing mentions", `class Never { get made() { return new HTMLRewriter(); } }\nconsole.log(1);`],
    ["a field of a class that nothing mentions", `function never() { class Never { made = new HTMLRewriter(); } return Never; }\nconsole.log(1);`],
    ["a getter of an object in a function that nothing mentions", `function never() { return { get made() { return new HTMLRewriter(); } }; }\nconsole.log(1);`],
    ["the default of a parameter of a function that nothing mentions", `function never(made = new HTMLRewriter()) { return made; }\nconsole.log(1);`],
    ["a property of globalThis there", `function never() { return new (globalThis as any).HTMLRewriter(); }\nconsole.log(1);`],
    ["a variable that holds the global object, read there", `const everything: any = globalThis;\nfunction never() { return new everything.HTMLRewriter(); }\nconsole.log(1);`],
    ["a question there", `function never() { return "HTMLRewriter" in globalThis; }\nconsole.log(1);`],
  ])("a global is not named by %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, named: use.facts.has("global HTMLRewriter"), exitCode: use.exitCode }).toEqual({ world: "closed", named: false, exitCode: 0 });
  });

  test.each([
    ["a function that is called", `function made() { return new HTMLRewriter(); }\nmade();`],
    ["a function that is handed on", `function made() { return new HTMLRewriter(); }\nconsole.log(made);`],
    ["a function nested in one that is called", `function outer() { return () => new HTMLRewriter(); }\nconsole.log(outer());`],
    ["a function that a called one calls", `function inner() { return new HTMLRewriter(); }\nfunction outer() { return inner(); }\nouter();`],
    ["a method of a class that is constructed", `class Maker { make() { return new HTMLRewriter(); } }\nconsole.log(new Maker());`],
    ["a getter of a class that is constructed", `class Maker { get made() { return new HTMLRewriter(); } }\nconsole.log(new Maker());`],
    ["a setter of a class that is constructed", `class Maker { set made(value: unknown) { console.log(new HTMLRewriter(), value); } }\nconsole.log(new Maker());`],
    ["a static method of a class that is handed on", `class Maker { static make() { return new HTMLRewriter(); } }\nconsole.log(Maker);`],
    ["a field of a class that is constructed", `class Maker { made = new HTMLRewriter(); }\nconsole.log(new Maker());`],
    ["a static block", `class Maker { static { console.log(new HTMLRewriter()); } }\nconsole.log(Maker);`],
    ["the computed name of a method that nothing calls", `class Maker { [String(new HTMLRewriter())]() {} }\nconsole.log(Maker);`],
    ["the base of a class", `function base() { return HTMLRewriter; }\nclass Maker extends base() {}\nconsole.log(Maker);`],
    ["a getter of an object", `console.log({ get made() { return new HTMLRewriter(); } });`],
    ["the computed name of a method of an object", `console.log({ [String(new HTMLRewriter())]() {} });`],
    ["the default of a parameter", `function made(value = new HTMLRewriter()) { return value; }\nmade();`],
    ["the default in a pattern", `function made({ value = new HTMLRewriter() } = {} as any) { return value; }\nmade();`],
    ["a generator", `function* made() { yield new HTMLRewriter(); }\nconsole.log([...made()]);`],
    ["an async function", `async function made() { return new HTMLRewriter(); }\nmade();`],
    ["a callback", `[1].forEach(() => new HTMLRewriter());`],
  ])("a global is named by %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, named: use.facts.has("global HTMLRewriter") }).toEqual({ world: "closed", named: true });
  });

  test.each([
    ["Bun", "Bun color", `Bun.color("red", "css")`],
    ["Bun, taken apart", "Bun color", `(() => { const { color } = Bun; return color; })()`],
    ["process", "process umask", `process.umask()`],
    ["console", "console takeHeapSnapshot", `console.takeHeapSnapshot()`],
    ["console, all of it", "console *", `delete console.table`],
  ])("%s: a member counts where it is reached", async (_, fact, expression) => {
    const [never, reached] = await Promise.all([of(`function never() { return ${expression}; }\nconsole.log(1);`), of(`function made() { return ${expression}; }\nmade();`)]);
    expect({ never: never.facts.has(fact), reached: reached.facts.has(fact) }).toEqual({ never: false, reached: true });
  });

  test("a file of which only one function is reached names what that function names", async () => {
    const use = await runtimeUse({
      "main.ts": `import { used } from "./lib";\ndeclare const console: any;\nconsole.log(used());`,
      "lib.ts": declared + `export function used() { return Bun.color("red", "css"); }\nexport function unused() { return new HTMLRewriter(); }`,
    });
    expect({ world: use.world, color: use.facts.has("Bun color"), rewriter: use.facts.has("global HTMLRewriter") }).toEqual({ world: "closed", color: true, rewriter: false });
  });

  test("what native code may ask for at any time counts in every program", async () => {
    const hello = await of(`console.log(1);`);
    expect({ module: hello.facts.has("module internal:process/next_tick_queue"), named: hello.facts.has("process _exiting") }).toEqual({ module: true, named: true });
  });

  test("a built-in module names what its reached functions name", async () => {
    const [hello, zlib] = await Promise.all([of(`console.log(1);`), runtimeUse({ "main.ts": `import { gzipSync } from "node:zlib";\ndeclare const console: any;\nconsole.log(gzipSync("a"));` })]);
    const native = "native node_zlib_binding.rs:NativeZlib";
    expect({ hello: hello.facts.has(native), zlib: zlib.facts.has(native) }).toEqual({ hello: false, zlib: true });
  });
});

describe.concurrent("what a built-in function names counts on behalf of what hands the function out", () => {
  const conditional = ["Bun write", "Bun resolve", "Bun jest", "Bun stdout", "Bun stdin", "Bun indexOfLine", "process dlopen", "process hrtime"];
  const named = (use: Awaited<ReturnType<typeof of>>) => conditional.filter(fact => use.facts.has(fact));

  test("a program that names none of them names nothing of theirs", async () => {
    const use = await of(`console.log(1);`);
    expect({ world: use.world, named: named(use) }).toEqual({ world: "closed", named: [] });
  });

  test.each([
    ["bun:test", `console.log(require("bun:test"));`, ["Bun jest"]],
    ["console.write", `console.write("a");`, ["Bun stdout"]],
    ["console.Console", `console.log(new console.Console(process.stdout));`, ["process hrtime"]],
    ["console that is iterated", `for await (const line of console) console.log(line);`, ["Bun stdout", "Bun stdin", "Bun indexOfLine", "process hrtime"]],
    ["process.stdin", `console.log(process.stdin);`, ["Bun stdin"]],
    ["process.openStdin", `console.log(process.openStdin());`, ["Bun stdin"]],
    ["any member of process", `delete process.title;`, ["Bun stdin"]],
  ])("%s brings what it leads to", async (_, text, expected) => {
    const use = await of(`declare const Response: any;\nexport {};\n` + text);
    expect({ world: use.world, named: named(use).filter(fact => expected.includes(fact)) }).toEqual({ world: "closed", named: expected });
  });

  test("Bun.build brings what it leads to", async () => {
    const use = await of(`console.log(Bun.build({ entrypoints: [] }));`);
    expect(named(use).filter(fact => fact === "Bun write" || fact === "Bun resolve")).toEqual(["Bun write", "Bun resolve"]);
  });

  test("a function that nothing mentions brings nothing", async () => {
    const use = await of(`function never() { return Bun.build({ entrypoints: [] }); }\nconsole.log(1);`);
    expect(named(use)).toEqual([]);
  });

  test("a server without a page brings no plugins of the bundler", async () => {
    const use = await of(`declare const Response: any;\nBun.serve({ fetch: () => new Response("") });`);
    expect({ world: use.world, named: named(use) }).toEqual({ world: "closed", named: [] });
  });
});

describe.concurrent("what native code asks for on behalf of the program is in the program where the program names the need", () => {
  const inspect = "module internal:util/inspect";
  const timers = "module node:timers/promises";

  test("a program that prints a string has neither the inspector nor node:path nor the require function", async () => {
    const use = await of(`console.log("hello");`);
    const absent = [inspect, timers, "module node:path", "Bun main", "Bun Glob", "prints object"];
    expect({ world: use.world, named: absent.filter(fact => use.facts.has(fact)) }).toEqual({ world: "closed", named: [] });
  });

  test.each([
    ["a string", `console.log("a");`],
    ["a template", "console.log(`a ${process.pid} b`);"],
    ["a sum", `console.log("listening on " + process.pid);`],
    ["numbers, comparisons and typeof", `console.log(1 + 2, 3 > 2, typeof process.pid, !process.pid, -1);`],
    ["String(), Number() and JSON.stringify()", `console.log(String(process.pid), Number("1"), JSON.stringify(process.versions));`],
    ["one of two strings", `console.log(process.pid ? "a" : "b", "" || "c");`],
    ["a constant that holds a string", `const text = "a" + process.pid;\nconsole.error(text);`],
  ])("printing %s needs no inspector", async (_, text) => {
    const use = await of(text);
    expect({ prints: use.facts.has("prints object"), inspector: use.facts.has(inspect) }).toEqual({ prints: false, inspector: false });
  });

  test.each([
    ["an object", `console.log({});`],
    ["a variable", `let value: unknown = 1;\nvalue = process;\nconsole.log(value);`],
    ["what a function returns", `console.log(process.cwd());`],
    ["a member", `console.log(process.versions);`],
    ["arguments that are spread", `console.log(...process.argv);`],
    ["a method that is handed on", `[1].forEach(console.log);`],
    ["a method that is taken out", `const { log } = console;\nlog(1);`],
    ["console under another name", `const output = console;\noutput.log(1);`],
    ["Bun.inspect", `process.title = Bun.inspect({});`],
  ])("printing %s needs the inspector", async (_, text) => {
    expect((await of(text)).facts.has(inspect)).toBe(true);
  });

  test("printing an object in a function that nothing mentions needs none", async () => {
    const use = await of(`function never() { console.log({}); }\nconsole.log("a");`);
    expect({ prints: use.facts.has("prints object"), inspector: use.facts.has(inspect) }).toEqual({ prints: false, inspector: false });
  });

  test.each([
    ["a timer that is called", `setTimeout(() => {}, 1);`, false],
    ["the type of a timer", `console.log(typeof setTimeout);`, false],
    ["a symbol of the program's own", `process.title = String(Symbol.for("mine"));`, false],
    ["a timer that is handed on", `const later = setTimeout;\nlater(() => {}, 1);`, true],
    ["a member of a timer", `process.title = String((setImmediate as any).name);`, true],
    ["the symbol by its key", `process.title = String(Symbol.for("nodejs.util.promisify.custom"));`, true],
    ["a symbol by a key that is computed", `process.title = String(Symbol.for(process.title));`, true],
    ["Symbol.for that is handed on", `const make = Symbol.for;\nprocess.title = String(make);`, true],
    ["Symbol that is handed on", `const make = Symbol;\nprocess.title = String(make);`, true],
    ["Object.getOwnPropertySymbols", `process.title = String(Object.getOwnPropertySymbols({}).length);`, true],
    ["Reflect.ownKeys", `process.title = String(Reflect.ownKeys({}).length);`, true],
  ])("%s", async (_, text, named) => {
    const use = await of(`declare const setTimeout: any, setImmediate: any;\n` + text);
    expect({ world: use.world, named: use.facts.has(timers) }).toEqual({ world: "closed", named });
  });

  test.each([
    ["message", `process.on("message", () => {});`, "process on:message", true],
    ["disconnect, once", `process.once("disconnect", () => {});`, "process on:disconnect", true],
    ["disconnect alone", `process.once("disconnect", () => {});`, "process on:message", false],
    ["a signal", `process.on("SIGTERM", () => {});`, "process on:message", false],
    ["a signal, which is no disconnect", `process.on("SIGTERM", () => {});`, "process on:disconnect", false],
    ["an event that is computed", `process.on(process.title, () => {});`, "process on:message", true],
    ["a listener method that is handed on", `const on = process.on;\nprocess.title = String(on);`, "process on:message", true],
    ["a listener method that is taken out", `const { addListener } = process;\nprocess.title = String(addListener);`, "process on:disconnect", true],
    ["message in a function that nothing mentions", `function never() { process.on("message", () => {}); }\nprocess.title = "a";`, "process on:message", false],
  ])("listening on process for %s", async (_, text, fact, named) => {
    expect((await of(text)).facts.has(fact)).toBe(named);
  });

  test.each([
    ["a page", `// @ts-ignore\nimport page from "./index.html";\nprocess.title = String(page);`, true],
    ["an import with attributes", `// @ts-ignore\nimport text from "./index.txt" with { type: "text" };\nprocess.title = String(text);`, true],
    ["another file", `import { a } from "./a";\nprocess.title = a;`, false],
  ])("an import of %s", async (_, text, named) => {
    const use = await runtimeUse({ "main.ts": `declare const process: any;\n` + text, "a.ts": `export const a = "a";`, "index.html": `<html></html>`, "index.txt": `a` });
    expect(use.facts.has("loader html")).toBe(named);
  });

  test("the require function comes with its name", async () => {
    const use = await of(`console.log(String(require.resolve("./main.ts")));`);
    expect(use.facts.has("Bun main")).toBe(true);
  });
});

describe.concurrent("a native module is named where it is loaded", () => {
  test("a built-in module that has a source is none", async () => {
    const use = await of(`console.log(1);`);
    expect(use.lines.filter(line => line.startsWith("native internal"))).toEqual([]);
  });

  test.each([
    ["an import", `import { StringDecoder } from "node:string_decoder";\nconsole.log(StringDecoder);`, true],
    ["an import for its effects", `import "node:string_decoder";\nconsole.log(1);`, true],
    ["require in a function that is called", `function load() { return require("node:string_decoder"); }\nconsole.log(load());`, true],
    ["import() in a function that is called", `function load() { return import("node:string_decoder"); }\nconsole.log(load());`, true],
    ["process.getBuiltinModule in a function that is called", `function load() { return process.getBuiltinModule("node:string_decoder"); }\nconsole.log(load());`, true],
    ["require in a function that nothing mentions", `function never() { return require("node:string_decoder"); }\nconsole.log(1);`, false],
    ["import() in a function that nothing mentions", `function never() { return import("node:string_decoder"); }\nconsole.log(1);`, false],
    ["an import of its types", `import type { StringDecoder } from "node:string_decoder";\nlet stats: StringDecoder | undefined;\nconsole.log(stats);`, false],
  ])("%s", async (_, text, named) => {
    const use = await runtimeUse({ "main.ts": "// @ts-nocheck\n" + text });
    expect({ world: use.world, named: use.facts.has("native node:string_decoder") }).toEqual({ world: "closed", named });
  });
});

describe.concurrent("the module that Bun's own tests look into Bun with", () => {
  test.each([
    ["import", `import { crash_handler } from "bun:internal-for-testing";\ndeclare const console: any;\nconsole.log(crash_handler);`],
    ["require", `declare const console: any, require: any;\nconsole.log(require("bun:internal-for-testing"));`],
  ])("opens the world: %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": "// @ts-nocheck\n" + text });
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: ["bun:internal-for-testing"] });
  });
});

describe.concurrent("the names of properties", () => {
  const given = `declare const given: any;\n`;
  const property = async (text: string) => {
    const use = await runtimeUse({ "main.ts": declared + given + text, "other.ts": `export const localeCompare = 1;` });
    const any = use.lines.some(line => line.startsWith("escapes property ") && line.endsWith("main.ts"));
    return { world: use.world, named: use.facts.has("property localeCompare"), any: any && use.facts.has("property *") };
  };

  test.each([
    ["a member", `console.log(given.localeCompare("a"));`],
    ["a member of an optional chain", `console.log(given?.localeCompare);`],
    ["a string in brackets", `console.log(given["localeCompare"]);`],
    ["a template without holes in brackets", "console.log(given[`localeCompare`]);"],
    ["a constant in brackets", `const key = "localeCompare";\nconsole.log(given[key]);`],
    ["strings that are joined in brackets", `console.log(given["locale" + "Compare"]);`],
    ["a template with a constant in brackets", "const tail = \"Compare\";\nconsole.log(given[`locale${tail}`]);"],
    ["a constant that is joined, in brackets", `const key = "locale" + "Compare";\nconsole.log(given[key]("a"));`],
    ["a member of super", `class Text extends String { compare() { return super.localeCompare("a"); } }\nconsole.log(new Text().compare());`],
    ["a pattern", `const { localeCompare } = given;\nconsole.log(localeCompare);`],
    ["a pattern that renames it", `const { localeCompare: compare } = given;\nconsole.log(compare);`],
    ["a pattern inside a pattern", `const { inner: { localeCompare } } = given;\nconsole.log(localeCompare);`],
    ["the pattern of a parameter", `function compare({ localeCompare }: any) { return localeCompare; }\nconsole.log(compare(given));`],
    ["a pattern that is assigned to", `let compare;\n({ localeCompare: compare } = given);\nconsole.log(compare);`],
    ["in", `console.log("localeCompare" in given);`],
    ["Reflect.get", `console.log(Reflect.get(given, "localeCompare"));`],
    ["Object.getOwnPropertyDescriptor", `console.log(Object.getOwnPropertyDescriptor(given, "localeCompare"));`],
    ["Reflect.getOwnPropertyDescriptor", `console.log(Reflect.getOwnPropertyDescriptor(given, "localeCompare"));`],
    ["an import", `import { localeCompare } from "./other";\nconsole.log(localeCompare);`],
    ["an import that renames it", `import { localeCompare as compare } from "./other";\nconsole.log(compare);`],
  ])("a property is named by %s", async (_, text) => {
    expect(await property(text)).toEqual({ world: "closed", named: true, any: false });
  });

  test.each([
    ["strings that are joined in brackets", `console.log(given["neverWritten" + "AnywhereElse"]);`],
    ["a template with a constant in brackets", "const tail = \"AnywhereElse\";\nconsole.log(given[`neverWritten${tail}`]);"],
    ["a constant that is joined, in brackets", `const key = "neverWritten" + "AnywhereElse";\nconsole.log(given[key]);`],
    ["strings that are joined on the left of in", `console.log("neverWritten" + "AnywhereElse" in given);`],
    ["strings that are joined in a pattern", `const { ["neverWritten" + "AnywhereElse"]: value } = given;\nconsole.log(value);`],
    ["strings that are joined for Reflect.get", `console.log(Reflect.get(given, "neverWritten" + "AnywhereElse"));`],
  ])("a name that stands nowhere in the program as it is read is named by %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared + given + text });
    expect({ exitCode: use.exitCode, named: use.facts.has("property neverWrittenAnywhereElse") }).toEqual({ exitCode: 0, named: true });
  });

  test("what the files of the program read is told from what the runtime's own modules read", async () => {
    const byProgram = (use: Awaited<ReturnType<typeof of>>) => use.lines.filter(line => line.startsWith("program-property ")).sort();
    expect(byProgram(await of(`console.log("hello");`))).toEqual(["program-property log"]);
    const reads = await of(given + `function never() { return given.report; }\nconst { dlopen } = given;\nconsole.log(given.color, given["mark"], given["neverWritten" + "AnywhereElse"], dlopen);`);
    expect(byProgram(reads)).toEqual(["program-property color", "program-property dlopen", "program-property log", "program-property mark", "program-property neverWrittenAnywhereElse"]);
  });

  test("such a name in a function that nothing mentions is not named", async () => {
    const use = await runtimeUse({ "main.ts": declared + given + `function never() { return given["neverWritten" + "AnywhereElse"]; }\nconsole.log(1);` });
    expect({ exitCode: use.exitCode, named: use.facts.has("property neverWrittenAnywhereElse") }).toEqual({ exitCode: 0, named: false });
  });

  test.each([
    ["a string", `console.log("localeCompare");`],
    ["the key of an object literal", `console.log({ localeCompare: 1 });`],
    ["a method that the program defines", `class Text { localeCompare() { return 0; } }\nconsole.log(new Text());`],
    ["a variable", `const localeCompare = 1;\nconsole.log(localeCompare);`],
    ["a type", `type Compare = String["localeCompare"];\nlet compare: Compare | undefined;\nconsole.log(compare);`],
    ["a function that nothing mentions", `function never() { return given.localeCompare("a"); }\nconsole.log(1);`],
    ["a pattern in a function that nothing mentions", `function never({ localeCompare }: any) { return localeCompare; }\nconsole.log(1);`],
  ])("a property is not named by %s", async (_, text) => {
    expect(await property(text)).toEqual({ world: "closed", named: false, any: false });
  });

  test.each([
    ["a parameter in brackets", `function read(key: string) { return given[key]; }\nconsole.log(read(given.name));`],
    ["a call of what a key finds", `function call(key: string) { return given[key](); }\nconsole.log(call(given.name));`],
    ["a variable that is assigned to", `let key = "a";\nkey = given.name;\nconsole.log(given[key]);`],
    ["strings that are joined", `console.log(given["locale" + given.rest]);`],
    ["a computed key in a pattern", `function read(key: string) { const { [key]: value } = given; return value; }\nconsole.log(read(given.name));`],
    ["a computed key in a pattern that is assigned to", `function read(key: string) { let value; ({ [key]: value } = given); return value; }\nconsole.log(read(given.name));`],
    ["Reflect.get of a key", `function read(key: string) { return Reflect.get(given, key); }\nconsole.log(read("a"));`],
    ["Object.getOwnPropertyDescriptor of a key", `function read(key: string) { return Object.getOwnPropertyDescriptor(given, key); }\nconsole.log(read("a"));`],
    ["Object.getOwnPropertyDescriptors", `console.log(Object.getOwnPropertyDescriptors(given));`],
    ["Reflect.get that is handed on", `const get = Reflect.get;\nconsole.log(get);`],
    ["Reflect that is handed on", `console.log(Reflect);`],
    ["Object that is handed on", `console.log(Object);`],
    ["Reflect of the global object", `function read(key: string) { return globalThis.Reflect.get(given, key); }\nconsole.log(read("a"));`],
    ["Object of the global object", `function read(key: string) { return globalThis.Object.getOwnPropertyDescriptor(given, key); }\nconsole.log(read("a"));`],
    ["Reflect of a variable that holds the global object", `const everything: any = globalThis;\nfunction read(key: string) { return everything.Reflect.get(given, key); }\nconsole.log(read("a"));`],
    ["a key of super", `class Text extends String { read(key: string) { return (super[key as any] as any); } }\nconsole.log(new Text().read(given.name));`],
    ["a parameter that only literals reach", `function read(key: string) { return given[key]; }\nconsole.log(read("a"));`],
  ])("any property may be read with %s", async (_, text) => {
    expect(await property(text)).toEqual({ world: "open", named: false, any: true });
  });

  test.each([
    ["__lookupGetter__", `console.log(given.__lookupGetter__("a"));`],
    ["__lookupSetter__", `console.log(given.__lookupSetter__("a"));`],
  ])("any accessor may be taken out with %s", async (_, text) => {
    expect(await property(text)).toEqual({ world: "closed", named: false, any: true });
  });

  test.each([
    ["a number", `console.log(given[0]);`],
    ["a counter", `for (let i = 0; i < given.length; i++) console.log(given[i]);`],
    ["a counter that goes down", `let i = 10;\nwhile (i--) console.log(given[i]);`],
    ["arithmetic", `for (let i = 0; i < given.length; i += 2) console.log(given[i + 1], given[i * 2], given[given.length - 1], given[i >> 1]);`],
    ["a function of Math", `console.log(given[Math.floor(given.length / 2)]);`],
    ["a well-known symbol", `console.log(given[Symbol.iterator]);`],
    ["a symbol of the program's own", `const mine = Symbol("mine");\nconsole.log(given[mine]);`],
    ["a store", `function store(key: string) { given[key] = 1; }\nstore("a");`],
    ["a key of a class of the program's own", `class Point { x = 1; y = 2; }\nfunction read(point: Point, key: keyof Point) { return point[key]; }\nconsole.log(read(new Point(), "x"));`],
    ["a number that is handed in", `function read(at: number) { return given[at]; }\nconsole.log(read(1));`],
    ["a key in a function that nothing mentions", `function never(key: string) { return given[key]; }\nconsole.log(1);`],
  ])("no other property is read with %s", async (_, text) => {
    expect(await property(text)).toEqual({ world: "closed", named: false, any: false });
  });
});

describe.concurrent("what a built-in module lets escape", () => {
  test("any property of process may be read once node:cluster is in the program", async () => {
    const without = await of(`console.log(1);`);
    const use = await runtimeUse({ "main.ts": `import cluster from "node:cluster";\ndeclare const console: any;\nconsole.log(cluster.isPrimary);` });
    expect(use.world).toBe("closed");
    expect(use.lines).toContain("process *");
    expect(use.lines.some(line => line.startsWith("escapes process "))).toBe(true);
    expect(without.lines.filter(line => !line.includes("property ") && line !== "symbol *" && (line.endsWith(" *") || line.startsWith("escapes ")))).toEqual([]);
  });

  test("process does not escape where the manifest vouches for the place: node:events looks at its prototype, a stream hands it to the queue of ticks", async () => {
    const use = await runtimeUse({ "main.ts": `import { Readable } from "node:stream";\nnew Readable().emit("a");` });
    const modules = ["module node:events", "module internal:streams/readable"].filter(line => use.facts.has(line));
    const namedByRootsThatWait = ["native node:module", "Bun write", "Bun resolve"].filter(line => use.facts.has(line));
    expect({ world: use.world, escaping: use.lines.filter(line => line.startsWith("escapes process ")), modules, namedByRootsThatWait }).toEqual({ world: "closed", escaping: [], modules: ["module node:events", "module internal:streams/readable"], namedByRootsThatWait: [] });
  });
});

describe.concurrent("this in a function that is not strict", () => {
  const main = `import lib from "./lib.cjs";\ndeclare const console: any;\nconsole.log(lib);`;
  const why = "this in a function that is not strict";

  test.each([
    ["is returned", `module.exports = function () { return this; };`],
    ["is handed on", `function f(x) { return x; } module.exports = function () { return f.call(this); };`],
    ["is read by a computed name", `module.exports = function (name) { return this[name]; };`],
    ["is read by a computed name in an arrow function", `module.exports = function (name) { return () => this[name]; };`],
    ["is read by a computed name through a variable", `module.exports = function (name) { var self = this; return self[name]; };`],
  ])("opens the world when it %s", async (_, lib) => {
    const use = await runtimeUse({ "main.ts": main, "lib.cjs": lib });
    expect(use.world).toBe("open");
    expect(use.whyOpen).toContain(why);
  });

  test("names what it reads by literal names", async () => {
    const use = await runtimeUse({ "main.ts": main, "lib.cjs": `module.exports = function () { return new this.HTMLRewriter(); };` });
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
    expect(use.lines).toContain("global HTMLRewriter");
  });

  test.each([
    ["the file is strict", `"use strict"; module.exports = function () { return this; };`],
    ["the function is strict", `module.exports = function () { "use strict"; return this; };`],
    ["it is a method of a class", `module.exports = class { me() { return this; } };`],
    ["it is at the top of the file", `module.exports = this;`],
  ])("does not open the world when %s", async (_, lib) => {
    const use = await runtimeUse({ "main.ts": main, "lib.cjs": lib });
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });

  test("does not open the world in an ECMAScript module", async () => {
    const use = await runtimeUse({ "main.ts": `import lib from "./lib.mjs";\ndeclare const console: any;\nconsole.log(lib);`, "lib.mjs": `export default function () { return this; }` });
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("a call of the Function constructor opens the world, whether its error is caught or not", () => {
  test.each([
    ["new Function is in a try block", `let allowed = true; try { new Function(""); } catch { allowed = false; } console.log(allowed);`, "a call of Function"],
    ["Function is in a try block", `let allowed = true; try { Function(""); } catch { allowed = false; } console.log(allowed);`, "a call of Function"],
    ["a constant holds it, in a try block", `let allowed = true; try { const F = Function; new F(""); } catch { allowed = false; } console.log(allowed);`, "a call of Function"],
    ["Function('return this')() is in a try block", `let found: any; try { found = Function("return this")().Map; } catch {} console.log(found);`, "a call of Function"],
    ["there is no handler", `try { new Function(""); } finally { console.log(1); }`, "a call of Function"],
    ["the call is in the handler", `try { console.log(1); } catch { new Function(""); }`, "a call of Function"],
    ["a function lies between", `try { const later = () => new Function(""); console.log(later); } catch {}`, "a call of Function"],
    ["the constant is also stored", `let F: any; try { const G = Function; F = G; new G(""); } catch {} console.log(F);`, "Function"],
    ["the constructor is handed on", `try { console.log(Function); } catch {}`, "Function"],
  ])("opens the world when %s", async (_, text, why) => {
    const use = await of(text);
    expect(use.world).toBe("open");
    expect(use.whyOpen).toEqual([why]);
  });
});

describe.concurrent("the constructor of a function makes code from text", () => {
  const why = "constructor, or a name that is computed, read from what may be a function";
  const given = `declare const given: any;\n`;

  test.each([
    ["of a function, called", `console.log((function () {}).constructor("return 1")());`],
    ["of the constructor of an object", `console.log(({}).constructor.constructor("return 1")());`],
    ["of a method of an array", `console.log([].filter.constructor("return 1")());`],
    ["of a class of the engine", `console.log(Map.constructor("return 1")());`],
    ["of the constructor of a number", `console.log((0).constructor.constructor("return 1")());`],
    ["of a class of the program's own", `class Mine {}\nconsole.log(Mine.constructor("return 1")());`],
    ["by a string in brackets", `console.log((() => {})["constructor"]("return 1")());`],
    ["by strings that are joined", `console.log(((() => {}) as any)["const" + "ructor"]("return 1")());`],
    ["by a key that is handed in", `console.log(((() => {}) as any)[process.argv[2]]("return 1")());`],
    ["by a pattern", `const { constructor } = () => {};\nconsole.log(constructor("return 1")());`],
    ["by Reflect.get", `console.log(Reflect.get(() => {}, "constructor")("return 1")());`],
    ["by Reflect.get in brackets", `console.log(Reflect["get"](() => {}, "constructor")("return 1")());`],
    ["by Reflect.get under a key in a constant", `const how = "get";\nconsole.log(Reflect[how](() => {}, "constructor")("return 1")());`],
    ["by Object.getOwnPropertyDescriptor under a key in a constant", `const how = "getOwnPropertyDescriptor";\nconsole.log(Object[how](Object.getPrototypeOf(() => {}), "constructor")!.value("return 1")());`],
    ["by Reflect.get under a key in a constant, handed on", `const how = "get";\nconst get = Reflect[how];\nconsole.log(get);`],
    ["by Object.getOwnPropertyDescriptor", `console.log(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor")!.value("return 1")());`],
    ["by Object.getOwnPropertyDescriptors", `console.log(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(() => {})));`],
    ["of the prototype of an async function", `console.log(Object.getPrototypeOf(async function () {}).constructor("return 1")());`],
    ["of __proto__", `console.log(((() => {}) as any).__proto__.constructor("return 1")());`],
    ["in a function that reads it of what it is given", `const of = (value: any) => value.constructor;\nconsole.log(of(of)("return 1")());`],
    ["as the base of a class", `const Base: any = (function () {}).constructor;\nclass Made extends Base {}\nconsole.log(Made);`],
    ["as a tag", "console.log((function () {}).constructor`return 1`());"],
    ["of Function.prototype", `console.log(Function.prototype.constructor("return 1")());`],
    ["of a value that is not known, constructed", `console.log(new given.constructor());`],
    ["of a value that is not known, stored", `const made = given.constructor;\nconsole.log(made);`],
    ["of this in a static method", `class Mine { static made() { return this.constructor; } }\nconsole.log(Mine.made());`],
    ["of an array whose prototype is set to a function", `const list: number[] = [1];\nObject.setPrototypeOf(list, function () {});\nconsole.log(new (list.constructor as any)());`],
    ["on the left side of instanceof, where the class has its own Symbol.hasInstance", `let found: any;\nclass Taker { static [Symbol.hasInstance](value: any) { found = value; return false; } }\nconsole.log((function () {}).constructor instanceof Taker, found("return 1")());`],
    ["of super in a static method", `class Base {}\nclass Mine extends Base { static made() { return super.constructor; } }\nconsole.log(Mine.made());`],
  ])("the world opens with the constructor %s", async (_, text) => {
    const use = await of(given + text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: [why] });
  });

  test.each([
    ["that is compared", `console.log(given.constructor === Object, given.constructor != null);`],
    ["that is asked for its name", `console.log(given.constructor.name);`],
    ["that is read by a number", `console.log(given.constructor[0]);`],
    ["on the right side of instanceof", `console.log(given instanceof given.constructor);`],
    ["that is tested", `if (given.constructor) console.log(1);\nconsole.log(typeof given.constructor, !given.constructor);`],
    ["of an instance of a class of the program's own", `class Point { x = 1; copy() { return new (this.constructor as any)(); } }\nconsole.log(new Point().copy());`],
    ["of a string and of a number", `console.log(("a".constructor as any)(1), ((1).constructor as any)("2"));`],
    ["in a function that nothing mentions", `function never() { return given.constructor("return 1"); }\nconsole.log(1);`],
    ["that the program defines", `class Mine { constructor() { console.log(1); } }\nconsole.log(new Mine());`],
    ["asked for with in", `console.log("constructor" in given);`],
  ])("the world stays closed with a constructor %s", async (_, text) => {
    const use = await of(given + text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });

  const key = `const key: string = process.argv[2], other: string = process.argv[3];\n`;

  test.each([
    ["the result of a read from what is not known is called", `console.log(given[key]("return 1"));`],
    ["the result is constructed", `console.log(new given[key]("return 1"));`],
    ["the result is printed", `console.log(given[key]);`],
    ["the result is returned to a caller that calls it", `function read(name: string) { return given[name]; }\nconsole.log(read(key)("return 1"));`],
    ["the result is kept in an object that is printed", `const kept = { found: given[key] };\nconsole.log(kept);`],
    ["the result is kept in an array and called from there", `const kept = [given[key]];\nconsole.log(kept[0]("return 1"));`],
    ["the result is thrown", `try { throw given[key]; } catch (found: any) { console.log(found("return 1")); }`],
    ["the result is stored to", `given[key].push = function (this: any) { return this("return 1"); };\nconsole.log(given[other].push());`],
    ["call is called on the result", `console.log(given[key].call(null, "return 1"));`],
    ["the result is handed to a function of the program that calls it", `function run(value: any) { return value("return 1"); }\nconsole.log(run(given[key]));`],
    ["the result is the callback of an array method", `console.log(["return 1"].map(given[key]));`],
    ["the result is awaited and called", `console.log((await given[key])("return 1"));\nexport {};`],
    ["a function is read by a key that is not known", `function mine() {}\nconsole.log((mine as any)[key]("return 1"));`],
    ["a class is read by a key that is not known", `class Mine {}\nconsole.log((Mine as any)[key]("return 1"));`],
    ["an object is stored to by a key that may be __proto__, and what is stored may be a function", `const held: any = {};\nheld[key] = function () {};\nconsole.log(held[other]("return 1"));`],
    ["an object is given a function for its prototype", `const held: any = {};\nObject.setPrototypeOf(held, function () {});\nconsole.log(held[key]("return 1"));`],
    ["a dictionary is given a function for its prototype", `const held: any = Object.create(null);\nReflect.setPrototypeOf(held, function () {});\nconsole.log(held[key]("return 1"));`],
    ["an object is made with a function for its prototype", `const held: any = Object.create(function () {});\nconsole.log(held[key]("return 1"));`],
    ["an object literal names a function as its prototype", `const held: any = { __proto__: function () {} };\nconsole.log(held[key]("return 1"));`],
    ["setPrototypeOf is taken out and called", `const set = Object.setPrototypeOf;\nconst held: any = Object.create(null);\nset(held, function () {});\nconsole.log(held[key]("return 1"));`],
    ["the setter of __proto__ is taken out and called", `const held: any = Object.create(null);\nObject.getOwnPropertyDescriptor(Object.prototype, "__proto__")!.set!.call(held, function () {});\nconsole.log(held[key]("return 1"));`],
    ["Object.assign stores under __proto__", `const from: any = Object.create(null);\nfrom[key] = function () {};\nconst held: any = Object.assign({}, from);\nconsole.log(held[other]("return 1"));`],
    ["a dictionary goes out of sight, and a function of the program that is out of sight too gives what it is handed a prototype", `const held: any = Object.create(null);\ngiven.each = (it: any) => Object.setPrototypeOf(it, function () {});\ngiven.take(held);\nconsole.log(held[key]("return 1"));`],
    ["the second read is from the result of the first", `const held: any = { one: 1 };\nconsole.log(held[key][other]("return 1"));`],
    ["the constructor of a plain object hands out a descriptor", `const held: any = { one: 1 };\nconsole.log(held[key].getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), other).value("return 1"));`],
    ["the key is enumerated, but something happens before the read", `function mine() {}\n(mine as any).constructor = 1;\nfor (const name in mine) { delete (mine as any)[name]; console.log((mine as any)[name]("return 1")); }`],
    ["the key is enumerated from another object", `function mine() {}\nfor (const name in given) console.log((mine as any)[name]("return 1"));`],
    ["the key is enumerated, and the program names Proxy", `declare const Proxy: any;\nconst lying = new Proxy(function () {}, { ownKeys: () => ["constructor"], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });\nfor (const name in lying) { const found = lying[name]; console.log(found("return 1")); }`],
    ["one of the literals that reach the key says constructor", `function read(name: string) { return given[name]; }\nconsole.log(read("one"), read("constructor")("return 1"));`],
    ["the function that reads goes out of sight", `function read(name: string) { return given[name]; }\nconsole.log(read("one"), given.keep(read));`],
    ["the key is joined from parts that may say constructor", `console.log(given[key + other]("return 1"));`],
    ["Math is given a function as its prototype", `Object.setPrototypeOf(Math, function () {});\nconsole.log((Math as any)[key]("return 1"));`],
    ["JSON is given a function as its prototype by a store", `(JSON as any).__proto__ = function () {};\nconsole.log((JSON as any)[key]("return 1"));`],
    ["a number is made an object with new, and that is given a function as its prototype", `const boxed: any = new Number(1);\nObject.setPrototypeOf(boxed, function () {});\nconsole.log(boxed[key]("return 1"));`],
    ["a string is made an object with new, and that is given a function as its prototype", `const boxed: any = new String("a");\nboxed.__proto__ = function () {};\nconsole.log(boxed[key]("return 1"));`],
    ["a number is made an object by Object.assign", `const boxed: any = Object.assign(1, {});\nObject.setPrototypeOf(boxed, function () {});\nconsole.log(boxed[key]("return 1"));`],
    ["an element of a typed array is a number, and a number has a constructor", `console.log((new Uint8Array(1) as any)[0].constructor.constructor("return 1"));`],
    ["a constructor of the engine is given its own Symbol.hasInstance, which is handed what was found", `Object.defineProperty(Array, Symbol.hasInstance, { value(it: any) { return it("return 1"); } });\nconsole.log(given[key] instanceof Array);`],
    ["Array.of is called on what was found, and constructs it", `console.log(Array.of.call(given[key], "return 1"));`],
    ["Array.from is called on what was found, and constructs it", `console.log((Array.from as any).call(given[key], ["return 1"]));`],
    ["an object is made with new from a bound function, and has a constructor", `function Made(this: any) {}\nconst Bound: any = (Made as any).bind(null);\nconsole.log(new Bound().constructor.constructor("return 1"));`],
    ["Promise.resolve is called on what was found, and constructs it", `console.log(Promise.resolve.call(given[key], 1));`],
    ["a promise is given a constructor whose species is what was found", `const promise: any = Promise.resolve(1);\npromise.constructor = { [Symbol.species]: given[key] };\npromise.then(() => 1);`],
    ["what was found is stored on an object that inherits from what is not known, where a setter may wait", `const heir: any = Object.create(given);\nheir.taken = given[key];`],
    ["a getter is taken out of its descriptor and called on what was found", `const holder: any = { get made() { return (this as any)("return 1"); } };\nconst taken: any = Object.getOwnPropertyDescriptor(holder, "made");\nconsole.log(taken.get.call(given[key]));`],
    ["an array is given a dictionary as its constructor, whose species is what was found", `const species: any = Object.create(null);\nspecies[Symbol.species] = given[key];\nconst list: any = [1];\nlist.constructor = species;\nlist.map((it: any) => it);`],
    ["a string is split by an object of the program's, which answers with a function", `const made: any = "a".split({ [Symbol.split]() { return function () {}; } } as any);\nconsole.log(made[key]("return 1"));`],
    ["an attribute of a descriptor is a boolean, and a boolean has a constructor", `console.log((Object.getOwnPropertyDescriptor({ a: 1 }, "a") as any).writable.constructor.constructor("return 1"));`],
    ["the result is handed to JSON.stringify as the function that it calls for every value", `console.log(JSON.stringify({ a: 1 }, given[key]));`],
    ["it is stored under a boolean and read under the name that the boolean says", `const held: any = {};\nheld[true as any] = given[key];\nconsole.log(held.true("return 1"));`],
    ["Promise.resolve of a promise is that promise, with what was stored on it", `const promise: any = Promise.resolve(1);\npromise.box = [given[key]];\nconsole.log((Promise.resolve(promise) as any).box[0]("return 1"));`],
    ["sorting without a comparator turns the elements into strings", `const one: any = { toString() { return given[key]("return 1"); } };\n[one, one].sort();`],
    ["an argument of slice is turned into an integer", `[1].slice({ valueOf() { return given[key]("return 1"); } } as any);`],
    ["what the callback of finally answers is resolved, and its then is called", `Promise.resolve(1).finally(() => ({ then() { given[key]("return 1"); } }));`],
    ["what a comparator answers is turned into a number", `[1, 2].sort((): any => ({ valueOf() { return given[key]("return 1"); } }));`],
    ["instanceof asks the target of a bound function", `class Target { static [Symbol.hasInstance](it: any) { return it("return 1"); } }\nconsole.log(given[key] instanceof (Target as any).bind(null));`],
    ["instanceof reads prototype of its right side, through a getter", `const right: any = () => 1;\nObject.setPrototypeOf(right, { get prototype() { return given[key]("return 1"); } });\nconsole.log({} instanceof right);`],
    ["reverse moves it to another index", `const list: any[] = [1, given[key]];\nlist.reverse();\nconsole.log(list[0]("return 1"));`],
    ["shift moves it to another index", `const list: any[] = [1, given[key]];\nlist.shift();\nconsole.log(list[0]("return 1"));`],
    ["a getter under undefined answers to the name undefined", `console.log(({ get [void 0 as any]() { return given[key]; } } as any).undefined("return 1"));`],
    ["new.target in the base is the heir, which holds it", `class Base { constructor() { (new.target as any).run("return 1"); } }\nclass Heir extends Base { static run = given[key]; }\nnew Heir();`],
    ["a number is made an object by valueOf", `const boxed: any = Object.prototype.valueOf.call(1);\nObject.setPrototypeOf(boxed, function () {});\nconsole.log(boxed[key]("return 1"));`],
    ["a function is bound again and again at one place, which is too deep to follow", `let bound: any = function (...rest: any[]) { return rest; };\nfor (let round = 0; round < 3; round++) bound = bound.bind(null, round);\nconsole.log(bound(), [given[key]].length);`],
    ["the result is the base of a class that is constructed", `const Base: any = given[key];\nclass Made extends Base { constructor(text: string) { super(text); } }\n(new Made("return 1") as any)();`],
    ["a value goes on where it is falsy, and an empty string has a constructor too", `const name = given.name;\nconst empty = name ? null : name;\nconsole.log(empty.constructor.constructor("return 1"));`],
    ["a value goes on where it is a number, and a number has a constructor too", `const count = given.count;\nconst one = count === 1 ? count : null;\nconsole.log(one.constructor.constructor("return 1"));`],
    ["the prototype of a dictionary that was given one is read through __proto__", `function mine() {}\nconst held: any = Object.create(null);\nObject.setPrototypeOf(held, { inner: mine });\nconsole.log(held.inner[key]("return 1"));`],
    ["a private getter hands it out", `class Holder { get #found() { return given[key]; } run() { return this.#found("return 1"); } }\nconsole.log(new Holder().run());`],
    ["arguments.callee is the function", `console.log((function (this: any) { return (arguments as any).callee[key]("return 1"); })());`],
  ])("the world opens where %s", async (_, text) => {
    const use = await of(given + key + text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: [why] });
  });
});

describe.concurrent("what runs native code that the compiler has not seen opens the world", () => {
  test.each([
    ["process.dlopen", `process.dlopen(module, "./addon.node");`, "process.dlopen"],
    ["process.dlopen that is taken out", `const { dlopen } = process;\nconsole.log(dlopen);`, "process.dlopen"],
    ["process.dlopen that is imported", `import { dlopen } from "node:process";\nconsole.log(dlopen);`, "process.dlopen"],
    ["process.dlopen of a variable that holds the global object", `const everything: any = globalThis;\neverything.process.dlopen(module, "./addon.node");`, "process.dlopen"],
    ["process.binding", `console.log(process.binding("fs"));`, "process.binding"],
    ["process._linkedBinding", `console.log(process._linkedBinding("fs"));`, "process.binding"],
    ["an import of bun:ffi", `import { dlopen } from "bun:ffi";\nconsole.log(dlopen);`, "bun:ffi"],
    ["a require of bun:ffi", `console.log(require("bun:ffi"));`, "bun:ffi"],
    ["import() of bun:ffi", `console.log(await import("bun:ffi"));\nexport {};`, "bun:ffi"],
    ["Bun.FFI", `console.log(Bun.FFI);`, "bun:ffi"],
    ["bun:jsc, which hands out objects of the heap", `import { getProtectedObjects } from "bun:jsc";\nconsole.log(getProtectedObjects);`, "bun:jsc"],
    ["import() of bun:main", `try { await import("bun:main"); } catch {}\nexport {};`, "bun:main"],
    ["import() of a URL", `try { await import("http://127.0.0.1:1/x.js"); } catch {}\nexport {};`, "an import of a URL"],
    ["node:inspector", `import { Session } from "node:inspector";\nconsole.log(Session);`, "a module that loads modules or evaluates text"],
  ])("%s", async (_, text, why) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen.filter(it => it === why) }).toEqual({ world: "open", whyOpen: [why] });
  });

  test.each([
    ["the type of process.dlopen", `console.log(typeof process.dlopen);`],
    ["process.dlopen in a function that nothing mentions", `function never() { process.dlopen(module, "./addon.node"); }\nconsole.log(1);`],
  ])("not %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("the arguments of the function round a CommonJS file", () => {
  test("open the world: require and module are among them", async () => {
    const use = await runtimeUse({ "main.cjs": `console.log(arguments[1](process.argv[2]));` }, undefined, "main.cjs");
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: ["require"] });
  });

  test("the arguments of a function in the file do not", async () => {
    const use = await runtimeUse({ "main.cjs": `function count() { return arguments.length; }\nconsole.log(String(count(1)));` }, undefined, "main.cjs");
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("process is the receiver of its listeners and what its methods return", () => {
  test.each([
    ["an arrow function", `process.on("exit", () => console.log(1));`],
    ["a function that does not say this", `process.on("exit", function () { console.log(1); });`],
    ["a function in which only another function says this", `process.on("exit", function () { console.log(function (this: any) { return this; }); });`],
    ["a declared function that does not say this", `function stop() { console.log(1); }\nprocess.once("SIGINT", stop);`],
    ["a constant that holds an arrow function", `const stop = () => console.log(1);\nprocess.addListener("SIGINT", stop);`],
    ["a listener that is taken off", `const stop = () => console.log(1);\nprocess.off("SIGINT", stop);`],
    ["the type of process.on", `console.log(typeof process.on);`],
    ["on() behind a comma, in a statement", `console.log(1), process.on("exit", () => {});`],
    ["on() in front of a comma", `console.log((process.on("exit", () => {}), 1));`],
    ["on() behind a condition, in a statement", `process.title && process.on("exit", () => {});`],
    ["on() in both arms of a condition, in a statement", `process.title ? process.on("exit", () => {}) : process.once("exit", () => {});`],
    ["on() under void", `console.log(void process.on("exit", () => {}));`],
  ])("the world stays closed with %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });

  test.each([
    ["a function that says this", `process.on("exit", function (this: any) { console.log(this.title); });`],
    ["an arrow function in a function that says this", `process.on("exit", function (this: any) { console.log(() => this); });`],
    ["a declared function that says this", `function stop(this: any) { console.log(this); }\nprocess.on("SIGINT", stop);`],
    ["a listener that is a parameter", `function listen(listener: any) { process.on("exit", listener); }\nlisten(console.log);`],
    ["a listener that is a member", `const mine = { stop() {} };\nprocess.on("exit", mine.stop);`],
    ["a variable that is stored to again", `let stop = () => {};\nstop = console.log;\nprocess.on("exit", stop);`],
    ["arguments that are spread", `const given: any[] = ["exit", console.log];\nprocess.on(...given);`],
    ["calls in a chain", `process.on("exit", () => {}).on("SIGINT", () => {});`],
    ["what on() returns", `const same = process.on("exit", () => {});\nconsole.log(same);`],
    ["what setMaxListeners() returns", `console.log(process.setMaxListeners(20));`],
    ["what on() returns behind a comma", `console.log((1, process.on("exit", () => {})));`],
    ["what on() returns behind a condition", `console.log(process.title && process.on("exit", () => {}));`],
    ["what on() returns in an arm of a condition", `const same = process.title ? process.on("exit", () => {}) : 1;\nconsole.log(same);`],
    ["what on() returns from an arrow function", `const listen = () => process.on("exit", () => {});\nconsole.log(listen());`],
    ["on() that is handed on", `const on = process.on;\nconsole.log(on);`],
    ["on() that is taken out", `const { on } = process;\nconsole.log(on);`],
    ["on() that is imported", `import { on } from "node:process";\nconsole.log(on);`],
    ["on() of a variable that holds process", `const same = process;\nsame.on("exit", () => {});`],
    ["a function of the program's own that is called on it", `process.mine = function (this: any) { return this; };\nconsole.log(process.mine());`],
    ["a function of the program's own that is a tag on it", "process.mine = function (this: any) { return this; };\nconsole.log(process.mine`a`);"],
    ["a function of the program's own that is defined on it and called", `Object.defineProperty(process, "mine", { value(this: any) { return this; } });\nconsole.log(process.mine());`],
    ["an accessor on it", `Object.defineProperty(process, "me", { get() { return this; } });\nconsole.log(process.me);`],
    ["a property that is defined on a variable that holds it", `const same = process;\nObject.defineProperty(same, "me", { value: 1 });`],
  ])("the world opens with %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: ["process"] });
  });
});

describe.concurrent("Bun is the receiver of what the program puts on it", () => {
  test.each([
    ["a function of the program's own that is called on it", `Bun.mine = function (this: any) { return this; };\nconsole.log(Bun.mine());`],
    ["an accessor on it", `Object.defineProperty(Bun, "me", { get() { return this; } });\nconsole.log(Bun.me);`],
  ])("the world opens with %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: ["Bun"] });
  });

  test.each([
    ["a member that is stored and read", `process.exitCode = 1;\nconsole.log(process.exitCode);`],
    ["a member that is stored, and another that is called", `process.title = "a";\nprocess.exit(0);`],
    ["a value that is defined on it", `Object.defineProperty(process, "mine", { value: 1 });\nconsole.log(process.mine);`],
  ])("the world stays closed with %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("operators and calls that hand a global to code of the program's own", () => {
  const has = `class Has { static [Symbol.hasInstance](value: unknown) { return value !== undefined; } }\n`;
  test.each([
    ["the global object on the left of instanceof", has + `console.log(globalThis instanceof Has);`, "the global object"],
    ["a variable that holds the global object on the left of instanceof", `const scope: any = globalThis;\nconsole.log(scope instanceof Object);`, "the global object"],
    ["process on the left of instanceof", has + `console.log(process instanceof Has);`, "process"],
    ["Bun on the left of instanceof", has + `console.log(Bun instanceof Has);`, "Bun"],
    ["process compared loosely with a number", `console.log(process == 1);`, "process"],
    ["Bun compared loosely with a string", `console.log(Bun != "a");`, "Bun"],
    ["the global object compared loosely", `console.log((globalThis as any) == 1);`, "the global object"],
    ["a store on the global object under a name that is joined", `(globalThis as any)["mi" + process.argv[2]] = function (this: any) { return this; };`, "the global object"],
    ["a store on process under a computed name", `process[process.argv[2]] = 1;`, "process"],
    ["a call of what a symbol finds on the global object", `const mine = Symbol("mine");\n(globalThis as any)[mine] = function (this: any) { return this; };\nconsole.log((globalThis as any)[mine]());`, "the global object"],
    ["a function declaration that is stored to", `function read(given: any) { return typeof given; }\n// @ts-ignore\nread = (given: any) => given;\nconsole.log(read(globalThis));`, "the global object"],
    ["a free name that is stored to and called on the global object", `// @ts-ignore\nmine = function (this: any) { return this; };\nconsole.log((globalThis as any).mine());`, "what may be a function that sees the global object, stored on it"],
    ["dispatchEvent taken off EventTarget.prototype", `declare const EventTarget: any;\nconst { dispatchEvent } = EventTarget.prototype;\nconsole.log(dispatchEvent);`, "addEventListener of the global object"],
    ["addEventListener taken off an object", `declare const EventTarget: any;\nconst listen = new EventTarget().addEventListener;\nconsole.log(listen);`, "addEventListener of the global object"],
    ["addEventListener called without a receiver", `declare const EventTarget: any;\nEventTarget.prototype.addEventListener.call(undefined, "a", () => {});`, "addEventListener of the global object"],
  ])("the world opens with %s", async (_, text, why) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: [why] });
  });

  test.each([
    ["process compared with null", `console.log(process == null, process != undefined, process === 1);`],
    ["a symbol's member of the global object that is stored and read", `const mine = Symbol("mine");\n(globalThis as any)[mine] = 1;\nconsole.log(String((globalThis as any)[mine]));`],
    ["addEventListener called on an object", `declare const EventTarget: any;\nnew EventTarget().addEventListener("a", () => {});`],
    ["removeEventListener taken off an object", `declare const EventTarget: any;\nconst { removeEventListener } = EventTarget.prototype;\nconsole.log(removeEventListener, new EventTarget().removeEventListener);`],
    ["the type of a member named addEventListener", `declare const given: any;\nconsole.log(typeof given.addEventListener);`],
  ])("the world stays closed with %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });

  test("a function of the program's own that is called on console may read any member of it", async () => {
    const use = await of(`console.mine = function (this: any) { return this; };\nconsole.log(String(console.mine()));`);
    expect({ world: use.world, any: use.facts.has("console *") }).toEqual({ world: "closed", any: true });
  });
});

describe.concurrent("what is stored on a global may be called by anybody, with the global as its receiver", () => {
  const onTheGlobalObject = "what may be a function that sees the global object, stored on it";
  test.each([
    ["toString of the global object, which toLocaleString calls", `(globalThis as any).toString = function (this: any) { console.log(this); return "a"; };\nglobalThis.toLocaleString();`, onTheGlobalObject],
    ["toString of process", `process.toString = function (this: any) { console.log(this); return "a"; };\nprocess.toLocaleString();`, "process"],
    ["emit of process, which native code calls", `process.emit = function (this: any) { console.log(this); return true; };`, "process"],
    ["a function that is stored under the name of a native one", `declare let fetch: any;\n(globalThis as any).fetch = function (this: any) { console.log(this); };\nfetch.call(globalThis, "data:,");`, onTheGlobalObject],
    ["a free name of a native function that is stored to", `declare let setTimeout: any;\nsetTimeout = function (this: any) { console.log(this); };\nsetTimeout.bind(globalThis)();`, onTheGlobalObject],
    ["a handler of the global object, whose events have it as their target", `declare const self: any;\nself.onmessage = (event: any) => console.log(event.target);`, onTheGlobalObject],
    ["a handler under its free name", `declare let onmessage: any;\nonmessage = (event: any) => console.log(event.target);`, onTheGlobalObject],
    ["a handler for errors in a variable that holds the global object", `const scope: any = globalThis;\nscope.onerror = function (event: any) { console.log(event.target); };`, onTheGlobalObject],
    ["a function in a variable", `const mine = function (this: any) { return this; };\nBun.mine = mine;\nconsole.log(Bun.mine());`, "Bun"],
    ["a function that is declared", `function mine(this: any) { return this; }\nBun.mine = mine;\nconsole.log(Bun.mine());`, "Bun"],
    ["an arrow function in a function that sees its receiver", `Bun.mine = function (this: any) { return () => this; };\nconsole.log(Bun.mine());`, "Bun"],
    ["one of two", `Bun.mine = process.argv[2] ? () => 1 : function (this: any) { return this; };\nconsole.log(Bun.mine());`, "Bun"],
    ["a value that is not seen", `Bun.mine = JSON.parse(process.argv[2]);\nconsole.log(Bun.mine());`, "Bun"],
    ["a parameter", `function keep(given: any) { process.mine = given; }\nkeep(1);\nconsole.log(process.mine());`, "process"],
    ["a method in a descriptor", `Object.defineProperty(process, "mine", { value(this: any) { return this; } });\nconsole.log(process.mine());`, "process"],
    ["a value that is not seen, under a name that native code calls", `process.reallyExit = JSON.parse(process.argv[2]);`, "process"],
    ["a value that is not seen, under the name that a promise asks for", `Bun.then = JSON.parse(process.argv[2]);`, "Bun"],
    ["a function that a variable which holds the global object is asked to call", `const scope: any = globalThis;\nscope.mine = function (this: any) { return this; };\nconsole.log(scope.mine());`, onTheGlobalObject],
    ["a function that is called as the tag of a template", "Bun.mine = function (this: any) { return this; };\nconsole.log(Bun.mine`a`);", "Bun"],
    ["a function that is called as a decorator", `Bun.mine = function (this: any) { console.log(this); };\n@Bun.mine class Marked {}\nconsole.log(Marked);`, "Bun"],
    ["a getter in a descriptor", `Object.defineProperty(process, "mine", { get value() { return 1; } });`, "process"],
  ])("the world opens with %s", async (_, text, why) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen.filter(it => it === why) }).toEqual({ world: "open", whyOpen: [why] });
  });

  test.each([
    ["a string", `process.title = "a";`],
    ["a sum", `process.title = "a" + process.pid;`],
    ["what String() gives", `Bun.mine = String(JSON.parse(process.argv[2]));`],
    ["anything, to the exit code or the title of process, whose setters keep no function", `process.exitCode = JSON.parse(process.argv[2]);\nprocess.title = JSON.parse(process.argv[3]);`],
    ["an arrow function", `(globalThis as any).mine = () => 1;\nconsole.log((globalThis as any).mine());`],
    ["a function that does not mention its receiver", `process.mine = function () { return 1; };\nconsole.log(process.mine());`],
    ["such a function in a constant", `const mine = function () { return 1; };\nBun.mine = mine;\nconsole.log(Bun.mine());`],
    ["such a function that is declared", `function mine() { return 1; }\nBun.mine = mine;`],
    ["a function whose inner function has a receiver of its own", `Bun.mine = function () { return function (this: any) { return this; }; };`],
    ["a class", `(globalThis as any).Mine = class { me() { return this; } };`],
    ["an object", `(globalThis as any).mine = { me() { return this; } };`],
    ["an array", `(globalThis as any).mine = [1];`],
    ["a handler that is taken away", `declare const self: any;\nself.onmessage = null;`],
    ["a function that sees its receiver and that nobody calls on the holder", `Bun.mine = function (this: any) { return this; };\nconst { mine } = Bun;\nconsole.log(mine());`],
    ["an exit code from a call", `function status() { return process.argv.length; }\nprocess.exitCode = status();`],
    ["an exit code from a parameter", `function finish(code: any) { process.exitCode = code; }\nfinish(0);`],
    ["an exit code from a member", `const result = JSON.parse(process.argv[2]);\nprocess.exitCode = result.status;`],
    ["a title from a variable", `const name = process.argv[1];\nprocess.title = name;`],
    ["a cache on the global object", `(globalThis as any).cache ??= new Map();\nconsole.log((globalThis as any).cache.size);`],
    ["what a call gives, on the global object", `(globalThis as any).startedAt = Date.now();`],
    ["an export of a built-in module under the name of a global", `import { Buffer as FromNode } from "node:buffer";\n(globalThis as any).Buffer ??= FromNode;`],
    ["a global under the name of another", `declare const setTimeout: any;\n(globalThis as any).setImmediate = setTimeout;`],
    ["a handler of another object", `declare const given: any;\ngiven.onmessage = (event: any) => console.log(event.target);`],
  ])("the world stays closed with %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });

  test("a call in another file counts", async () => {
    const use = await runtimeUse({ "main.ts": declared + `import "./other";\nBun.mine = function (this: any) { return this; };`, "other.ts": declared + `export function later() { return Bun.mine(); }\nconsole.log(later);` });
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: ["Bun"] });
  });

  test.each([
    ["what a registered symbol finds on the global object", "(globalThis as any)[Symbol.for(\"k\")] = () => 1;\nconsole.log((globalThis as any)[Symbol.for(\"k\")]`a`);", "the global object"],
    ["what a symbol in a constant finds on process", "const key = Symbol(\"me\");\nprocess[key] = () => 1;\nconsole.log(process[key]`a`);", "process"],
    ["valueOf of the global object", "console.log((globalThis as any).valueOf`a`);", "the global object"],
  ])("a tagged template is a call of %s", async (_, text, why) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: [why] });
  });
});

describe.concurrent("the runtime's own modules read members for the program: they are judged like the program", () => {
  const why = "constructor, or a name that is computed, read from what may be a function";

  test.each([
    ["the listeners of what is no emitter", `import { EventEmitter } from "node:events";\nconsole.log(String(EventEmitter.prototype.listeners.call({ _events: function () {} }, "constructor")));`],
    ["an emitter whose table of events is a function", `import { EventEmitter } from "node:events";\nconst emitter: any = new EventEmitter();\nemitter._events = function () {};\nconsole.log(String(emitter.listeners(process.argv[2])));`],
    ["the styles of util.inspect, read by a custom inspector", `const custom = Symbol.for("nodejs.util.inspect.custom");\nconsole.log({ [custom](depth: number, options: any) { return options.stylize("a", process.argv[2]); } });`],
  ])("the world opens with %s", async (_, text) => {
    const use = await of(text);
    expect({ first: use.lines[0].startsWith("open " + why + " in /$bun/js/"), isOpenedByTheRuntime: use.isOpenedByTheRuntime }).toEqual({ first: true, isOpenedByTheRuntime: true });
  });

  test.each([
    ["a string that is printed", `console.log("a");`],
    ["an object that is printed", `console.log({ a: [1, "b", new Map()] });`],
    ["an error that is printed", `console.error(new Error("a"));`],
    ["a custom inspector that reads no style", `const custom = Symbol.for("nodejs.util.inspect.custom");\nconsole.log({ [custom]() { return "a"; } });`],
  ])("the world stays closed with %s", async (_, text) => {
    expect((await of(text)).lines[0]).toBe("closed");
  });
});

describe.concurrent("a member that makes or loads code is one whatever it is read from", () => {
  const why = "a member that makes or loads code, read from what may be the global object, process or Bun";
  const given = `const given: any = JSON.parse(process.argv[2]);\n`;

  test.each([
    ["eval", `console.log(given.eval("1"));`],
    ["Function", `console.log(new given.Function("return 1"));`],
    ["require", `console.log(given.require("node:fs"));`],
    ["dlopen", `given.dlopen(module, "./addon.node");`],
    ["binding that is taken out", `const { binding } = given;\nconsole.log(binding);`],
    ["plugin", `given.plugin({});`],
    ["Worker", `console.log(new given.Worker("./a.js"));`],
  ])("the world opens with %s of a value that is not known", async (_, text) => {
    const use = await of(given + text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: [why] });
  });

  test.each([
    ["of an instance of a class of the program's own", `class Mine { require(name: string) { return name; } }\nconsole.log(new Mine().require("a"));`],
    ["that is only asked for its type", `console.log(typeof given.require, given.eval === undefined);`],
    ["in a function that nothing mentions", `function never() { return given.eval("1"); }\nconsole.log(1);`],
  ])("the world stays closed with such a name %s", async (_, text) => {
    const use = await of(given + text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("a variable that is stored to through an assertion is no constant", () => {
  test.each([
    ["a key of process", `let key = "pid";\n(key as any) = process.argv[2];\nconsole.log(process[key]);`, "process"],
    ["a key of the global object", `let key = "Map";\n(key as string) = process.argv[2];\nconsole.log((globalThis as any)[key]);`, "the global object"],
    ["a key that a pattern stores to", `let key = "pid";\n[key as any] = process.argv;\nconsole.log(process[key]);`, "process"],
    ["a function declaration that the global object is handed to", `function read(given: any) { return typeof given; }\n(read as any) = (given: any) => given;\nconsole.log(read(globalThis));`, "the global object"],
    ["a variable with a function that Bun is handed to", `let read = (given: any) => typeof given;\n(read as any) = (given: any) => given;\nconsole.log(read(Bun));`, "Bun"],
    ["a listener of process", `let listener = () => {};\n(listener as any) = function (this: any) { console.log(this); };\nprocess.on("exit", listener);`, "process"],
    ["a parameter that is required", `function load(name: string) {\n  (name as any) = process.argv[2];\n  return require(name);\n}\nconsole.log(load("node:path"));`, "require"],
  ])("%s", async (_, text, why) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen.filter(it => it === why) }).toEqual({ world: "open", whyOpen: [why] });
  });

  test("the key of any other object", async () => {
    const use = await of(`declare const given: any;\nlet key = "localeCompare";\n(key as any) = process.argv[2];\nconsole.log(given[key]);`);
    expect({ named: use.facts.has("property localeCompare"), any: use.lines.some(line => line.startsWith("escapes property ") && line.endsWith("main.ts")) }).toEqual({ named: false, any: true });
  });

  test.each([
    ["a variable that is never stored to", `let key = "pid";\nconsole.log(process[key]);`],
    ["a constant", `const key = "pid";\nconsole.log(process[key]);`],
    ["a variable that is only read through an assertion", `let key = "pid";\nconsole.log(key as any, process[key]);`],
  ])("%s is one", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen, named: use.facts.has("process pid") }).toEqual({ world: "closed", whyOpen: [], named: true });
  });
});

describe.concurrent("an accessor on its prototype would be handed the object", () => {
  test.each([
    ["Object.getPrototypeOf(process)", `console.log(Object.getPrototypeOf(process));`, "process"],
    ["process.__proto__", `console.log(process.__proto__);`, "process"],
    ["process.constructor", `console.log(process.constructor.prototype);`, "process"],
    ["Object.getPrototypeOf(Bun)", `console.log(Object.getPrototypeOf(Bun));`, "Bun"],
    ["Object.getPrototypeOf(globalThis)", `console.log(Object.getPrototypeOf(globalThis));`, "the global object"],
    ["globalThis.__proto__", `console.log((globalThis as any).__proto__);`, "the global object"],
    ["__proto__ of a variable that holds the global object", `const everything: any = globalThis;\nconsole.log(everything.__proto__);`, "the global object"],
  ])("the world opens with %s", async (_, text, why) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: [why] });
  });

  test.each([
    ["Object.getPrototypeOf(process)", `console.log(Object.getPrototypeOf(process) === null);`],
    ["Object.getPrototypeOf(globalThis)", `console.log(Object.getPrototypeOf(globalThis) === Object.prototype);`],
    ["process.constructor", `console.log(process.constructor === Object, typeof process.__proto__);`],
  ])("the world stays closed with %s that is only compared", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("members of performance", () => {
  const named = async (text: string) => {
    const use = await runtimeUse({ "main.ts": `declare const performance: any, console: any;\n` + text });
    return { world: use.world, mark: use.facts.has("performance mark"), any: use.facts.has("performance *") };
  };

  test.each([
    ["a call", `performance.mark("a");`],
    ["brackets", `performance["mark"]("a");`],
    ["a destructured member", `const { mark } = performance; console.log(mark);`],
    ["the global object", `(globalThis as any).performance.mark("a");`],
    ["an optional call", `performance?.mark?.("a");`],
  ])("a member is named by %s", async (_, text) => {
    expect(await named(text)).toEqual({ world: "closed", mark: true, any: false });
  });

  test.each([
    ["another member", `console.log(performance.now());`],
    ["typeof", `console.log(typeof performance);`],
    ["an object of the program's own", `export {}; const performance = { mark() {} }; performance.mark();`],
    ["a member of another object", `const mine: any = { mark() {} }; mine.mark();`],
  ])("a member is not named by %s", async (_, text) => {
    const own = text.startsWith("export {}");
    const use = await runtimeUse({ "main.ts": (own ? "" : `declare const performance: any;\n`) + `declare const console: any;\n` + text });
    expect({ world: use.world, mark: use.facts.has("performance mark"), any: use.facts.has("performance *") }).toEqual({ world: "closed", mark: false, any: false });
  });

  test.each([
    ["it is printed", `console.log(performance);`],
    ["it is an argument", `console.log(JSON.stringify(performance));`],
    ["it is stored", `const held = [performance]; held[0].mark("a");`],
    ["a variable holds it", `const timer = performance; timer.now();`],
    ["a variable holds the global object", `const everything: any = globalThis; everything.performance.now();`],
    ["a member is stored, whose \`this\` it is when called", `performance.own = function () { return this; }; performance.own();`],
    ["a member is stored under a computed name", `const key = ["own"]; performance[key[0]] = function () { return this; };`],
    ["a member is defined", `Object.defineProperty(performance, "own", { value() { return this; } });`],
    ["its constructor is read", `console.log(performance.constructor.prototype);`],
    ["its __proto__ is read", `console.log(performance.__proto__.mark);`],
    ["its prototype is asked for", `console.log(Object.getPrototypeOf(performance).mark);`],
    ["its prototype is asked for through a variable", `const timer = performance; console.log(Reflect.getPrototypeOf(timer));`],
  ])("any member may be read, in a world that stays closed, when %s", async (_, text) => {
    expect(await named(text)).toMatchObject({ world: "closed", any: true });
  });

  test("any member may be read when a key is computed", async () => {
    expect(await named(`const key = ["mark"]; performance[key[0]]("a");`)).toMatchObject({ any: true });
  });

  test("node:perf_hooks hands the object on", async () => {
    const use = await runtimeUse({ "main.ts": `import { performance as timeline } from "node:perf_hooks";\ntimeline.mark("a", { detail: { deep: 1 } });` });
    expect({ world: use.world, any: use.facts.has("performance *") }).toEqual({ world: "closed", any: true });
  });
});

describe.concurrent("what is read of node:module", () => {
  const named = async (program: string, file = "main.ts") => {
    const use = await runtimeUse({ [file]: (file.endsWith(".ts") ? `declare const console: any, require: any;\n` : "") + program }, undefined, file);
    return { world: use.world, exports: use.lines.filter(line => line.startsWith("export ")) };
  };

  test.each([
    ["a named import", `import { SourceMap } from "node:module"; console.log(SourceMap);`, ["SourceMap"]],
    ["a named import under another name", `import { findSourceMap as find } from "module"; console.log(find);`, ["findSourceMap"]],
    ["a namespace", `import * as all from "node:module"; console.log(all.SourceMap);`, ["SourceMap"]],
    ["the default export", `import all from "node:module"; console.log(all["findSourceMap"]);`, ["findSourceMap"]],
    ["require", `console.log(require("node:module").SourceMap);`, ["SourceMap"]],
    ["require that is destructured", `const { SourceMap, findSourceMap } = require("node:module"); console.log(SourceMap, findSourceMap);`, ["SourceMap", "findSourceMap"]],
    ["another export", `import { isBuiltin } from "node:module"; console.log(isBuiltin("fs"));`, ["isBuiltin"]],
  ])("by %s", async (_, program, names) => {
    expect(await named(program)).toEqual({ world: "closed", exports: names.map(name => "export node:module " + name) });
  });

  test.each([
    ["a type", `import type { SourceMap } from "node:module"; let held: SourceMap | undefined; console.log(held);`],
    ["an object of the program's own", `const mine = { SourceMap: 1 }; console.log(mine.SourceMap);`],
    ["another module", `import { SourceMap } from "./other"; console.log(SourceMap);`],
  ])("not by %s", async (_, program) => {
    const use = await runtimeUse({ "main.ts": `declare const console: any;\n` + program, "other.ts": `export const SourceMap = 1;` });
    expect({ world: use.world, exports: use.lines.filter(line => line.startsWith("export ")) }).toEqual({ world: "closed", exports: [] });
  });
});

describe.concurrent("members of Intl", () => {
  const named = async (text: string, declarations = `declare const Intl: any, console: any;\n`) => {
    const use = await runtimeUse({ "main.ts": declarations + text });
    return { world: use.world, global: use.facts.has("global Intl"), members: use.lines.filter(line => line.startsWith("Intl ")).map(line => line.slice("Intl ".length)).sort() };
  };

  test.each([
    ["new", `new Intl.Segmenter("en");`, ["Segmenter"]],
    ["a call", `console.log(Intl.getCanonicalLocales("en"));`, ["getCanonicalLocales"]],
    ["brackets", `new Intl["Collator"]();`, ["Collator"]],
    ["a destructured member", `const { DateTimeFormat, NumberFormat: Numbers } = Intl; console.log(DateTimeFormat, Numbers);`, ["DateTimeFormat", "NumberFormat"]],
    ["the global object", `new (globalThis as any).Intl.ListFormat();`, ["ListFormat"]],
    ["a member of a member", `console.log(Intl.DateTimeFormat.supportedLocalesOf("en"));`, ["DateTimeFormat"]],
    ["the base of a class", `class Mine extends Intl.PluralRules {} new Mine();`, ["PluralRules"]],
    ["instanceof", `console.log({} instanceof Intl.Locale);`, ["Locale"]],
    ["an optional member", `console.log(Intl?.DisplayNames);`, ["DisplayNames"]],
    ["a destructured member with a default", `const { DurationFormat = null } = Intl; console.log(DurationFormat);`, ["DurationFormat"]],
  ])("a member is named by %s", async (_, text, members) => {
    expect(await named(text)).toEqual({ world: "closed", global: true, members });
  });

  test.each([
    ["typeof", `console.log(typeof Intl);`, true],
    ["an object of the program's own", `export {}; const Intl = { Segmenter: class {} }; new Intl.Segmenter();`, false],
    ["a member of another object", `const mine: any = { Segmenter: class {} }; new mine.Segmenter();`, false],
    ["a type", `let formatter: typeof Intl.Segmenter | undefined; console.log(formatter);`, false],
    ["code that is not reached", `function never() { return new Intl.Segmenter(); }`, false],
  ])("no member is named by %s", async (_, text, global) => {
    const declarations = text.startsWith("export {}") ? `declare const console: any;\n` : undefined;
    expect(await named(text, declarations)).toEqual({ world: "closed", global, members: [] });
  });

  test.each([
    ["it is printed", `console.log(Intl);`],
    ["it is stored", `const held = [Intl]; new held[0].Segmenter();`],
    ["a variable holds it", `const services = Intl; new services.Segmenter();`],
    ["a variable holds the global object", `const everything: any = globalThis; new everything.Intl.Segmenter();`],
    ["it is spread", `console.log({ ...Intl });`],
    ["it is returned", `function services() { return Intl; } new (services().Segmenter)();`],
    ["it is tested and handed on", `console.log(Intl && Intl);`],
    ["the rest of it is taken", `const { Segmenter, ...others } = Intl; console.log(Segmenter, others);`],
    ["its names are listed", `console.log(Object.getOwnPropertyNames(Intl));`],
    ["it is reflected on", `console.log(Reflect.ownKeys(Intl));`],
    ["a member is stored", `Intl.Segmenter = class {};`],
    ["a member is defined", `Object.defineProperty(Intl, "Segmenter", { value: class {} });`],
  ])("any member may be read, in a world that stays closed, when %s", async (_, text) => {
    expect(await named(text)).toMatchObject({ world: "closed", members: expect.arrayContaining(["*"]) });
  });

  test("any member may be read when a key is computed", async () => {
    expect(await named(`const key = ["Segmenter"]; new Intl[key[0]]();`)).toMatchObject({ members: expect.arrayContaining(["*"]) });
  });
});

describe.concurrent("syntax that needs a part of the engine", () => {
  const syntaxIn = async (text: string) => {
    const use = await runtimeUse({ "main.ts": `declare const console: any;\n` + text });
    return use.lines.filter(line => line.startsWith("syntax "));
  };
  const added = async (text: string) => {
    const [without, withIt] = await Promise.all([syntaxIn(`console.log("hello");`), syntaxIn(text)]);
    return withIt.filter(line => !without.includes(line));
  };

  test("what is reached is listed", async () => {
    const all = await syntaxIn(`console.log(/a/.test("a"), 1n);`);
    expect(all).toContain("syntax regexp-literal");
    expect(all).toContain("syntax bigint-literal");
  });

  test.each([
    ["a string", `console.log("/a/", "1n");`],
    ["a comment", `// /a/ 1n\nconsole.log("hello");`],
    ["a type", `let one: 1n | undefined; console.log(String(one));`],
    ["code that is not reached", `function never() { return [/a/, 1n]; }\nconsole.log("hello");`],
  ])("%s adds nothing", async (_, text) => {
    expect(await added(text)).toEqual([]);
  });
});

describe.concurrent("regular expressions that need the tables of Unicode properties", () => {
  const regexpIn = async (text: string) => {
    const use = await runtimeUse({ "main.ts": `declare const console: any, process: any;\n` + text });
    return use.lines.filter(line => line.startsWith("regexp ")).sort();
  };

  test.each([
    ["a literal with a property", `console.log(String(/\\p{L}/u.test("a")));`],
    ["a literal with a property that is denied", `console.log(String(/\\P{L}/v.test("a")));`],
    ["a pattern in a string", `console.log(String(new RegExp("\\\\p{L}", "u").test("a")));`],
    ["a pattern in a constant", `const pattern = "\\\\p{" + "L}";\nconsole.log(String(RegExp(pattern, "u").test("a")));`],
  ])("%s", async (_, text) => {
    expect(await regexpIn(text)).toEqual(["regexp property-escape"]);
  });

  test.each([
    ["a pattern that is handed in", `console.log(String(new RegExp(process.argv[2], "u").test("a")));`],
    ["RegExp that is called with a pattern that is handed in", `console.log(String(RegExp(process.argv[2]).test("a")));`],
    ["RegExp that is handed on", `const Made = RegExp;\nconsole.log(String(new Made("a").test("a")));`],
    ["RegExp as a base", `class Mine extends RegExp {}\nconsole.log(String(new Mine("a").test("a")));`],
    ["RegExp.call", `console.log(String(RegExp.call(null, process.argv[2], "u")));`],
    ["RegExp of the global object", `console.log(String(new globalThis.RegExp(process.argv[2], "u")));`],
    ["RegExp of the global object in brackets", `console.log(String(new (globalThis as any)["RegExp"](process.argv[2])));`],
    ["RegExp taken out of the global object", `const { RegExp: Made } = globalThis;\nconsole.log(String(new Made("a")));`],
    ["arguments that are spread", `console.log(String(new RegExp(...(process.argv as [string]))));`],
    ["any member of the global object", `delete (globalThis as any).mine;`],
  ])("%s may hold any pattern", async (_, text) => {
    expect(await regexpIn(text)).toEqual(["regexp computed"]);
  });

  test.each([
    ["a literal without one", `console.log(String(/a+/u.test("a")));`],
    ["a pattern in a string without one", `console.log(String(new RegExp("a+", "u").test("a")));`],
    ["a copy of a literal", `console.log(String(new RegExp(/a+/, "g").test("a")));`],
    ["no pattern", `console.log(String(new RegExp().test("a")));`],
    ["the type of RegExp, instanceof and its prototype", `console.log(typeof RegExp, String(process.argv instanceof RegExp), typeof RegExp.prototype.exec);`],
    ["a class of the program's own", `export {};\nclass RegExp { constructor(public pattern: string) {} }\nconsole.log(String(new RegExp(process.argv[2]).pattern));`],
    ["a literal in a function that nothing mentions", `function never() { return [/\\p{L}/u, new RegExp(process.argv[2])]; }\nconsole.log("a");`],
    ["a string", `console.log("\\\\p{L}");`],
  ])("%s needs none", async (_, text) => {
    expect(await regexpIn(text)).toEqual([]);
  });
});

describe.concurrent("the options of Bun.serve", () => {
  const declaredHere = `declare const Response: any, Bun: any, process: any, console: any, JSON: any;\n`;
  const fetch = `fetch() { return new Response("served"); }`;
  const optionsIn = async (files: Record<string, string>) => {
    const use = await runtimeUse(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, declaredHere + text])));
    const of = (kind: string) => use.lines.filter(line => line.startsWith(kind + " ")).map(line => line.slice(kind.length + 1));
    return { world: use.world, options: of("serve-option").sort(), routeOptions: of("serve-route-option").sort() };
  };
  const optionsOf = (text: string) => optionsIn({ "main.ts": text });

  test.each([
    ["an object literal", `Bun.serve({ port: 0, ${fetch} });`, ["fetch", "port"]],
    ["names in quotes and in brackets", `Bun.serve({ "port": 0, ["hostname"]: "localhost", ${fetch} });`, ["fetch", "hostname", "port"]],
    ["a shorthand", `const port = 0;\nBun.serve({ port, ${fetch} });`, ["fetch", "port"]],
    ["a literal that is asserted to be something else", `Bun.serve({ app: {}, ${fetch} } as any);`, ["app", "fetch"]],
    ["a function that is asserted to be something else", `(Bun.serve as any)({ port: 0, ${fetch} });`, ["fetch", "port"]],
    ["brackets", `Bun["serve"]({ port: 0, ${fetch} });`, ["fetch", "port"]],
    ["the global object", `(globalThis as any).Bun.serve({ port: 0, ${fetch} });`, ["fetch", "port"]],
    ["an import", `import { serve } from "bun";\nserve({ port: 0, ${fetch} });`, ["fetch", "port"]],
    ["an import under another name", `import { serve as start } from "bun";\nstart({ port: 0, ${fetch} });`, ["fetch", "port"]],
    ["the default import", `import runtime from "bun";\nruntime.serve({ port: 0, ${fetch} });`, ["fetch", "port"]],
    ["a destructured Bun", `const { serve } = Bun;\nserve({ port: 0, ${fetch} });`, ["fetch", "port"]],
    ["a destructured Bun, under another name", `const { serve: start } = Bun;\nstart({ port: 0, ${fetch} });`, ["fetch", "port"]],
    ["two calls", `Bun.serve({ port: 0, ${fetch} });\nBun.serve({ unix: "/tmp/socket", ${fetch} });`, ["fetch", "port", "unix"]],
    ["a variable that goes nowhere else", `const options = { port: 0, ${fetch} };\nBun.serve(options);`, ["fetch", "port"]],
    ["a variable that goes to two servers", `const options = { port: 0, ${fetch} };\nBun.serve(options);\nBun.serve(options);`, ["fetch", "port"]],
    ["a variable of a variable", `const first = { port: 0, ${fetch} };\nconst second = first;\nBun.serve(second);`, ["fetch", "port"]],
    ["a spread literal", `Bun.serve({ ...{ port: 0 }, ${fetch} });`, ["fetch", "port"]],
    ["a spread variable", `const shared = { port: 0 };\nBun.serve({ ...shared, ${fetch} });`, ["fetch", "port"]],
    ["one of two literals", `Bun.serve(process.env.UNIX ? { unix: process.env.UNIX, ${fetch} } : { port: 0, ${fetch} });`, ["fetch", "port", "unix"]],
    ["a spread of one of two literals", `Bun.serve({ ...(process.env.TLS ? { tls: {} } : {}), ${fetch} });`, ["fetch", "tls"]],
    ["a spread behind &&", `Bun.serve({ ...(process.env.TLS && { tls: {} }), ${fetch} });`, ["fetch", "tls"]],
    ["a spread of undefined", `Bun.serve({ ...undefined, ${fetch} });`, ["fetch"]],
    ["no argument", `try { Bun.serve(); } catch {}`, []],
    ["an argument that is no object", `try { Bun.serve("options"); } catch {}`, []],
    ["a second argument", `Bun.serve({ ${fetch} }, JSON.parse(process.argv[2]));`, ["fetch"]],
    ["typeof and a comparison", `console.log(typeof Bun.serve, Bun.serve === undefined, !Bun.serve);`, []],
    ["a call that is not reached", `function never(options: any) { Bun.serve(options); }\nBun.serve({ ${fetch} });`, ["fetch"]],
  ])("are listed by name for %s", async (_, text, options) => {
    expect(await optionsOf(text)).toEqual({ world: "closed", options, routeOptions: [] });
  });

  test.each([
    ["a parameter", `function start(options: any) { Bun.serve(options); }\nstart({ ${fetch} });`],
    ["the result of a call", `Bun.serve(JSON.parse(process.argv[2]));`],
    ["a member", `const all = { options: { ${fetch} } };\nBun.serve(all.options);`],
    ["an instance", `class Options { ${fetch} }\nBun.serve(new Options());`],
    ["a function", `Bun.serve(function () {});`],
    ["spread arguments", `const all = [{ ${fetch} }];\nBun.serve(...all);`],
    ["a name that is computed", `Bun.serve({ [process.argv[2]]: {}, ${fetch} });`],
    ["a spread of what is not seen", `Bun.serve({ ...JSON.parse(process.argv[2]), ${fetch} });`],
    ["a spread of one of two, one of which is not seen", `Bun.serve({ ...(process.env.TLS ? JSON.parse(process.env.TLS) : {}), ${fetch} });`],
    ["a getter", `Bun.serve({ get port() { return 0; }, ${fetch} });`],
    ["a setter", `Bun.serve({ set port(value: number) {}, ${fetch} });`],
    ["a prototype", `Bun.serve({ __proto__: JSON.parse(process.argv[2]), ${fetch} });`],
    ["a prototype in quotes", `Bun.serve({ "__proto__": JSON.parse(process.argv[2]), ${fetch} });`],
    ["a variable that is stored to", `const options: any = { ${fetch} };\noptions.app = {};\nBun.serve(options);`],
    ["a variable that is stored to under a computed name", `const options: any = { ${fetch} };\noptions[process.argv[2]] = {};\nBun.serve(options);`],
    ["a variable that is read", `const options: any = { ${fetch} };\nconsole.log(options.port);\nBun.serve(options);`],
    ["a variable that is handed on", `const options = { ${fetch} };\nconsole.log(options);\nBun.serve(options);`],
    ["a variable that its own function mentions", `const options: any = { fetch() { options.app = {}; return new Response("served"); } };\nBun.serve(options);`],
    ["a variable that is assigned again", `let options: any = { ${fetch} };\noptions = JSON.parse(process.argv[2]);\nBun.serve(options);`],
    ["a variable that is spread into what goes elsewhere", `const options = { ${fetch} };\nconsole.log({ ...options });\nBun.serve(options);`],
    ["a variable that is exported", `export const options = { ${fetch} };\nBun.serve(options);`],
    ["a variable that is exported by name", `const options = { ${fetch} };\nexport { options };\nBun.serve(options);`],
    ["a variable that is the default export", `const options = { ${fetch} };\nBun.serve(options);\nexport default options;`],
    ["a function that is kept", `const start = Bun.serve;\nstart({ ${fetch} });`],
    ["a function that is handed on", `console.log(Bun.serve);`],
    ["call", `Bun.serve.call(undefined, { ${fetch} });`],
    ["apply", `Bun.serve.apply(undefined, [{ ${fetch} }]);`],
    ["bind", `Bun.serve.bind(undefined)({ ${fetch} });`],
    ["new", `new Bun.serve({ ${fetch} });`],
    ["a tagged template", "Bun.serve`options`;"],
    ["an import that is handed on", `import { serve } from "bun";\nconsole.log(serve);`],
    ["an import that is exported", `import { serve } from "bun";\nexport { serve };`],
    ["a destructured Bun that is handed on", `const { serve } = Bun;\nconsole.log(serve);`],
    ["a destructured Bun with a default", `const { serve = console.log } = Bun;\nserve({ ${fetch} });`],
    ["a destructured Bun that is exported", `export const { serve } = Bun;\nserve({ ${fetch} });`],
    ["a descriptor", `Object.getOwnPropertyDescriptor(Bun, "serve")!.value({ ${fetch} });`],
    ["a variable that holds the global object", `const everything: any = globalThis;\neverything.Bun.serve({ ${fetch} });`],
  ])("may be any for %s", async (_, text) => {
    const { world, options, routeOptions } = await optionsOf(text);
    expect({ world, any: options.includes("*"), anyOfARoute: routeOptions.includes("*") }).toEqual({ world: "closed", any: true, anyOfARoute: true });
  });

  test.each([
    ["functions", `{ "/a": () => new Response("a"), "/b": function () { return new Response("b"); }, "/c"() { return new Response("c"); }, async "/d"() { return new Response("d"); } }`, []],
    ["what is no object", `{ "/a": false, "/b": undefined, "/c": null, "/d": "text", "/e": 1 }`, []],
    ["paths that are computed", `{ [process.argv[2]]: () => new Response("a") }`, []],
    ["functions by method", `{ "/a": { GET: () => new Response("a"), POST() { return new Response("b"); } } }`, ["GET", "POST"]],
    ["a directory", `{ "/files/*": { dir: process.argv[2] } }`, ["dir"]],
    ["a directory and a style", `{ "/*": { dir: ".", style: "nextjs-pages" } }`, ["dir", "style"]],
    ["a directory and a style, asserted to be something else", `{ "/*": { dir: ".", style: "nextjs-pages" } as never } as any`, ["dir", "style"]],
    ["a directory and a style by method", `{ "/*": { GET: { dir: ".", style: "nextjs-pages" } } }`, ["GET", "dir", "style"]],
    ["one of two", `{ "/a": process.env.FILES ? { dir: process.env.FILES } : () => new Response("a") }`, ["dir"]],
    ["a spread literal", `{ ...{ "/a": { GET: () => new Response("a") } } }`, ["GET"]],
    ["a spread in a route", `{ "/a": { ...{ GET: () => new Response("a") } } }`, ["GET"]],
    ["what is unseen under a name that is no method", `{ "/a": { dir: JSON.parse(process.argv[2]), headers: JSON.parse(process.argv[2]) } }`, ["dir", "headers"]],
    ["an array", `[JSON.parse(process.argv[2])]`, []],
  ])("the options of a route are listed by name for %s", async (_, routes, routeOptions) => {
    expect(await optionsOf(`Bun.serve({ routes: ${routes}, ${fetch} });`)).toEqual({ world: "closed", options: ["fetch", "routes"], routeOptions });
    expect(await optionsOf(`Bun.serve({ static: ${routes}, ${fetch} });`)).toEqual({ world: "closed", options: ["fetch", "static"], routeOptions });
  });

  test.each([
    ["a function that is declared", `function a() { return new Response("a"); }\nBun.serve({ routes: { "/a": a, "/b": { GET: a } } });`, ["GET"]],
    ["a function in a variable", `export const a = () => new Response("a");\nBun.serve({ routes: { "/a": a } });`, []],
    ["routes in a variable", `const routes = { "/a": { GET: () => new Response("a") } };\nBun.serve({ routes });`, ["GET"]],
    ["a route in a variable", `const a = { GET: () => new Response("a") };\nBun.serve({ routes: { "/a": a } });`, ["GET"]],
    ["routes in the variable of the options", `const options = { routes: { "/*": { dir: ".", style: "nextjs-pages" } } };\nBun.serve(options);`, ["dir", "style"]],
    ["routes that are spread", `const shared = { "/a": { GET: () => new Response("a") } };\nBun.serve({ routes: { ...shared, "/b": { POST: () => new Response("b") } } });`, ["GET", "POST"]],
  ])("the options of a route are listed by name for %s", async (_, text, routeOptions) => {
    expect(await optionsOf(text)).toEqual({ world: "closed", options: ["routes"], routeOptions });
  });

  test.each([
    ["routes that are not seen", `JSON.parse(process.argv[2])`],
    ["routes that are a function", `function () {}`],
    ["a route that is not seen", `{ "/a": JSON.parse(process.argv[2]) }`],
    ["a route that is a member", `{ "/a": process.env }`],
    ["a route that is an instance", `{ "/a": new (class { dir = "."; style = "nextjs-pages"; })() }`],
    ["a route that is a class", `{ "/a": class {} }`],
    ["a route that is an array", `{ "/a": [] }`],
    ["a route that is a regular expression", `{ "/a": /a/ }`],
    ["a route by method that is not seen", `{ "/a": { GET: JSON.parse(process.argv[2]) } }`],
    ["one of two, one of which is not seen", `{ "/a": process.env.A ? JSON.parse(process.env.A) : () => new Response("a") }`],
    ["a name that is computed", `{ "/a": { [process.argv[2]]: "nextjs-pages", dir: "." } }`],
    ["a name by method that is computed", `{ "/a": { GET: { [process.argv[2]]: "nextjs-pages", dir: "." } } }`],
    ["a spread of what is not seen", `{ ...JSON.parse(process.argv[2]) }`],
    ["a spread of what is not seen, in a route", `{ "/a": { ...JSON.parse(process.argv[2]) } }`],
    ["a getter", `{ get "/a"() { return JSON.parse(process.argv[2]); } }`],
    ["a getter in a route", `{ "/a": { dir: ".", get style() { return "nextjs-pages"; } } }`],
    ["a prototype", `{ __proto__: JSON.parse(process.argv[2]) }`],
    ["a prototype in a route", `{ "/a": { __proto__: JSON.parse(process.argv[2]) } }`],
  ])("the options of a route may be any for %s", async (_, routes) => {
    expect(await optionsOf(`Bun.serve({ routes: ${routes}, ${fetch} });`)).toMatchObject({ world: "closed", options: ["fetch", "routes"], routeOptions: expect.arrayContaining(["*"]) });
  });

  test.each([
    ["routes in a variable that is stored to", `const routes: any = {};\nroutes["/*"] = JSON.parse(process.argv[2]);\nBun.serve({ routes, ${fetch} });`],
    ["routes in a variable that is handed on", `const routes = {};\nconsole.log(routes);\nBun.serve({ routes, ${fetch} });`],
    ["a route in a variable that is stored to", `const route: any = { dir: "." };\nroute.style = "nextjs-pages";\nBun.serve({ routes: { "/*": route }, ${fetch} });`],
    ["a function that is assigned again", `let a: any = () => new Response("a");\na = JSON.parse(process.argv[2]);\nBun.serve({ routes: { "/a": a }, ${fetch} });`],
    ["a declared function that is assigned again", `function a() {}\n(a as any) = JSON.parse(process.argv[2]);\nBun.serve({ routes: { "/a": a }, ${fetch} });`],
    ["a parameter", `function start(a: any) { Bun.serve({ routes: { "/a": a }, ${fetch} }); }\nstart(() => new Response("a"));`],
  ])("the options of a route may be any for %s", async (_, text) => {
    expect(await optionsOf(text)).toMatchObject({ world: "closed", options: ["fetch", "routes"], routeOptions: expect.arrayContaining(["*"]) });
  });

  test.each([
    ["that is declared", `import { a } from "./a";`, `export function a() { return new Response("a"); }`],
    ["in a variable", `import { a } from "./a";`, `export const a = () => new Response("a");`],
    ["under another name", `import { b as a } from "./a";`, `export const b = () => new Response("a");`],
    ["that is the default export", `import a from "./a";`, `export default function a() { return new Response("a"); }`],
    ["that is the default export and has no name", `import a from "./a";`, `export default function () { return new Response("a"); }`],
  ])("a function %s in another file is a function", async (_, imports, exports) => {
    const found = await optionsIn({ "main.ts": `${imports}\nBun.serve({ routes: { "/a": a, "/b": { GET: a } } });`, "a.ts": exports });
    expect(found).toEqual({ world: "closed", options: ["routes"], routeOptions: ["GET"] });
  });

  test.each([
    ["an object", `import { a } from "./a";`, `export const a = { dir: ".", style: "nextjs-pages" };`],
    ["a variable that is assigned again", `import { a } from "./a";`, `export let a: any = () => new Response("a");\na = { dir: ".", style: "nextjs-pages" };`],
    ["a declared function that is assigned again", `import { a } from "./a";`, `export function a() {}\n(a as any) = { dir: ".", style: "nextjs-pages" };`],
    ["the result of a call", `import { a } from "./a";`, `export const a = JSON.parse(process.argv[2]);`],
    ["an export by name", `import { a } from "./a";`, `const a = () => new Response("a");\nexport { a };`],
    ["a default export that is an expression", `import a from "./a";`, `export default JSON.parse(process.argv[2]);`],
    ["a member of the namespace", `import * as all from "./a";\nconst a = all.a;`, `export const a = () => new Response("a");`],
  ])("%s out of another file is not seen", async (_, imports, exports) => {
    const found = await optionsIn({ "main.ts": `${imports}\nBun.serve({ routes: { "/a": a } });`, "a.ts": exports });
    expect(found).toEqual({ world: "closed", options: ["routes"], routeOptions: ["*"] });
  });

  test("a program that does not name Bun.serve has none", async () => {
    expect(await optionsOf(`const mine = { serve(options: object) { console.log(options); } };\nmine.serve({ app: {}, routes: { "/*": { dir: ".", style: "nextjs-pages" } } });`)).toEqual({ world: "closed", options: [], routeOptions: [] });
  });

  test("node:http names the options that it hands to Bun.serve", async () => {
    const found = await optionsOf(`import { createServer } from "node:http";\ncreateServer(() => {}).listen(0);`);
    expect(found.options).toContain("onNodeHTTPRequest");
    expect(found).toMatchObject({ world: "closed", options: expect.not.arrayContaining(["*", "app", "routes", "static"]), routeOptions: [] });
  });
});

describe.concurrent("Bun and process under another name", () => {
  const declaredHere = `declare const Bun: any, process: any, console: any, require: any, module: any;\n`;
  const used = async (files: Record<string, string>, entryPoint = "main.ts") => {
    const use = await runtimeUse(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, path.endsWith(".ts") ? declaredHere + text : text])), undefined, entryPoint);
    return { world: use.world, whyOpen: use.whyOpen, color: use.facts.has("Bun color"), report: use.facts.has("process report") };
  };
  const followed = { world: "closed", whyOpen: [] };

  test.each([
    ["the default export", `import B from "bun"; console.log(B.color("red", "hex"));`],
    ["the default export, imported by name", `import { default as B } from "bun"; console.log(B.color("red", "hex"));`],
    ["the default export, imported by name and handed to a function", `import { default as B } from "bun"; function paint(b: any) { return b.color("red", "hex"); } console.log(paint(B));`],
    ["the namespace", `import * as B from "bun"; console.log(B.color("red", "hex"));`],
    ["default of the namespace", `import * as B from "bun"; console.log(B.default.color("red", "hex"));`],
    ["default of the namespace in brackets", `import * as B from "bun"; console.log((B as any)["default"].color("red", "hex"));`],
    ["default of a variable that holds the namespace", `import * as B from "bun"; const held: any = B; console.log(held.default.color("red", "hex"));`],
    ["a named import", `import { color } from "bun"; console.log(color("red", "hex"));`],
    ["require", `console.log(require("bun").color("red", "hex"));`],
    ["module.require", `console.log(module.require("bun").color("red", "hex"));`],
    ["a require that the program creates", `import { createRequire } from "node:module"; const load = createRequire(import.meta.url); console.log(load("bun").color("red", "hex"));`],
    ["a require that the program creates, whose result is held", `import { createRequire } from "node:module"; const load = createRequire(import.meta.url); const B = load("bun"); console.log(B.color("red", "hex"));`],
    ["a require that is created and called at once", `import { createRequire } from "node:module"; console.log(createRequire(import.meta.url)("bun").color("red", "hex"));`],
    ["a require made by a createRequire that was required", `const { createRequire } = require("node:module"); const load = createRequire(import.meta.url); console.log(load("bun").color("red", "hex"));`],
    ["process.getBuiltinModule", `console.log(process.getBuiltinModule("bun").color("red", "hex"));`],
    ["process.getBuiltinModule, whose result is held", `const B = process.getBuiltinModule("bun"); console.log(B ? B.color("red", "hex") : "none");`],
    ["import name = require", `import B = require("bun"); console.log(B.color("red", "hex"));`],
    ["await import() that is taken apart", `const { color } = await import("bun"); console.log(color("red", "hex"));`],
    ["await import() that is held", `const B = await import("bun"); console.log(B.color("red", "hex"));`],
    ["await import() that is read at once", `console.log((await import("bun")).color("red", "hex"));`],
    ["default of await import()", `console.log((await import("bun")).default.color("red", "hex"));`],
    ["await import() in a function", `async function paint() { const { color } = await import("bun"); return color("red", "hex"); } console.log(await paint());`],
  ])("a member of Bun is named through %s", async (_, text) => {
    expect(await used({ "main.ts": text })).toEqual({ ...followed, color: true, report: false });
  });

  test.each([
    ["the default export, imported by name", `import { default as p } from "node:process"; console.log(typeof p.report.getReport);`],
    ["default of the namespace", `import * as p from "node:process"; console.log(typeof p.default.report.getReport);`],
    ["a require that the program creates", `import { createRequire } from "node:module"; const load = createRequire(import.meta.url); console.log(typeof load("node:process").report.getReport);`],
    ["process.getBuiltinModule", `console.log(typeof process.getBuiltinModule("node:process").report.getReport);`],
    ["process.getBuiltinModule of the short name", `console.log(typeof process.getBuiltinModule("process").report.getReport);`],
    ["import name = require", `import p = require("node:process"); console.log(typeof p.report.getReport);`],
    ["await import()", `console.log(typeof (await import("node:process")).report.getReport);`],
  ])("a member of process is named through %s", async (_, text) => {
    expect(await used({ "main.ts": text })).toEqual({ ...followed, color: false, report: true });
  });

  test("a server that is made through Bun.serve of another file may have any option", async () => {
    const use = await runtimeUse(withDeclarations({ "main.ts": `import { listen } from "./other"; listen({ fetch: () => new Response("") });`, "other.ts": `export { serve as listen } from "bun";` }));
    expect({ world: use.world, serve: use.facts.has("Bun serve"), option: use.facts.has("serve-option *"), route: use.facts.has("serve-route-option *") }).toEqual({ world: "closed", serve: true, option: true, route: true });
  });

  test("a member that another file exports again by name is named", async () => {
    expect(await used({ "main.ts": `import { paintIt } from "./other"; console.log(paintIt("red", "hex"));`, "other.ts": `export { color as paintIt } from "bun";` })).toEqual({ ...followed, color: true, report: false });
  });

  test.each([
    ["its default export is exported again", `export { default } from "bun";`, `import B from "./other"; console.log(B.color("red", "hex"));`],
    ["its default export is exported again under a name", `export { default as B } from "bun";`, `import { B } from "./other"; console.log(B.color("red", "hex"));`],
    ["its namespace is exported", `export * as B from "bun";`, `import { B } from "./other"; console.log(B.color("red", "hex"));`],
    ["an import of it is exported", `import B from "bun"; export { B };`, `import { B } from "./other"; console.log(B.color("red", "hex"));`],
    ["an import of its namespace is exported under another name", `import * as all from "bun"; export { all as B };`, `import { B } from "./other"; console.log(B.color("red", "hex"));`],
    ["an import of its default export by name is exported", `import { default as all } from "bun"; export { all as B };`, `import { B } from "./other"; console.log(B.color("red", "hex"));`],
    ["an import of it is the default export", `import B from "bun"; export default B;`, `import B from "./other"; console.log(B.color("red", "hex"));`],
    ["default is taken out of its namespace", `import * as all from "bun"; const { default: B } = all as any; export function paint() { return B.color("red", "hex"); }`, `import { paint } from "./other"; console.log(paint());`],
  ])("Bun escapes when %s", async (_, other, main) => {
    expect(await used({ "main.ts": main, "other.ts": other })).toMatchObject({ world: "open", whyOpen: ["Bun"] });
  });

  test.each([
    ["the promise of import() is asked for it", `import("bun").then(B => console.log(B.color("red", "hex")));`],
    ["the promise of import() is held", `const promise = import("bun"); console.log((await promise).color("red", "hex"));`],
    ["the promise of import() is handed on", `const [B] = await Promise.all([import("bun")]); console.log(B.color("red", "hex"));`],
    ["what await import() gives is handed on", `console.log(await import("bun"));`],
    ["import name = require is exported", `export import B = require("bun");`],
    ["the name of import name = require is exported", `import B = require("bun"); export { B };`],
    ["a parameter that is also a property of the class holds it by default", `class Holder { constructor(public held: any = Bun) {} } console.log(new Holder().held.color("red", "hex"));`],
    ["a variable that holds it is added to, which asks it for its value", `let held: any = Bun; held += 1; console.log(held);`],
  ])("Bun escapes when %s", async (_, text) => {
    expect(await used({ "main.ts": text })).toMatchObject({ world: "open", whyOpen: ["Bun"] });
  });

  test("a parameter that holds Bun by default is followed", async () => {
    expect(await used({ "main.ts": `function paint(held: any = Bun) { return held.color("red", "hex"); } console.log(paint());` })).toEqual({ ...followed, color: true, report: false });
  });

  test.each([
    ["getBuiltinModule", `import { getBuiltinModule } from "node:process"; console.log(getBuiltinModule(process.argv[2]));`],
    ["getBuiltinModule that is exported again", `export { getBuiltinModule } from "node:process";`],
    ["mainModule", `import { mainModule } from "node:process"; console.log(mainModule);`],
    ["a method that returns process", `import { on } from "node:process"; console.log(on);`],
  ])("process escapes through an import of %s", async (_, text) => {
    const use = await used({ "main.ts": text });
    expect({ world: use.world, escapes: use.whyOpen.includes("process") }).toEqual({ world: "open", escapes: true });
  });

  test.each([
    ["a variable of the program's own with the name of an import in another scope", `import B from "bun"; function mine(B: any) { return B.color; } console.log(mine({ color: 1 }), typeof B);`],
    ["a function of the program's own that is called with the name of the module", `function load(name: string) { return { color: name }; } console.log(load("bun").color);`],
    ["a require that the program creates, of another module", `import { createRequire } from "node:module"; const load = createRequire(import.meta.url); console.log(load("node:path").color);`],
    ["getBuiltinModule of another module", `console.log(process.getBuiltinModule("node:path").color);`],
    ["default of another module", `import * as other from "./other"; console.log((other as any).default.color);`],
    ["an import for its types alone", `import type B from "bun"; let held: typeof B | undefined; console.log((held as any)?.nothing);`],
    ["an export of another import", `import { join } from "node:path"; export { join as color };`],
    ["await import() of another module", `console.log(((await import("node:path")) as any).color);`],
    ["import name = require of another module", `import path = require("node:path"); console.log((path as any).color);`],
  ])("a member of Bun is not named through %s", async (_, text) => {
    expect(await used({ "main.ts": text, "other.ts": `export default { color: 1 };` })).toEqual({ ...followed, color: false, report: false });
  });
});

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
    ["Bun.build, whose sources may call macros", `console.log(await Bun.build({ entrypoints: [process.argv[2]] }));\nexport {};`, "Bun.build"],
    ["Bun.Transpiler, whose sources may call macros", `console.log(new Bun.Transpiler().transformSync(process.argv[2]));`, "Bun.Transpiler"],
  ])("%s", async (_, text, why) => {
    const use = await of(text);
    expect({ world: use.world, isSaid: use.whyOpen.includes(why) }).toEqual({ world: "open", isSaid: true });
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
    ["the constructor of a function", `console.log((function () {}).constructor("return 1")());`],
    ["the constructor of an async function", `console.log((async function () {}).constructor("return 1"));`],
    ["a computed name read from what may be a function", given + `console.log(given[process.argv[3]]);`],
    ["constructor of a value that is not known", given + `console.log(given.constructor("return 1"));`],
    ["eval of a value that is not known", given + `console.log(given.eval("1"));`],
    ["Function of a value that is not known", given + `console.log(new given.Function("return 1"));`],
  ])("the world stays closed with %s", async (_, text) => {
    const [without, use, strict] = await Promise.all([of(text), withTheFlag(text), withTheFlag(text, "--disallow-code-generation-from-strings=strict")]);
    expect({ without: without.world, first: use.lines[0], strict: strict.lines[0] }).toEqual({ without: "open", first: "closed", strict: "closed" });
  });

  test.each([
    ["require of a computed name", `console.log(require(process.argv[2]));`],
    ["import() of a computed name", `const name: string = process.argv[2]; import(name);`],
    ["a Worker", `new Worker("./worker.ts");`],
    ["node:vm", `import vm from "node:vm";\nconsole.log(vm.runInNewContext("1"));`],
    ["process.dlopen", `process.dlopen(module, "./addon.node");`],
    ["Bun.plugin", `Bun.plugin({ name: "a", setup() {} });`],
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
    ["exports a number", "main.js", `module.exports = 1;`],
    ["exports a server", "main.cjs", `module.exports = { fetch() { return new Response("ok"); }, port: 0 };`],
  ])("an executable whose entry point is CommonJS and %s has a closed world", async (_, entryPoint, text) => {
    const use = await runtimeUse({ [entryPoint]: text }, build, entryPoint);
    expect({ first: use.lines[0], exitCode: use.exitCode }).toEqual({ first: "closed", exitCode: 0 });
  });

  test.each([
    ["the entry point is CommonJS and reads a computed name from a function", "main.cjs", `function mine() {}\nconsole.log(mine[process.argv[2]]);`],
    ["constructor is imported from a CommonJS module that exports a function", "main.mjs", `import { constructor as found } from "./exports-a-function.cjs";\nconsole.log(found("return 1")());`],
  ])("an executable has an open world where %s", async (_, entryPoint, text) => {
    const use = await runtimeUse({ [entryPoint]: text, "exports-a-function.cjs": `module.exports = function () {};` }, build, entryPoint);
    expect({ whyOpen: use.whyOpen, exitCode: use.exitCode }).toEqual({ whyOpen: ["constructor, or a name that is computed, read from what may be a function"], exitCode: 0 });
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
    ["a CommonJS module that exports nothing", { "main.cjs": `console.log("hello");` }],
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
    ["an object with routes", { "main.ts": `export default { port: 0, routes: { "/*": { dir: ".", style: "nextjs-pages" } } };` }, ["port", "routes"], ["dir", "style"]],
    ["an object that asks for the development server", { "main.ts": `export default { port: 0, app: {} };` }, ["app", "port"], []],
  ])("its options are listed by name for export default of %s", async (_, files, options, routeOptions) => {
    expect(await optionsIn(files)).toEqual({ world: "closed", options, routeOptions, exitCode: 0 });
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
    const { options, routeOptions, exitCode } = await optionsIn(files);
    expect({ any: options.includes("*"), anyOfARoute: routeOptions.includes("*"), exitCode }).toEqual({ any: true, anyOfARoute: true, exitCode: 0 });
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

  test("an option of --compile-exec-argv that runs built-in JavaScript from its text: nothing is left out for not being named", async () => {
    expect(await built({ "main.ts": hello }, ["main.ts", "--compile-exec-argv=--stack-trace-limit=3"])).toEqual({ stdout: "hello\n", exitCode: 0, leavesOutWhatIsNotNamed: false });
    expect(await built({ "main.ts": hello }, ["main.ts", "--compile-exec-argv=--trace-exitx"])).toEqual({ stdout: "hello\n", exitCode: 0, leavesOutWhatIsNotNamed: false });
    expect(await built({ "main.ts": hello }, ["main.ts", "--compile-exec-argv=--smol"])).toEqual({ stdout: "hello\n", exitCode: 0, leavesOutWhatIsNotNamed: true });
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
