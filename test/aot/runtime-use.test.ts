import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, allowJs: true, types: [] },
});

async function runtimeUse(files: Record<string, string>, command = ["check", "--aot", "--no-pretty"]) {
  using dir = tempDir("aot-runtime-use", { "tsconfig.json": tsconfig, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...command, "--aot-explain=runtime-use", "main.ts"],
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
    ["a parameter", `function f(HTMLRewriter: any) { return new HTMLRewriter(); } f(Object);`],
    ["a type", `let rewriter: typeof HTMLRewriter | undefined; console.log(rewriter);`],
    ["a property of another object", `const mine: any = { HTMLRewriter: Object }; new mine.HTMLRewriter();`],
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
  const wildcards = (lines: string[]) => lines.filter(line => line.endsWith(" *"));

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
  const wildcards = (lines: string[]) => lines.filter(line => line.endsWith(" *"));

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
});

describe.concurrent("what a built-in module lets escape", () => {
  test("any property of process may be read once node:cluster is in the program", async () => {
    const without = await of(`console.log(1);`);
    const use = await runtimeUse({ "main.ts": `import cluster from "node:cluster";\ndeclare const console: any;\nconsole.log(cluster.isPrimary);` });
    expect(use.lines[0]).toBe("closed");
    expect(use.lines).toContain("process *");
    expect(use.lines.some(line => line.startsWith("escapes process "))).toBe(true);
    expect(without.lines.filter(line => line.endsWith(" *") || line.startsWith("escapes "))).toEqual([]);
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
    expect(use.whyOpen).toEqual([why]);
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

describe.concurrent("a call of the Function constructor whose error is caught", () => {
  test.each([
    ["new Function in a try block", `let allowed = true; try { new Function(""); } catch { allowed = false; } console.log(allowed);`],
    ["Function in a try block", `let allowed = true; try { Function(""); } catch { allowed = false; } console.log(allowed);`],
    ["a constant that holds it, in a try block", `let allowed = true; try { const F = Function; new F(""); } catch { allowed = false; } console.log(allowed);`],
    ["Function('return this')() in a try block", `let found: any; try { found = Function("return this")().Object; } catch {} console.log(found);`],
  ])("leaves the world closed: %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });

  test.each([
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

using probe = tempDir("aot-runtime-use-probe", { "main.ts": `console.log("hello");` });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "main.ts", "--outfile", "main"],
  cwd: String(probe),
  env: bunEnv,
  stdout: "pipe",
  stderr: "pipe",
});

describe.skipIf(probed.exitCode !== 0)("what the writer of the executable finds", () => {
  const made = `
    function made(): string {
      try {
        return "made " + (function () {}).constructor("return 1 + 1")();
      } catch (error) {
        return (error as Error).name;
      }
    }
  `;

  async function said(files: Record<string, string>, entryPoints = ["main.ts"]) {
    using dir = tempDir("aot-runtime-use-writer", { "tsconfig.json": tsconfig, ...files });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "--compile-trim-runtime", ...entryPoints, "--outfile", "main"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
    if (buildExitCode !== 0) return { buildErrors };
    await using proc = Bun.spawn({ cmd: [join(String(dir), "main")], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode };
  }

  test("every module is compiled: the executable runs only its own code", async () => {
    expect(await said({ "main.ts": declared + made + `console.log(made());` })).toEqual({ stdout: "EvalError\n", exitCode: 0 });
  });

  test("a module that is not compiled: the executable goes on making code", async () => {
    const files = { "main.ts": declared + made + `console.log(made());`, "data.json": `{ "a": 1 }` };
    expect(await said(files, ["main.ts", "data.json"])).toEqual({ stdout: "made 2\n", exitCode: 0 });
  });

  test("it runs in place: the executable goes on making code", async () => {
    expect(await said({ "main.ts": declared + made + `console.log(made());` }, ["main.ts", "--compile-in-place"])).toEqual({ stdout: "made 2\n", exitCode: 0 });
  });

  test("the script of a page runs in a browser, not here: the executable runs only its own code", async () => {
    const files = {
      "main.ts": `// @ts-ignore\nimport page from "./index.html";\n` + declared + made + `console.log(typeof page, made());`,
      "index.html": `<html><body><script type="module" src="./client.ts"></script></body></html>`,
      "client.ts": `export {};\n(globalThis as any).ready = 1 + 1;`,
    };
    expect(await said(files)).toEqual({ stdout: "object EvalError\n", exitCode: 0 });
  });
});
