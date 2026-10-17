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
  const whyOpen = lines.filter(line => line.startsWith("open ")).map(line => line.slice("open ".length).replace(/ in \S+$/, ""));
  return { lines, facts: new Set(lines), world: lines[0] === "closed" ? "closed" : "open", whyOpen, stdout, stderr, exitCode };
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
    expect(use.lines[0]).toBe("closed");
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
    expect(use.lines[0]).toBe("closed");
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
    ["a function of its own called on the global object", `(globalThis as any).mine = function (this: any) { return this; }; console.log((globalThis as any).mine());`, "a function of the program's own that is called on the global object"],
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
    ["instanceof", `const scope: any = globalThis; console.log(scope instanceof Object);`],
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
  const wildcards = (lines: string[]) => lines.filter(line => line.endsWith(" *") && line !== "property *");

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
  const wildcards = (lines: string[]) => lines.filter(line => line.endsWith(" *") && line !== "property *");

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

  test("what a built-in function that native code may always call names counts in every program", async () => {
    const hello = await of(`console.log(1);`);
    expect(hello.facts.has("Bun main")).toBe(true);
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
    ["Bun.build", `console.log(Bun.build({ entrypoints: [] }));`, ["Bun write", "Bun resolve"]],
    ["Bun.serve", `console.log(Bun.serve({ fetch: () => new Response("") }));`, ["Bun resolve"]],
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

  test("a function that nothing mentions brings nothing", async () => {
    const use = await of(`function never() { return Bun.build({ entrypoints: [] }); }\nconsole.log(1);`);
    expect(named(use)).toEqual([]);
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
    ["a parameter in brackets", `function read(key: string) { return given[key]; }\nconsole.log(read("a"));`],
    ["a call of what a key finds", `function call(key: string) { return given[key](); }\nconsole.log(call("a"));`],
    ["a variable that is assigned to", `let key = "a";\nkey = given.name;\nconsole.log(given[key]);`],
    ["strings that are joined", `console.log(given["locale" + given.rest]);`],
    ["a key of super", `class Text extends String { read(key: string) { return (super[key as any] as any); } }\nconsole.log(new Text().read("a"));`],
    ["a computed key in a pattern", `function read(key: string) { const { [key]: value } = given; return value; }\nconsole.log(read("a"));`],
    ["a computed key in a pattern that is assigned to", `function read(key: string) { let value; ({ [key]: value } = given); return value; }\nconsole.log(read("a"));`],
    ["Reflect.get of a key", `function read(key: string) { return Reflect.get(given, key); }\nconsole.log(read("a"));`],
    ["Object.getOwnPropertyDescriptor of a key", `function read(key: string) { return Object.getOwnPropertyDescriptor(given, key); }\nconsole.log(read("a"));`],
    ["Object.getOwnPropertyDescriptors", `console.log(Object.getOwnPropertyDescriptors(given));`],
    ["Reflect.get that is handed on", `const get = Reflect.get;\nconsole.log(get);`],
    ["Reflect that is handed on", `console.log(Reflect);`],
    ["Object that is handed on", `console.log(Object);`],
    ["Reflect of the global object", `function read(key: string) { return globalThis.Reflect.get(given, key); }\nconsole.log(read("a"));`],
    ["Object of the global object", `function read(key: string) { return globalThis.Object.getOwnPropertyDescriptor(given, key); }\nconsole.log(read("a"));`],
    ["Reflect of a variable that holds the global object", `const everything: any = globalThis;\nfunction read(key: string) { return everything.Reflect.get(given, key); }\nconsole.log(read("a"));`],
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
    expect(use.lines[0]).toBe("closed");
    expect(use.lines).toContain("process *");
    expect(use.lines.some(line => line.startsWith("escapes process "))).toBe(true);
    expect(without.lines.filter(line => !line.includes("property ") && (line.endsWith(" *") || line.startsWith("escapes ")))).toEqual([]);
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
    ["of an array, whose prototype may have been set to a function", `const list: number[] = [1];\nconsole.log(new (list.constructor as any)());`],
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
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: [why] });
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
    ["process on the left of instanceof", has + `console.log(process instanceof Has);`, "process"],
    ["Bun on the left of instanceof", has + `console.log(Bun instanceof Has);`, "Bun"],
    ["process compared loosely with a number", `console.log(process == 1);`, "process"],
    ["Bun compared loosely with a string", `console.log(Bun != "a");`, "Bun"],
    ["the global object compared loosely", `console.log((globalThis as any) == 1);`, "the global object"],
    ["a store on the global object under a name that is joined", `(globalThis as any)["mi" + process.argv[2]] = function (this: any) { return this; };`, "the global object"],
    ["a store on process under a computed name", `process[process.argv[2]] = 1;`, "process"],
    ["a call of what a symbol finds on the global object", `const mine = Symbol("mine");\n(globalThis as any)[mine] = function (this: any) { return this; };\nconsole.log((globalThis as any)[mine]());`, "the global object"],
    ["a function declaration that is stored to", `function read(given: any) { return typeof given; }\n// @ts-ignore\nread = (given: any) => given;\nconsole.log(read(globalThis));`, "the global object"],
    ["a free name that is stored to and called on the global object", `// @ts-ignore\nmine = function (this: any) { return this; };\nconsole.log((globalThis as any).mine());`, "a function of the program's own that is called on the global object"],
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

describe.concurrent("a member that makes or loads code is one whatever it is read from", () => {
  const why = "a member that makes or loads code, read from what may be the global object, process or Bun";
  const given = `declare const given: any;\n`;

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
    return use.lines.filter(line => /^(autoload|option) /.test(line));
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
    ["--compile-exec-argv=--smol", ["autoload bunfig", "option compile-exec-argv"]],
    ["--sourcemap", ["autoload bunfig", "option sourcemap"]],
  ])("%s", async (flag, facts) => {
    expect(await known(flag)).toEqual(facts);
  });

  test("a trimmed executable reads bunfig.toml only if it is built to", async () => {
    const trimmed = await runtimeUse(hello, [...build, "--compile-trim-runtime"]);
    if (trimmed.stderr.includes("nothing can be left out of this Bun")) return;
    expect(await known("--compile-trim-runtime")).toEqual([]);
    expect(await known("--compile-trim-runtime", "--compile-autoload-bunfig")).toEqual(["autoload bunfig"]);
  });

  test("bun check, which builds nothing, says nothing about a build", async () => {
    const use = await runtimeUse(hello);
    expect(use.lines.filter(line => /^(autoload|environment|option) /.test(line))).toEqual([]);
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
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "--compile-trim-runtime", ...entryPoints, "--outfile", "main"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
    if (buildExitCode !== 0) throw new Error(buildErrors);
    await using proc = Bun.spawn({ cmd: [join(String(dir), "main")], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode, size: Bun.file(join(String(dir), process.platform === "win32" ? "main.exe" : "main")).size };
  }

  let open: ReturnType<typeof built> | undefined;
  const leavesOutWhatIsNotNamed = async (size: number) => (await (open ??= built({ "main.ts": hello + `\nconsole.log(eval("1"));` }))).size - size > 1_000_000;

  test("every module is compiled: what the program does not name is left out", async () => {
    const { size, ...said } = await built({ "main.ts": hello });
    expect({ ...said, isSmaller: await leavesOutWhatIsNotNamed(size) }).toEqual({ stdout: "hello\n", exitCode: 0, isSmaller: true });
  });

  test("a module that is not compiled: nothing is left out for not being named", async () => {
    const { size, ...said } = await built({ "main.ts": hello, "data.json": `{ "a": 1 }` }, ["main.ts", "data.json"]);
    expect({ ...said, isSmaller: await leavesOutWhatIsNotNamed(size) }).toEqual({ stdout: "hello\n", exitCode: 0, isSmaller: false });
  });

  test("a package that was not there at the build may be there at run time: nothing is left out for not being named", async () => {
    const { size, ...said } = await built({ "main.ts": hello + `\ntry { require("late-package"); } catch {}` });
    expect({ ...said, isSmaller: await leavesOutWhatIsNotNamed(size) }).toEqual({ stdout: "hello\n", exitCode: 0, isSmaller: false });
  });

  test("it runs in place: nothing is left out for not being named", async () => {
    const { size, ...said } = await built({ "main.ts": hello }, ["main.ts", "--compile-in-place"]);
    expect({ ...said, isSmaller: await leavesOutWhatIsNotNamed(size) }).toEqual({ stdout: "hello\n", exitCode: 0, isSmaller: false });
  });

  test("the script of a page runs in a browser, not here: what the program does not name is left out", async () => {
    const files = {
      "main.ts": `// @ts-ignore\nimport page from "./index.html";\n` + declared + `console.log(typeof page);`,
      "index.html": `<html><body><script type="module" src="./client.ts"></script></body></html>`,
      "client.ts": `export {};\n(globalThis as any).ready = eval("1 + 1");`,
    };
    const { size, ...said } = await built(files);
    expect({ ...said, isSmaller: await leavesOutWhatIsNotNamed(size) }).toEqual({ stdout: "object\n", exitCode: 0, isSmaller: true });
  });
});
