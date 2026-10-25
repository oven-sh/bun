import { describe, expect } from "bun:test";
import { accountsFor, build, closed, completeness, computedModuleName, external, globalObject, notYet, open, retainsFeature, uncompiledModule, unseenCode, type Use } from "./runtime-use-expectations";
import { declared, of, runtimeUse } from "./runtime-use-harness";
import { eachRow, gap, test } from "./supported";

const groups: [name: string, body: () => void][] = [];
const group = (name: string, body: () => void) => void groups.push([name, body]);

const wholeHolders = (use: Use) => use.lines.filter(line => line.endsWith(" (escapes, so any member may be used)"));
const wholeHostHolders = (use: Use) => wholeHolders(use).filter(line => /^(Bun|process|console|performance) /.test(line));

group("built-ins that a program names", () => {
  test("a program that names nothing special is closed", async () => {
    const use = await of(`console.log("hello");`);
    expect(use.lines[0]).toBe(closed.first);
    expect(use.lines.includes("global console")).toBe(true);
    expect(use.lines.includes("global HTMLRewriter")).toBe(false);
    expect(use.exitCode).toBe(0);
  });

  test.each([
    ["a free identifier", `new HTMLRewriter();`],
    ["typeof", `console.log(typeof HTMLRewriter);`],
    ["a property of globalThis", `new (globalThis as any).HTMLRewriter();`],
    ["a property of globalThis in brackets", `new (globalThis as any)["HTMLRewriter"]();`],
    ["a property of self", `declare const self: any; new self.HTMLRewriter();`],
    ["a property of globalThis.globalThis", `new (globalThis as any).globalThis.HTMLRewriter();`],
    ["a destructured global object", `const { HTMLRewriter: Rewriter } = globalThis as any; new Rewriter();`],
    ["a constant that aliases the global object", `const everything: any = globalThis; new everything.HTMLRewriter();`],
    ["the base of a class", `class Mine extends HTMLRewriter {} new Mine();`],
    ["a shorthand property", `console.log({ HTMLRewriter });`],
  ])("a global is named by %s", async (_, text) => {
    const use = await of(text);
    expect({ ...completeness(use), named: use.lines.includes("global HTMLRewriter") }).toEqual({ ...closed, named: true });
  });

  test.each([
    ["a class of the program's own", `export {}; class HTMLRewriter {} new HTMLRewriter();`],
    ["a parameter", `function f(HTMLRewriter: any) { return new HTMLRewriter(); } f(Map);`],
    ["a type", `let rewriter: typeof HTMLRewriter | undefined; console.log(rewriter);`],
    ["a property of another object", `const mine: any = { HTMLRewriter: Map }; new mine.HTMLRewriter();`],
    ["a string", `console.log("HTMLRewriter");`],
  ])("a global is not named by %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared.replace("HTMLRewriter: any, ", "") + (text.includes("typeof HTMLRewriter |") ? "declare const HTMLRewriter: any;\n" : "") + text });
    expect({ first: use.lines[0], named: use.lines.includes("global HTMLRewriter") }).toEqual({ first: closed.first, named: false });
  });

  test.each([
    ["the constructor of its prototype object", "Cookie", `const Class = Bun.CookieMap.prototype.constructor; console.log(new Class("a=1").size);`],
    ["the same through Reflect", "Cookie", `const Class = Reflect.get(Bun.CookieMap, "prototype").constructor; console.log(Reflect.construct(Class, ["a=1"]));`],
    ["the same under a computed key", "Cookie", `const Class = Bun.CookieMap[process.argv[2]].constructor; console.log(new Class("a=1").size);`],
    ["the same of a global", "UrlPattern", `declare const URLPattern: any; const Class = URLPattern.prototype.constructor; console.log(new Class("http://a/b").pathname);`],
  ])("a class of the host is made as %s", async (_, feature, text) => {
    expect(retainsFeature((await of(text)).lines, feature)).toBe(true);
  });

  test("members of Bun and process are listed by name", async () => {
    const use = await runtimeUse({
      "main.ts": `import { file } from "bun";\ndeclare const Bun: any, process: any, console: any;\nconst { write } = Bun;\nconsole.log(Bun.nanoseconds, file, write, process.env.HOME, process["argv"]);`,
    });
    expect(use.lines[0]).toBe(closed.first);
    for (const line of ["Bun nanoseconds", "Bun file", "Bun write", "process env", "process argv"]) expect(use.lines).toContain(line);
    expect(use.lines.includes("Bun build")).toBe(false);
    expect(use.lines.includes("process binding")).toBe(false);
  });

  test("a member that reaches unknown code does not take its holder along", async () => {
    const use = await of(external + `external(Bun.nanoseconds, process.argv);`);
    expect({ ...completeness(use), wholeHolders: wholeHostHolders(use) }).toEqual({ ...closed, wholeHolders: [] });
  });

  eachRow([
    ["a member of Bun", `Bun.plugin({ name: "a", setup() {} });`],
    ["an import from bun", `import { plugin } from "bun";\nplugin({ name: "a", setup() {} });`],
    ["a constant that aliases the function", `const register = Bun.plugin;\nregister({ name: "a", setup() {} });`],
  ])("Bun.plugin may bring code that isn't in the executable, so a call of it opens the report: %s", async (_, text) => {
    const use = await of(text);
    expect({ ...completeness(use), named: use.lines.includes("Bun plugin") }).toEqual({ ...open(unseenCode("Bun.plugin")), named: true });
  });

  test("Bun.plugin beside an import() of a computed name: the import opens the report", async () => {
    const use = await of(`Bun.plugin({ name: "a", setup() {} });\nconst name: string = process.argv[2]; import(name);`);
    expect({ ...completeness(use), named: use.lines.includes("Bun plugin") }).toEqual({ ...open(computedModuleName), named: true });
  });

  test("console is followed through an array: the report is closed, and only the member that is called counts", async () => {
    const use = await of(`const logger = [console]; logger[0].log(1);`);
    expect(use.lines[0]).toBe(closed.first);
    expect(use.lines.filter(line => line.startsWith("console "))).toEqual(["console log"]);
  });

  test("a built-in module, and the native code it binds", async () => {
    const isBinding = (line: string) => /^native \S*JSSQLStatement\.cpp:createJSSQLStatementConstructor$/.test(line);
    const without = await of(`console.log(1);`);
    const use = await runtimeUse({ "main.ts": `import { Database } from "bun:sqlite";\ndeclare const console: any;\nconsole.log(new Database(":memory:").query("select 1").get());` });
    expect(use.lines[0]).toBe(closed.first);
    expect(use.lines).toContain("module bun:sqlite");
    expect(use.lines.some(isBinding)).toBe(true);
    expect(without.lines.includes("module bun:sqlite")).toBe(false);
    expect(without.lines.some(isBinding)).toBe(false);
  });

  test("what a built-in module names counts where the program reaches it", async () => {
    const without = await of(`console.log(1);`);
    const use = await runtimeUse({ "main.ts": `import { createServer } from "node:http";\ncreateServer(() => {}).listen(0);` });
    expect(use.lines[0]).toBe(closed.first);
    expect(use.lines).toContain("module node:http");
    expect(use.lines).toContain("Bun serve");
    expect(without.lines.includes("Bun serve")).toBe(false);
  });

  test.each([
    ["typeof globalThis.x", `console.log(typeof (globalThis as any).navigator);`],
    ["a default for a missing global", `console.log((globalThis as any).crypto ?? null);`],
    ["a comparison with undefined", `console.log((globalThis as any).navigator !== undefined);`],
    ["in", `console.log("navigator" in globalThis);`],
    ["typeof globalThis", `console.log(typeof globalThis !== "undefined");`],
    ["require.main === module", `console.log(require.main === module);`],
    ["a value stored on the global object", `(globalThis as any).mine = { count: 1 }; console.log((globalThis as any).mine.count);`],
    ["a native function called on the global object", `console.log((globalThis as any).structuredClone(1));`],
    ["process out of the global object", `const { process: found } = globalThis as any; console.log(found?.versions?.node);`],
    ["a type", `let scope: typeof globalThis | undefined; console.log(scope);`],
    ["members of process, destructured out of the global object, read and called", `const { process: taken } = globalThis as any; taken.title = "a"; console.log(taken.cwd(), taken.pid);`],
    ["a built-in module's export, stored on the global object under its own name", `import { Buffer } from "node:buffer"; (globalThis as any).Buffer = Buffer; console.log(Buffer.from("a").length);`],
    ["process.getBuiltinModule of a literal", `console.log(typeof process.getBuiltinModule("node:fs").readFileSync);`],
  ])("a feature test leaves the report closed: %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});

group("code from strings", () => {
  eachRow([
    gap(notYet.directEvalIsNotNamed, ["a direct eval", `eval(process.argv[2]);`, "eval: the program calls eval() or new Function() (eval)"]),
    ["an indirect eval", `(0, eval)(process.argv[2]);`, "eval: the program calls eval() or new Function() (eval)"],
    ["eval in brackets", `(globalThis as any)["eval"](process.argv[2]);`, "eval: the program calls eval() or new Function() (eval)"],
    ["eval that a timer calls", `declare const setTimeout: any; setTimeout(eval, 0, process.argv[2]);`, "eval: the program calls eval() or new Function() (eval)"],
    ["the Function constructor", `new Function(process.argv[2])();`, "eval: the program calls eval() or new Function() (Function)"],
    ["a call to Function", `console.log(Function(process.argv[2])());`, "eval: the program calls eval() or new Function() (Function)"],
    ["a call to Function whose result is called and read", `console.log(Function(process.argv[2])().Object);`, "eval: the program calls eval() or new Function() (Function)"],
    ["Function as a callback", `console.log([process.argv[2]].map(Function as any));`, "eval: the program calls eval() or new Function() (Function)"],
    ["the constructor of Function.prototype", `console.log(Function.prototype.constructor(process.argv[2])());`, "eval: the program calls eval() or new Function() (Function)"],
    ["the constructor of Function.prototype in brackets", `console.log((Function.prototype as any)["constructor"](process.argv[2])());`, "eval: the program calls eval() or new Function() (Function)"],
    ["new Function in a try block", `let allowed = true; try { new Function(process.argv[2]); } catch { allowed = false; } console.log(allowed);`, "eval: the program calls eval() or new Function() (Function)"],
    ["Function in a try block", `let allowed = true; try { Function(process.argv[2]); } catch { allowed = false; } console.log(allowed);`, "eval: the program calls eval() or new Function() (Function)"],
    ["a constant that aliases Function, in a try block", `let allowed = true; try { const F = Function; new F(process.argv[2]); } catch { allowed = false; } console.log(allowed);`, "eval: the program calls eval() or new Function() (Function)"],
    ["a call to Function whose result is called and read, in a try block", `let found: any; try { found = Function(process.argv[2])().Map; } catch {} console.log(found);`, "eval: the program calls eval() or new Function() (Function)"],
    ["new Function in a try block without a handler", `try { new Function(process.argv[2]); } finally { console.log(1); }`, "eval: the program calls eval() or new Function() (Function)"],
    ["new Function in a handler", `try { console.log(1); } catch { new Function(process.argv[2]); }`, "eval: the program calls eval() or new Function() (Function)"],
    ["new Function in a closure that reaches unknown code", external + `try { const later = () => new Function(process.argv[2]); external(later); } catch {}`, "eval: the program calls eval() or new Function() (Function)"],
    ["an alias of Function that is also stored", `let F: any; try { const G = Function; F = G; new G(process.argv[2]); } catch {} console.log(F);`, "eval: the program calls eval() or new Function() (Function)"],
  ])("the report is open with %s", async (_, text, why) => {
    const use = await of(text);
    expect(completeness(use).whyOpen).toContain(why);
    expect(retainsFeature(use.lines, "Interpreter")).toBe(true);
  });

  test.each([
    ["the Function constructor", `console.log(new Function("return 1")());`],
    ["a call to Function", `console.log(Function("a", "return a * 2")(4));`],
    ["an indirect eval", `console.log((0, eval)("1 + 1"));`],
  ])("text that is a constant is compiled with the program, so the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });

  // TODO: the call is not seen: the report is closed, and the executable throws an EvalError that says so.
  test.todo("the report is open with a member of Function.prototype under a computed key, which may be its constructor", async () => {
    expect((await of(`console.log((Function.prototype as any)[process.argv[2]]("return 1")());`)).whyOpen).not.toEqual([]);
  });

  const input = `declare const input: any;\n`;
  // What has been through native memory is a value nobody knows.
  const unknownFunction = `declare const CustomEvent: any;\nfunction mine() {}\nconst unknown: any = new CustomEvent("x", { detail: mine }).detail;\n`;

  test.each([
    ["the constructor of an unknown value", unknownFunction + `console.log(unknown.constructor("return 1"));`],
    ["a computed name, read from an unknown value and called", `console.log(input[process.argv[2]]("return 1"));`],
    ["a computed name, read from a function and called", `function mine() {}\nconsole.log((mine as any)[process.argv[2]]("return 1"));`],
  ])("%s leaves the report closed and keeps the interpreter: Function may be found that way", async (_, text) => {
    const use = await of(input + text);
    expect({ ...completeness(use), allowed: retainsFeature(use.lines, "Interpreter") }).toEqual({ ...closed, allowed: true });
  });

  test.each([
    // It prints `[class Function]`.
    ["a computed name, read from a function and only printed", `function mine() {}\nconsole.log((mine as any)[process.argv[2]]);`],
    // The read throws a ReferenceError, so the call is never reached.
    ["the constructor of a global that nothing defines", `console.log(input.constructor("return 1"));`],
  ])("%s leaves the report closed and keeps no interpreter: nothing calls Function", async (_, text) => {
    const use = await of(input + text);
    expect({ ...completeness(use), allowed: retainsFeature(use.lines, "Interpreter") }).toEqual({ ...closed, allowed: false });
  });

  test("code from strings is allowed unless the build says --disallow-code-generation-from-strings", async () => {
    const files = { "main.ts": declared + `console.log(eval(process.argv[2]));` };
    const [byDefault, withFlag] = await Promise.all([runtimeUse(files), runtimeUse(files, ["check", "--aot", "--no-pretty", "--disallow-code-generation-from-strings"])]);
    expect({ byDefault: retainsFeature(byDefault.lines, "Interpreter"), withFlag: retainsFeature(withFlag.lines, "Interpreter") }).toEqual({ byDefault: true, withFlag: false });
  });
});

group("modules that are named at run time", () => {
  test.each([
    ["import() of a computed name", `const name: string = process.argv[2]; import(name);`],
    ["import() of a computed path", `const name: string = process.argv[2]; import("./" + name);`],
    ["require of a computed name", `console.log(require(process.argv[2]));`],
    ["node:module out of process.getBuiltinModule", `console.log(process.getBuiltinModule("node:module").createRequire((import.meta as any).url)("late-package"));`],
    ["node:module out of process.getBuiltinModule in a function that is called", `function load() { return process.getBuiltinModule("node:module").createRequire((import.meta as any).url)("late-package"); }\nconsole.log(load());`],
    ["process.getBuiltinModule of a computed name", `console.log(process.getBuiltinModule(process.argv[2]));`],
  ])("the report is open with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(open(computedModuleName));
  });

  test.each([
    ["require as a value", `console.log([require].length);`],
    ["require.cache", `console.log(require.cache);`],
    ["process.mainModule", `console.log(process.mainModule);`],
    ["the names of the members of process", `console.log(Object.keys(process));`],
  ])("nothing is loaded, so the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });

  const asks = `process.getBuiltinModule("node:module").createRequire((import.meta as any).url)("late-package")`;

  test.each([
    ["a function that nothing calls", { "main.ts": declared + `function never() { return ${asks}; }\nconsole.log(1);` }],
    ["an export that nothing imports", { "main.ts": declared + `import { used } from "./other";\nconsole.log(used());`, "other.ts": `declare const process: any;\nexport function used() { return 1; }\nexport function never() { return ${asks}; }` }],
  ])("createRequire in %s leaves the report closed", async (_, files) => {
    expect(completeness(await runtimeUse(files))).toEqual(closed);
  });

  test("the arguments of the function around a CommonJS file hold require and module", async () => {
    const use = await runtimeUse({ "main.cjs": `console.log(arguments[1](process.argv[2]));` }, undefined, "main.cjs");
    expect(completeness(use)).toEqual(open(computedModuleName));
  });

  test("the arguments of a function in a CommonJS file do not", async () => {
    const use = await runtimeUse({ "main.cjs": `function count() { return arguments.length; }\nconsole.log(String(count(1)));` }, undefined, "main.cjs");
    expect(completeness(use)).toEqual(closed);
  });
});

group("modules that are not in the executable", () => {
  test.each([
    ["require of an external package", `try { console.log(require("late-package")); } catch {}`],
    ["require whose result is not used", `try { require("late-package"); } catch {}`],
    ["require outside a try block", `console.log(require("late-package"));`],
    ["import()", `// @ts-ignore\ntry { console.log(await import("late-package")); } catch {}\nexport {};`],
    ["an import declaration", `// @ts-ignore\nimport late from "late-package";\nconsole.log(late);`],
  ])("the report is open with %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared + text }, [...build, "--external", "late-package"]);
    expect({ ...completeness(use), exitCode: use.exitCode }).toEqual({ ...open(uncompiledModule), exitCode: 0 });
  });

  test.each([
    ["import() of a URL", `try { await import("http://127.0.0.1:1/x.js"); } catch {}\nexport {};`],
  ])("the report is open with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(open(uncompiledModule));
  });

  test("an external package in a function that nothing calls leaves the report closed", async () => {
    const use = await runtimeUse({ "main.ts": declared + `function never() { return require("late-package"); }\nconsole.log(1);` }, [...build, "--external", "late-package"]);
    expect(completeness(use)).toEqual(closed);
  });

  test.each([
    ["require in a try block", { "main.ts": declared + `try { console.log(require("late-package")); } catch {}` }],
    ["require outside a try block", { "main.ts": declared + `console.log(require("late-package"));` }],
    ["require of a file", { "main.ts": declared + `try { console.log(require("./late-file.js")); } catch {}` }],
    ["import()", { "main.ts": declared + `// @ts-ignore\ntry { console.log(await import("late-package")); } catch {}\nexport {};` }],
  ])("a module that the build does not find throws where it is loaded, so the report stays closed: %s", async (_, files) => {
    const use = await runtimeUse(files);
    expect({ ...completeness(use), exitCode: use.exitCode }).toEqual({ ...closed, exitCode: 0 });
  });

  eachRow([
    ["a built-in module that is required", { "main.ts": declared + `console.log(typeof require("node:path").join, typeof require("path").join);` }],
    gap(notYet.globalObject, ["built-in modules without a prefix", { "main.ts": declared + `console.log(typeof require("sys"), typeof require("punycode"), typeof require("_http_server"), typeof require("stream/promises"));` }]),
    gap(notYet.globalObject, ["packages that Bun implements itself where they are not installed", { "main.ts": declared + `try { console.log(typeof require("node-fetch"), typeof require("abort-controller"), typeof require("isomorphic-fetch"), typeof require("@vercel/fetch"), typeof require("undici")); } catch {}` }]),
    ["import() of a built-in module", { "main.ts": declared + `console.log(typeof (await import("node:path")).join);\nexport {};` }],
    ["import() of a file of the program", { "main.ts": declared + `console.log((await import("./own")).a);\nexport {};`, "own.ts": `export const a = 1;` }],
  ])("%s leaves the report closed", async (_, files) => {
    expect(completeness(await runtimeUse(files))).toEqual(closed);
  });

  test.each([
    ["names", `// @ts-ignore\nimport { __legacyDecorateClassTS, __legacyMetadataTS } from "bun:wrap";\nconsole.log(typeof __legacyDecorateClassTS, typeof __legacyMetadataTS);`],
    ["the namespace", `// @ts-ignore\nimport * as helpers from "bun:wrap";\nconsole.log(helpers);`],
    ["a re-export", `// @ts-ignore\nexport { __legacyDecorateClassTS } from "bun:wrap";`],
    ["export *", `// @ts-ignore\nexport * from "bun:wrap";`],
    ["import()", `// @ts-ignore\nconsole.log(await import("bun:wrap"));\nexport {};`],
    ["require", `console.log(require("bun:wrap"));`],
  ])("bun:wrap, which holds the helpers for decorators, is compiled with the program: %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});

group("the global object", () => {
  const listener = `function (this: any) { console.log(this); }`;
  const me = `function (this: any) { return this; }`;
  const events = `declare const dispatchEvent: any, Event: any;\n`;

  test.each([
    ["a computed property of the global object", `console.log((globalThis as any)[process.argv[2]]);`],
    ["a computed property of globalThis.self", `console.log((globalThis as any).self[process.argv[2]]);`],
    ["an accessor on the global object", `Object.defineProperty(globalThis, "mine", { get() { return this; } }); console.log((globalThis as any).mine);`],
    ["an accessor under a constant name", `const name = "mine"; Object.defineProperty(globalThis, name, { get() { return this; } }); console.log((globalThis as any).mine);`],
    ["an accessor that the descriptor inherits", `Object.defineProperty(globalThis, "mine", { __proto__: { get(this: any) { return this; } } } as any); console.log((globalThis as any).mine);`],
    ["a function that the descriptor inherits", `Object.defineProperty(globalThis, "mine", { __proto__: { value: ${me} } } as any); console.log((globalThis as any).mine());`],
    ["a function defined on globalThis.self", `Object.defineProperty((globalThis as any).self, "mine", { value: ${me} }); console.log((globalThis as any).mine());`],
    ["a function defined on self", `declare const self: any; Object.defineProperty(self, "mine", { value: ${me} }); console.log(self.mine());`],
    ["a method defined on the global object that passes its receiver to super", `Object.defineProperty(globalThis, "mine", { value() { return super.valueOf(); } }); console.log((globalThis as any).mine());`],
    ["a function of the program's own, called on the global object", `(globalThis as any).mine = ${me}; console.log((globalThis as any).mine());`],
    ["a built-in module's function, stored on the global object and called there", `import EventEmitter from "node:events"; (globalThis as any).mine = EventEmitter; (globalThis as any).mine({ captureRejections: true });`],
    ["a built-in module's function by its name, through a constant and a conditional", `import { EventEmitter } from "node:events"; const alias = EventEmitter; (globalThis as any).mine = process.argv[2] ? alias : null; (globalThis as any).mine({ captureRejections: true });`],
    ["a built-in module's function, defined on the global object and called there", `import Stream from "node:stream"; Object.defineProperty(globalThis, "mine", { value: Stream }); (globalThis as any).mine({ captureRejections: true });`],
    ["valueOf() of the global object, read by a computed name", `console.log((globalThis as any).valueOf()[process.argv[2]]);`],
    ["valueOf() in brackets", `console.log((globalThis as any)["valueOf"]()[process.argv[2]]);`],
    ["valueOf() of the global object that reaches unknown code", external + `external((globalThis as any).valueOf());`],
    ["a listener on the global object", `addEventListener("error", ${listener});`],
    ["a listener on an alias of the global object", `const alias: any = globalThis;\nalias.addEventListener("error", ${listener});`],
    ["addEventListener destructured out of the global object", `const { addEventListener: listen } = globalThis as any;\nlisten("popstate", ${listener});`],
    ["a listener for an event that the program dispatches", events + `addEventListener("mine", ${listener}); dispatchEvent(new Event("mine"));`],
  ])("any global may be used with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(open(globalObject));
  });

  test.each([
    ["the names of the globals", `console.log(Object.keys(globalThis));`],
    ["in, with a computed name", `console.log(process.argv[2] in globalThis);`],
    ["delete, with a computed name", `delete (globalThis as any)[process.argv[2]];`],
    ["the descriptor of process", `console.log(typeof Object.getOwnPropertyDescriptor(globalThis, "process")!.value.report);`],
    ["a value defined on the global object", `Object.defineProperty(globalThis, "mine", { value: 1 }); console.log((globalThis as any).mine);`],
    ["a value defined under a computed name", `let name = "mine"; name = process.argv[2]; Object.defineProperty(globalThis, name, { value: 1 });`],
  ])("names are asked for and no member is used, so the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });

  test.each([
    ["the descriptor of a property", `console.log(Object.getOwnPropertyDescriptor(globalThis, "navigator"));`, "global navigator"],
    ["the descriptor of Bun", `console.log(Object.getOwnPropertyDescriptor(globalThis, "Bun")!.value.color("red", "hex"));`, "Bun color"],
  ])("what a descriptor hands out is followed: %s", async (_, text, item) => {
    expect(accountsFor(await of(text), item)).toBe(true);
  });

  test("what valueOf() returns is followed like the object", async () => {
    const use = await of(`console.log(typeof (globalThis as any).valueOf().HTMLRewriter, process.valueOf().title);`);
    expect({ global: accountsFor(use, "global HTMLRewriter"), process: accountsFor(use, "process title") }).toEqual({ global: true, process: true });
  });

  // TODO: the report does not list the global.
  test.todo("the getter of another member counts as a use of the member", async () => {
    expect(accountsFor(await of(`console.log((globalThis as any).__lookupGetter__("HTMLRewriter"));`), "global HTMLRewriter")).toBe(true);
  });

  test.each([
    ["after a type assertion", `console.log((globalThis as any).process.title);`],
    ["in brackets", `console.log((globalThis as any)["process"].title);`],
  ])("process as a member of the global object names what is read of it, %s", async (_, text) => {
    const use = await of(text);
    expect(completeness(use)).toEqual(closed);
    expect(use.lines).toContain("process title");
  });
});

group("this in a sloppy function", () => {
  const main = `import lib from "./lib.cjs";\ndeclare const console: any;\nconsole.log(lib());`;

  test.each([
    ["is returned", `module.exports = function () { return this; };`],
    ["is passed on", `function f(x) { return x; } module.exports = function () { return f(this); };`],
    ["gets a function by Object.defineProperty", `module.exports = function () { Object.defineProperty(this, "mine", { value: function () { "use strict"; return this; }, writable: true, configurable: true, enumerable: true }); return this.mine(); };`],
    ["gets a function by Object.defineProperty that other code calls", `(function () { Object.defineProperty(this, "mine", { value: function () { "use strict"; return this; } }); })();\nmodule.exports = () => globalThis.mine();`],
    ["is passed to what super finds", `module.exports = { me() { return super.valueOf(); } }.me;`],
    ["is passed to what super finds in an arrow function", `module.exports = { me() { return (() => super.valueOf())(); } }.me;`],
  ])("may be the global object: the report is open when it %s", async (_, lib) => {
    expect(completeness(await runtimeUse({ "main.ts": main, "lib.cjs": lib }))).toEqual(open(globalObject));
  });

  test("counts as a use of what it reads by literal names", async () => {
    const use = await runtimeUse({ "main.ts": main, "lib.cjs": `module.exports = function () { return new this.HTMLRewriter(); };` });
    expect(accountsFor(use, "global HTMLRewriter")).toBe(true);
  });

  test.each([
    ["the file is strict", `"use strict"; module.exports = function () { return this; };`],
    ["it is in a method of a class", `module.exports = () => new (class { me() { return this; } })().me();`],
    ["it is at the top of the file", `const top = this; module.exports = () => top;`],
    ["super is in a method of a class, which is strict", `module.exports = () => new (class extends Object { me() { return super.valueOf(); } })().me();`],
  ])("the report stays closed when %s", async (_, lib) => {
    expect(completeness(await runtimeUse({ "main.ts": main, "lib.cjs": lib }))).toEqual(closed);
  });

  test("the report stays closed in an ECMAScript module", async () => {
    const use = await runtimeUse({ "main.ts": main.replace("lib.cjs", "lib.mjs"), "lib.mjs": `export default function () { return this; }` });
    expect(completeness(use)).toEqual(closed);
  });
});

group("Bun, process and other holders", () => {
  const me = `function (this: any) { return this; }`;

  eachRow([
    gap(notYet.globalObjectForHolder, ["a built-in module's function, stored on Bun and called there", `import EventEmitter from "node:events"; Bun.mine = EventEmitter; Bun.mine({ captureRejections: true });`]),
    gap(notYet.globalObjectForHolder, ["a function stored on Bun under a var that is read before its initializer", `function early() { (Bun as any)[key] = ${me}; }\nearly();\nvar key = "mine";\nconsole.log((Bun as any).undefined());`]),
    gap(notYet.globalObjectForHolder, ["a function defined on process under a var that is read before its initializer", `function early() { Object.defineProperty(process, key, { value: ${me} }); }\nearly();\nvar key = "mine";\nconsole.log((process as any).undefined());`]),
    gap(notYet.globalObjectForHolder, ["a function defined on process, destructured out of the global object", `const { process: taken } = globalThis as any; Object.defineProperty(taken, "mine", { value: ${me} }); console.log(taken.mine());`]),
    gap(notYet.globalObjectForHolder, ["a function stored on process, destructured out of the global object, and called there", `const { process: taken } = globalThis as any; taken.mine = ${me}; console.log(taken.mine());`]),
    gap(notYet.globalObjectForHolder, ["a function stored on process by name and called on what a pattern took out of the global object", `process.mine = ${me}; const { process: taken } = globalThis as any; console.log(taken.mine());`]),
    gap(notYet.globalObjectForHolder, ["a method defined on process that passes its receiver to super", `Object.defineProperty(process, "mine", { value() { return super.valueOf(); } }); console.log(process.mine());`]),
  ])("any member of Bun or process may be used with %s", async (_, text) => {
    expect(completeness(await of(text)).escaped.filter(holder => holder !== "globalThis")).not.toEqual([]);
  });

  eachRow([
    gap(notYet.globalObject, ["a computed member of process", `console.log(process[process.argv[2]]);`, "process (escapes, so any member may be used)"]),
    gap(notYet.globalObject, ["in, of process", `console.log(process.argv[2] in process);`, "process (escapes, so any member may be used)"]),
    gap(notYet.globalObject, ["in, of console", `console.log(process.argv[2] in console);`, "console (escapes, so any member may be used)"]),
    ["a function defined on console", `Object.defineProperty(console, "mine", { value: ${me} }); console.log(console.mine());`, "console (escapes, so any member may be used)"],
    ["Math as an import of a WebAssembly module, whose bytes name the members", `declare const WebAssembly: any, input: any;\nconsole.log(await WebAssembly.instantiate(input.bytes, { j: Math }));\nexport {};`, "Math (escapes, so any member may be used)"],
  ])("%s leaves the report closed, and any member of the holder may be used", async (_, text, wholeHolder) => {
    const use = await of(text);
    expect(completeness(use)).toEqual(closed);
    expect(wholeHolders(use)).toContain(wholeHolder);
  });

  test.each([
    ["its own", `console.log(performance.now());`],
    ["on Performance.prototype", `console.log(performance.timeOrigin);`],
    ["inherited from EventTarget.prototype", `performance.dispatchEvent(new Event("a"));`],
  ])("a member of performance that is %s is listed by name", async (_, text) => {
    const use = await of(`declare const performance: any, Event: any;\n` + text);
    expect({ ...completeness(use), wholeHolders: wholeHostHolders(use) }).toEqual({ ...closed, wholeHolders: [] });
  });

  test("the built-in modules that the members of process load are compiled in", async () => {
    const modules = (use: Use) => use.lines.filter(line => line.startsWith("module "));
    const [without, named, every] = await Promise.all([of(`console.log(1);`), of(`console.log(typeof process.stdin);`), of(`console.log(typeof process[process.argv[2]]);`)]);
    expect(modules(named).length).toBeGreaterThan(modules(without).length);
    expect(modules(every)).toEqual(expect.arrayContaining(modules(named)));
  });

  eachRow([
    ["the global object", `delete (globalThis as any).fetch;`],
    ["the global object, in brackets", `delete (globalThis as any)["fetch"];`],
    ["the global object, in an optional chain", `delete (globalThis as any)?.fetch;`],
    ["an alias of the global object", `const scope: any = globalThis; delete scope.fetch;`],
    ["Bun", `delete Bun.color;`],
    gap(notYet.globalObject, ["console", `delete console.table;`]),
    gap(notYet.globalObject, ["process", `delete process.title;`]),
    gap(notYet.globalObject, ["globalThis.process", `delete (globalThis as any).process.title;`]),
    gap(notYet.globalObject, ["globalThis.process, in brackets", `delete (globalThis as any)["process"].title;`]),
    gap(notYet.globalObject, ["process of an alias of the global object", `const scope: any = globalThis; delete scope.process.title;`]),
    gap(notYet.globalObject, ["an alias of process", `const alias: any = process; delete alias.title;`]),
    gap(notYet.globalObject, ["process, destructured out of the global object", `const { process: taken } = globalThis as any; delete taken.title;`]),
    ["a member of a member", `delete process.env.HOME;`],
    ["an object of the program's own", `const mine: any = { fetch: 1, title: 2 }; delete mine.fetch; delete mine.title;`],
    ["a variable of the program's own with the name of a holder", `function f(process: any) { delete process.title; } f({});`],
  ])("delete of a member of %s is no use of the other members", async (_, text) => {
    const use = await of(text);
    expect({ ...completeness(use), wholeHolders: wholeHostHolders(use) }).toEqual({ ...closed, wholeHolders: [] });
  });

  test.each([
    ["a literal in the global object", `console.log("HTMLRewriter" in globalThis);`],
    ["a literal in an alias of the global object", `const scope: any = globalThis; console.log("HTMLRewriter" in scope);`],
    ["a literal in process", `console.log("binding" in process);`],
    ["a literal in globalThis.process", `console.log("binding" in (globalThis as any).process);`],
    ["a literal in Bun", `console.log("Transpiler" in Bun);`],
    ["in, for what evaluates text or loads code", `console.log("Worker" in globalThis, "eval" in globalThis, "Function" in globalThis, "getBuiltinModule" in process, "addEventListener" in globalThis);`],
    ["members that are read", `console.log(process.title, typeof (globalThis as any).fetch, typeof Bun.color, void process.title);`],
    ["questions about an object of the program's own", `const mine: any = { a: 1 }; console.log(process.argv[2] in mine, mine.hasOwnProperty(process.argv[2]), mine.valueOf());`],
  ])("%s is no use of the other members", async (_, text) => {
    const use = await of(text);
    expect({ ...completeness(use), wholeHolders: wholeHostHolders(use) }).toEqual({ ...closed, wholeHolders: [] });
  });

  test.each([
    ["a literal that is in the table", `console.log(process.binding("buffer").kStringMaxLength);`],
    ["a literal that throws", `try { process.binding("zlib"); } catch {}`],
    ["a literal that is not in the table", `try { process.binding("mine"); } catch {}`],
    ["an alias of process", `const same = process;\nconsole.log(same.binding("uv").errname(-2));`],
    ["an optional call", `console.log(process.binding?.("config").bits);`],
    ["a computed name", `console.log(process.binding(process.argv[2]));`],
    ["spread arguments", `console.log(process.binding(...["fs"]));`],
    ["a pattern", `const { binding } = process;\nconsole.log(binding("fs"));`],
    ["an alias", `const binding = process.binding;\nconsole.log(binding("fs"));`],
    ["an import", `import { binding } from "node:process";\nconsole.log(binding("fs"));`],
  ])("process.binding returns one of a closed table of native objects, so it is a member like any other: %s", async (_, text) => {
    const use = await of(text);
    expect({ ...completeness(use), named: use.lines.includes("process binding") }).toEqual({ ...closed, named: true });
  });
});

group("parts of Bun that run code the compiler does not see", () => {
  eachRow([
    ["process.dlopen", `process.dlopen({ exports: {} }, "./addon.node");`, "process.dlopen"],
    ["process.dlopen of an alias of the global object", `const everything: any = globalThis;\neverything.process.dlopen({ exports: {} }, "./addon.node");`, "process.dlopen"],
    ["process.dlopen out of a pattern", `const { dlopen } = process;\ndlopen({ exports: {} }, "./addon.node");`, "process.dlopen"],
    ["process.dlopen that Reflect.apply calls", `Reflect.apply(process.dlopen, process, [{ exports: {} }, "./addon.node"]);`, "process.dlopen"],
    ["process.dlopen that call() calls", `process.dlopen.call(process, { exports: {} }, "./addon.node");`, "process.dlopen"],
    ["process.dlopen as a callback", `[{ exports: {} }].forEach(process.dlopen);`, "process.dlopen"],
    ["process.dlopen that bind() binds", `process.dlopen.bind(process)({ exports: {} }, "./addon.node");`, "process.dlopen"],
    ["process.dlopen that is bound first and called later", `const load = process.dlopen.bind(process);\nload({ exports: {} }, "./addon.node");`, "process.dlopen"],
    ["process.dlopen that is bound twice", `process.dlopen.bind(process).bind(null)({ exports: {} }, "./addon.node");`, "process.dlopen"],
    ["process.dlopen that is bound and passed as a callback", `[{ exports: {} }].forEach(process.dlopen.bind(process));`, "process.dlopen"],
    ["cc of bun:ffi, which compiles C", `import { cc } from "bun:ffi";\nconsole.log(cc({ source: "./a.c", symbols: {} }));`, "bun:ffi.cc"],
    ["dlopen of bun:ffi", `import { dlopen } from "bun:ffi";\nconsole.log(dlopen("libc.so.6", {}));`, "bun:ffi.dlopen"],
    ["dlopen of what require gives for bun:ffi", `console.log(require("bun:ffi").dlopen("libc.so.6", {}));`, "bun:ffi.dlopen"],
    ["linkSymbols of bun:ffi", `import { linkSymbols } from "bun:ffi";\nconsole.log(linkSymbols({}));`, "bun:ffi.linkSymbols"],
    ["CFunction of bun:ffi", `import { CFunction } from "bun:ffi";\nconsole.log(CFunction({ ptr: 0 as any }));`, "bun:ffi.CFunction"],
  ])("the report is open with %s", async (_, text, builtin) => {
    expect(completeness(await of(text))).toEqual(open(unseenCode(builtin)));
  });

  // A Worker has a global of its own and starts with an entry point of the build, and the report holds what every entry point uses.
  test("the report stays closed with a Worker", async () => {
    expect(completeness(await of(`new Worker("./other.ts");`))).toEqual(closed);
  });

  eachRow([
    ["the type of Worker", `console.log(typeof Worker);`],
    gap(notYet.globalObject, ["node:worker_threads", `import { isMainThread } from "node:worker_threads"; console.log(isMainThread);`]),
    ["node:vm", `import vm from "node:vm"; console.log(vm);`],
    ["node:vm beside node:module in a function that nothing calls", `import vm from "node:vm";\nfunction never() { return process.getBuiltinModule("node:module"); }\nconsole.log(vm);`],
    gap(notYet.globalObject, ["node:inspector", `import { Session } from "node:inspector";\nconsole.log(Session);`]),
    ["bun:jsc, which returns objects of the heap", `import { getProtectedObjects } from "bun:jsc";\nconsole.log(getProtectedObjects);`],
    ["an import of bun:ffi", `import { dlopen } from "bun:ffi";\nconsole.log(dlopen);`],
    ["a require of bun:ffi", `console.log(require("bun:ffi"));`],
    ["import() of bun:ffi", `console.log(await import("bun:ffi"));\nexport {};`],
    ["Bun.FFI", `console.log(Bun.FFI);`],
    ["the type of process.dlopen", `console.log(typeof process.dlopen);`],
    ["process.dlopen in a pattern", `const { dlopen } = process;\nconsole.log(dlopen);`],
    ["process.dlopen as an import", `import { dlopen } from "node:process";\nconsole.log(dlopen);`],
    ["process.dlopen that is bound and never called", `console.log(typeof process.dlopen.bind(process));`],
    ["cc of bun:ffi, printed", `import { cc } from "bun:ffi";\nconsole.log(cc);`],
    ["ptr of bun:ffi, which loads nothing", `import { ptr } from "bun:ffi";\nconsole.log(ptr(new Uint8Array(8)) > 0);`],
  ])("only a call opens the report: it stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });

  test.each([
    ["is required", `console.log(require("./hello.node"));`],
    ["is imported", `// @ts-ignore\nimport addon from "./hello.node";\nconsole.log(addon);`],
    ["is loaded by import()", `// @ts-ignore\nconsole.log(await import("./hello.node"));\nexport {};`],
    ["has another extension and is imported with the type napi", `// @ts-ignore\nimport addon from "./hello.bin" with { type: "napi" };\nconsole.log(addon);`],
  ])("the report is open with a native addon that %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared + text, "hello.node": "no addon", "hello.bin": "no addon" });
    expect(completeness(use)).toEqual(open(unseenCode("process.dlopen")));
  });

  test("only a call that the program reaches opens the report: it stays closed with a native addon that is required in a function that nothing calls", async () => {
    const use = await runtimeUse({ "main.ts": declared + `function never() { return require("./hello.node"); }\nconsole.log(1);`, "hello.node": "no addon" });
    expect(completeness(use)).toEqual(closed);
  });

  eachRow([
    gap(notYet.moduleGraphBlocksNothing, ["Bun.ModuleGraph", `console.log(await new Bun.ModuleGraph().import(process.argv[2]));\nexport {};`]),
    gap(notYet.moduleGraphBlocksNothing, ["Bun.ModuleGraph as an import", `import { ModuleGraph } from "bun";\nconsole.log(new ModuleGraph());`]),
    gap(notYet.moduleGraphBlocksNothing, ["Bun.ModuleGraph in a pattern", `const { ModuleGraph } = Bun;\nconsole.log(new ModuleGraph());`]),
  ])("the report is open with %s, which loads modules by a run-time name", async (_, text) => {
    expect(completeness(await of(text))).toEqual(open(computedModuleName));
  });

  eachRow([
    ["Bun.build", `console.log(await Bun.build({ entrypoints: [process.argv[2]] }));\nexport {};`, "Bun build"],
    ["build as an import from bun", `import { build } from "bun";\nconsole.log(await build({ entrypoints: [process.argv[2]] }));`, "Bun build"],
    ["an alias of Bun.build", `const build = Bun.build;\nconsole.log(await build({ entrypoints: [process.argv[2]] }));\nexport {};`, "Bun build"],
  ])("%s runs plugins and macros, which aren't in the executable: it is listed, and a call of it opens the report", async (_, text, line) => {
    const use = await of(text);
    expect({ ...completeness(use), listed: use.lines.includes(line) }).toEqual({ ...open(unseenCode("Bun.build")), listed: true });
  });

  test.each([
    ["transformSync", `console.log(new Bun.Transpiler().transformSync(process.argv[2]));`],
    ["scan", `console.log(new Bun.Transpiler().scan(process.argv[2]));`],
  ])("Bun.Transpiler runs the macros of the text it is given among the program's own objects: it is listed and the report is open: %s", async (_, text) => {
    const use = await of(text);
    expect({ ...completeness(use), listed: use.lines.includes("Bun Transpiler") }).toEqual({ ...open(unseenCode("Bun.Transpiler")), listed: true });
  });

  test.each([
    ["process.dlopen in a function that nothing calls", `function never() { process.dlopen({ exports: {} }, "./addon.node"); }\nconsole.log(1);`],
    ["Bun.Transpiler in a function that nothing calls", `function never() { return new Bun.Transpiler(); }\nconsole.log(1);`],
    ["a Worker in a function that nothing calls", `function never() { return new Worker("./other.ts"); }\nconsole.log(1);`],
    ["Bun.build in a function that nothing calls", `function never() { return Bun.build({ entrypoints: [] }); }\nconsole.log(1);`],
    ["members of an object of the program's own", `const mine = { ModuleGraph: Map, build() {}, Transpiler: Map, dlopen() {} }; console.log(new mine.ModuleGraph(), mine.build(), new mine.Transpiler(), mine.dlopen());`],
    ["a database that loads no extension", `import { Database } from "bun:sqlite";\nconsole.log(new Database(":memory:").query("select 1").get());`],
  ])("the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });

  test.each([
    ["import", `import { crash_handler } from "bun:internal-for-testing";\ndeclare const console: any;\nconsole.log(crash_handler);`],
    ["require", `declare const console: any, require: any;\nconsole.log(require("bun:internal-for-testing"));`],
  ])("the module that Bun's own tests use is listed: %s", async (_, text) => {
    expect(accountsFor(await runtimeUse({ "main.ts": "// @ts-nocheck\n" + text }), "module bun:internal-for-testing")).toBe(true);
  });
});

group("only reached code counts", () => {
  test("a function that nothing calls does not open the report", async () => {
    expect(completeness(await of(`function never() { return eval("1"); }\nconsole.log(1);`))).toEqual(closed);
  });

  // TODO: the line does not name eval.
  test.todo("a function that reaches unknown code does", async () => {
    expect(completeness(await of(external + `function sometimes() { return eval("1"); }\nexternal(sometimes);`)).whyOpen).toContain("eval: the program calls eval() or new Function() (eval)");
  });

  test.each([
    ["eval: the program calls eval() or new Function() (eval)", `function never(text: string) { return (0, eval)(text); }\n`],
    ["a require of a computed name", `function never(name: string) { return require(name); }\n`],
    ["an import() of a computed name", `function never(name: string) { return import(name); }\n`],
  ])("%s in a function that nothing calls brings no built-in module along", async (_, never) => {
    const modulesOf = (use: Use) => use.lines.filter(line => line.startsWith("module "));
    const [plain, withNever] = await Promise.all([of(`console.log(1);`), of(never + `console.log(1);`)]);
    expect({ first: withNever.lines[0], modules: modulesOf(withNever) }).toEqual({ first: closed.first, modules: modulesOf(plain) });
  });

  test.each([
    ["a function that nothing calls", `function never() { return new HTMLRewriter(); }\nconsole.log(1);`],
    ["a function nested in one that nothing calls", `function never() { return () => new HTMLRewriter(); }\nconsole.log(1);`],
    ["a function that only such a function calls", `function inner() { return new HTMLRewriter(); }\nfunction never() { return inner(); }\nconsole.log(1);`],
    ["a method of a class that nothing constructs", `class Never { make() { return new HTMLRewriter(); } }\nconsole.log(1);`],
    ["a getter of a class that nothing constructs", `class Never { get create() { return new HTMLRewriter(); } }\nconsole.log(1);`],
    ["a field of a class that nothing constructs", `function never() { class Never { rewriter = new HTMLRewriter(); } return Never; }\nconsole.log(1);`],
    ["a getter of an object in a function that nothing calls", `function never() { return { get create() { return new HTMLRewriter(); } }; }\nconsole.log(1);`],
    ["the default of a parameter of a function that nothing calls", `function never(rewriter = new HTMLRewriter()) { return rewriter; }\nconsole.log(1);`],
    ["a property of globalThis there", `function never() { return new (globalThis as any).HTMLRewriter(); }\nconsole.log(1);`],
    ["an alias of the global object, read there", `const everything: any = globalThis;\nfunction never() { return new everything.HTMLRewriter(); }\nconsole.log(1);`],
    ["in, there", `function never() { return "HTMLRewriter" in globalThis; }\nconsole.log(1);`],
  ])("a global is not named by %s", async (_, text) => {
    const use = await of(text);
    expect({ first: use.lines[0], named: use.lines.includes("global HTMLRewriter"), exitCode: use.exitCode }).toEqual({ first: closed.first, named: false, exitCode: 0 });
  });

  test.each([
    ["a function that is called", `function create() { return new HTMLRewriter(); }\ncreate();`],
    ["a function that native code calls", `function create() { return new HTMLRewriter(); }\nprocess.nextTick(create);`],
    ["a function that reaches unknown code", `function create() { return new HTMLRewriter(); }\nexternal(create);`],
    ["a function nested in one that is called", `function outer() { return () => new HTMLRewriter(); }\nouter()();`],
    ["a function that a called one calls", `function inner() { return new HTMLRewriter(); }\nfunction outer() { return inner(); }\nouter();`],
    ["a method of an instance that reaches unknown code", `class Maker { make() { return new HTMLRewriter(); } }\nexternal(new Maker());`],
    ["a getter of an instance that reaches unknown code", `class Maker { get create() { return new HTMLRewriter(); } }\nexternal(new Maker());`],
    ["a setter of an instance that reaches unknown code", `class Maker { set rewriter(value: unknown) { console.log(new HTMLRewriter(), value); } }\nexternal(new Maker());`],
    ["a static method of a class that reaches unknown code", `class Maker { static make() { return new HTMLRewriter(); } }\nexternal(Maker);`],
    ["a field of a class that is constructed", `class Maker { rewriter = new HTMLRewriter(); }\nconsole.log(new Maker());`],
    ["a static block", `class Maker { static { console.log(new HTMLRewriter()); } }\nconsole.log(Maker);`],
    ["the computed name of a method that nothing calls", `class Maker { [String(new HTMLRewriter())]() {} }\nconsole.log(Maker);`],
    ["the base of a class", `function base() { return HTMLRewriter; }\nclass Maker extends base() {}\nconsole.log(Maker);`],
    ["a getter of an object that reaches unknown code", `external({ get create() { return new HTMLRewriter(); } });`],
    ["the computed name of a method of an object", `console.log({ [String(new HTMLRewriter())]() {} });`],
    ["the default of a parameter", `function create(value = new HTMLRewriter()) { return value; }\ncreate();`],
    ["the default in a pattern", `function create({ value = new HTMLRewriter() } = {} as any) { return value; }\ncreate();`],
    ["a generator", `function* create() { yield new HTMLRewriter(); }\nconsole.log([...create()]);`],
    ["an async function", `async function create() { return new HTMLRewriter(); }\ncreate();`],
    ["a callback", `[1].forEach(() => new HTMLRewriter());`],
  ])("a global is named by %s", async (_, text) => {
    const use = await of(external + text);
    expect({ first: use.lines[0], named: use.lines.includes("global HTMLRewriter") }).toEqual({ first: closed.first, named: true });
  });

  test.each([
    ["Bun", "Bun color", `Bun.color("red", "css")`],
    ["Bun, destructured", "Bun color", `(() => { const { color } = Bun; return color("red", "css"); })()`],
    ["process", "process umask", `process.umask()`],
    ["console", "console takeHeapSnapshot", `console.takeHeapSnapshot()`],
    ["console, all of it", "console (escapes, so any member may be used)", `console[process.argv[2]]`],
  ])("%s: a member counts where it is reached", async (_, line, expression) => {
    const [never, reached] = await Promise.all([of(`function never() { return ${expression}; }\nconsole.log(1);`), of(`function create() { return ${expression}; }\ncreate();`)]);
    expect({ never: never.lines.includes(line), reached: reached.lines.includes(line) }).toEqual({ never: false, reached: true });
  });

  test("a file of which only one function is reached names what that function names", async () => {
    const use = await runtimeUse({
      "main.ts": `import { used } from "./lib";\ndeclare const console: any;\nconsole.log(used());`,
      "lib.ts": declared + `export function used() { return Bun.color("red", "css"); }\nexport function unused() { return new HTMLRewriter(); }`,
    });
    expect({ first: use.lines[0], color: use.lines.includes("Bun color"), rewriter: use.lines.includes("global HTMLRewriter") }).toEqual({ first: closed.first, color: true, rewriter: false });
  });

  // TODO: console.log of a text lists internal/util/inspect.
  test.todo("a module that native code asks for comes with the built-in that makes it ask", async () => {
    const modules = ["module internal/util/inspect", "module node:timers/promises"];
    const [hello, called, copied] = await Promise.all([
      of(`console.log("hello");`),
      of(`setTimeout(() => {}, 1);`),
      of(`const copy: any = { ...setTimeout };\nconsole.log(String(Object.getOwnPropertySymbols(copy).length));`),
    ]);
    const found = (use: Use) => modules.filter(line => use.lines.includes(line));
    expect({ hello: found(hello), called: found(called), copied: found(copied) }).toEqual({ hello: [], called: [], copied: ["module node:timers/promises"] });
  });

  test("a built-in module binds its native code where it is loaded", async () => {
    const isBinding = (line: string) => /^native \S*node_zlib_binding\.bind\.ts:NativeZlib$/.test(line);
    const [hello, zlib] = await Promise.all([of(`console.log(1);`), runtimeUse({ "main.ts": `import { gzipSync } from "node:zlib";\ndeclare const console: any;\nconsole.log(gzipSync("a"));` })]);
    expect({ hello: hello.lines.some(isBinding), zlib: zlib.lines.some(isBinding) }).toEqual({ hello: false, zlib: true });
  });

  test.each([
    ["an import", `import { StringDecoder } from "node:string_decoder";\nconsole.log(StringDecoder);`, true],
    ["an import for its effects", `import "node:string_decoder";\nconsole.log(1);`, true],
    ["require in a function that is called", `function load() { return require("node:string_decoder"); }\nconsole.log(load());`, true],
    ["import() in a function that is called", `function load() { return import("node:string_decoder"); }\nconsole.log(load());`, true],
    ["process.getBuiltinModule in a function that is called", `function load() { return process.getBuiltinModule("node:string_decoder"); }\nconsole.log(load());`, true],
    ["require in a function that nothing calls", `function never() { return require("node:string_decoder"); }\nconsole.log(1);`, false],
    ["import() in a function that nothing calls", `function never() { return import("node:string_decoder"); }\nconsole.log(1);`, false],
    ["an import of its types", `import type { StringDecoder } from "node:string_decoder";\nlet stats: StringDecoder | undefined;\nconsole.log(stats);`, false],
  ])("a native module is listed where it is loaded: %s", async (_, text, listed) => {
    const use = await runtimeUse({ "main.ts": "// @ts-nocheck\n" + text });
    expect({ first: use.lines[0], listed: use.lines.includes("module node:string_decoder") }).toEqual({ first: closed.first, listed });
  });

  // TODO: the global object counts as escaped, and node:events is not listed.
  test.todo("node:stream and what it loads leave the report closed", async () => {
    const use = await runtimeUse({ "main.ts": `import { Readable } from "node:stream";\nnew Readable().emit("a");` });
    const modules = ["module node:events", "module internal/streams/readable"];
    expect({ ...completeness(use), modules: modules.filter(line => use.lines.includes(line)) }).toEqual({ ...closed, modules });
  });
});

group("what a built-in function names counts for the built-in that native code calls it for", () => {
  const conditional = ["Bun write", "Bun resolve", "Bun jest", "Bun stdout", "Bun stdin", "Bun indexOfLine", "process dlopen", "process hrtime"];
  const named = (use: Use) => conditional.filter(line => use.lines.includes(line));

  test("a program that names none of those built-ins names nothing of theirs", async () => {
    const use = await of(`console.log(1);`);
    expect({ first: use.lines[0], named: named(use) }).toEqual({ first: closed.first, named: [] });
  });

  test.each([
    ["console.write", `console.write("a");`, ["Bun stdout"]],
    ["console.Console", `console.log(new console.Console(process.stdout));`, ["process hrtime"]],
    ["process.stdin", `console.log(typeof process.stdin);`, ["Bun stdin"]],
    ["process.openStdin", `console.log(typeof process.openStdin());`, ["Bun stdin"]],
    ["any member of process", `console.log(typeof process[process.argv[2]]);`, ["Bun stdin"]],
  ])("%s brings what it leads to", async (_, text, expected) => {
    const use = await of(`export {};\n` + text);
    expect({ first: use.lines[0], named: named(use).filter(line => expected.includes(line)) }).toEqual({ first: closed.first, named: expected });
  });

  test("Bun.build brings what it leads to", async () => {
    const use = await of(`console.log(Bun.build({ entrypoints: [] }));`);
    expect(named(use).filter(line => line === "Bun write" || line === "Bun resolve")).toEqual(["Bun resolve"]);
  });

  test("a function that nothing calls brings nothing", async () => {
    expect(named(await of(`function never() { return Bun.build({ entrypoints: [] }); }\nconsole.log(1);`))).toEqual([]);
  });

  // TODO: the import of a page retains nothing.
  test.todo("an import of a page retains the bundler", async () => {
    const files = { "a.ts": `export const a = "a";`, "index.html": `<html></html>` };
    const [page, file] = await Promise.all([
      runtimeUse({ "main.ts": `// @ts-ignore\nimport page from "./index.html";\ndeclare const process: any;\nprocess.title = String(page);`, ...files }),
      runtimeUse({ "main.ts": `import { a } from "./a";\ndeclare const process: any;\nprocess.title = a;`, ...files }),
    ]);
    expect({ page: retainsFeature(page.lines, "Bundler"), file: retainsFeature(file.lines, "Bundler"), first: file.lines[0] }).toEqual({ page: true, file: false, first: closed.first });
  });
});

group("members of built-in classes", () => {
  const input = `declare const input: any;\n`;
  const members = async (text: string) => {
    const use = await runtimeUse({ "main.ts": declared + input + text, "other.ts": `export const localeCompare = 1;` });
    return { first: use.lines[0], named: use.lines.includes("property localeCompare"), every: use.lines.includes("property toTemporalInstant") };
  };

  eachRow([
    ["a member", `console.log(input.localeCompare("a"));`],
    ["a member of an optional chain", `console.log(input?.localeCompare);`],
    ["a string in brackets", `console.log(input["localeCompare"]);`],
    ["a template without substitutions in brackets", "console.log(input[`localeCompare`]);"],
    ["a constant in brackets", `const key = "localeCompare";\nconsole.log(input[key]);`],
    ["a pattern", `const { localeCompare } = input;\nconsole.log(localeCompare);`],
    ["a pattern that renames it", `const { localeCompare: compare } = input;\nconsole.log(compare);`],
    ["a pattern inside a pattern", `const { inner: { localeCompare } } = input;\nconsole.log(localeCompare);`],
    ["the pattern of a parameter", `function compare({ localeCompare }: any) { return localeCompare; }\nconsole.log(compare(input));`],
    ["a pattern that is assigned to", `let compare;\n({ localeCompare: compare } = input);\nconsole.log(compare);`],
  ])("a member is named by %s", async (_, text) => {
    expect(await members(text)).toEqual({ first: closed.first, named: true, every: false });
  });

  test.each([
    ["concatenated strings in brackets", `console.log(input["locale" + "Compare"]);`],
    ["a template with a constant in brackets", "const tail = \"Compare\";\nconsole.log(input[`locale${tail}`]);"],
    ["a concatenated constant in brackets", `const key = "locale" + "Compare";\nconsole.log(input[key]("a"));`],
    ["Reflect.get", `console.log(Reflect.get(input, "localeCompare"));`],
    ["Object.getOwnPropertyDescriptor", `console.log(Object.getOwnPropertyDescriptor(input, "localeCompare"));`],
    ["Reflect.getOwnPropertyDescriptor", `console.log(Reflect.getOwnPropertyDescriptor(input, "localeCompare"));`],
    ["the list of names of JSON.stringify", `console.log(JSON.stringify(input, ["localeCompare", 0]));`],
  ])("a member is used through %s", async (_, text) => {
    expect(await members(text)).toMatchObject({ first: closed.first, named: true });
  });

  test("a method of a primitive is named", async () => {
    const use = await of(`console.log((1234.5).toLocaleString("de"));`);
    expect({ ...completeness(use), named: use.lines.includes("property toLocaleString") }).toEqual({ ...closed, named: true });
  });

  test.each([
    ["a string", `console.log("localeCompare");`],
    ["the key of an object literal", `console.log({ localeCompare: 1 });`],
    ["a method that the program defines", `class Text { localeCompare() { return 0; } }\nconsole.log(new Text());`],
    ["a variable", `const localeCompare = 1;\nconsole.log(localeCompare);`],
    ["a type", `type Compare = String["localeCompare"];\nlet compare: Compare | undefined;\nconsole.log(compare);`],
    ["an import from a file of the program", `import { localeCompare } from "./other";\nconsole.log(localeCompare);`],
    ["an import that renames it", `import { localeCompare as compare } from "./other";\nconsole.log(compare);`],
    ["a function that nothing calls", `function never() { return input.localeCompare("a"); }\nconsole.log(1);`],
    ["a pattern in a function that nothing calls", `function never({ localeCompare }: any) { return localeCompare; }\nconsole.log(1);`],
  ])("a member is not named by %s", async (_, text) => {
    expect(await members(text)).toEqual({ first: closed.first, named: false, every: false });
  });

  const holderNames = ["sql", "file", "build", "password", "listen", "send", "serve", "Image", "$", "alert", "color", "fetch", "on", "mark"];
  const holderMembers = (use: Use) => use.lines.filter(line => /^(Bun|process|global|console|performance|Intl) /.test(line) && (line.endsWith(" (escapes, so any member may be used)") || holderNames.includes(line.split(" ")[1])));

  test.each([
    ["an object literal", `const mine = { ${holderNames.map(name => `${name}: 1`).join(", ")} };`],
    ["an instance of a class", `class Mine { ${holderNames.map(name => `${name} = 1;`).join(" ")} }\nconst mine = new Mine();`],
    ["a value of type any", `const mine: any = JSON.parse(String(1));`],
    ["a parameter of type any", `const mine = ((input: any) => input)({});`],
  ])("a property with the name of a member of Bun, process or the global object, read from %s, names no such member", async (_, creates) => {
    const reads = holderNames.map(name => `mine.${name}`).join(", ");
    const use = await of(`${creates}\nconst { ${holderNames.map((name, index) => `${name}: taken${index}`).join(", ")} } = mine;\nconsole.log(${reads}, mine["file"], taken0);`);
    expect({ exitCode: use.exitCode, first: use.lines[0], members: holderMembers(use) }).toEqual({ exitCode: 0, first: closed.first, members: [] });
  });

  // TODO: `typeof performance.mark` is not listed.
  test.todo("the same names read from Bun, process and the global object name their members", async () => {
    const use = await of(`declare const performance: any;\nconsole.log(typeof Bun.file, typeof Bun["password"], typeof process.send, typeof (globalThis as any).alert, typeof performance.mark);`);
    const expected = ["Bun file", "Bun password", "global alert", "performance mark", "process send"];
    expect({ exitCode: use.exitCode, first: use.lines[0], members: expected.filter(line => use.lines.includes(line)) }).toEqual({ exitCode: 0, first: closed.first, members: expected });
  });

  test.each([
    ["a parameter in brackets", `function read(key: string) { return input[key]; }\nconsole.log(read(input.name));`],
    ["a call of what a key finds", `function call(key: string) { return input[key](); }\nconsole.log(call(input.name));`],
    ["a variable that is assigned to", `let key = "a";\nkey = input.name;\nconsole.log(input[key]);`],
    ["a string concatenated with an unknown one", `console.log(input["locale" + input.rest]);`],
    ["a template with unknown substitutions", "function read(one: string, other: string) { return input[`${one}Locale${other}`]; }\nconsole.log(read(input.one, input.other));"],
    ["a computed key in a pattern", `function read(key: string) { const { [key]: value } = input; return value; }\nconsole.log(read(input.name));`],
    ["a computed key in a pattern that is assigned to", `function read(key: string) { let value; ({ [key]: value } = input); return value; }\nconsole.log(read(input.name));`],
    ["a key, where the result is stored and passed on", `const found = input[input.name];\nconsole.log(typeof found, found);`],
    ["a key, where the result is called", `input[input.name]();`],
    ["a key, where the result or else another value is passed on", `console.log(input[input.name] ?? 1);`],
    ["a key, where a member of the result is called", `console.log(input[input.name].call(1));`],
    ["a sum that may be a string", `function read(one: any, other: any) { return input[one + other]; }\nconsole.log(read(input.one, input.other));`],
    ["a sum of what may be a string and a number", `function read(one: any) { return input[one + 1]; }\nconsole.log(read(input.one));`],
    ["a counter that may start as a string", `function read(at: any) { for (; at < 9; at++) console.log(input[at]); }\nread(input.one);`],
    ["Reflect.get of a key", `console.log(Reflect.get(input, input.name));`],
    ["Reflect.get of the global object", `console.log(globalThis.Reflect.get(input, input.name));`],
    ["Reflect.get of an alias of the global object", `const everything: any = globalThis;\nconsole.log(everything.Reflect.get(input, input.name));`],
    ["Object.getOwnPropertyDescriptor of a key", `console.log(Object.getOwnPropertyDescriptor(input, input.name));`],
    ["Object.getOwnPropertyDescriptor of the global object", `console.log(globalThis.Object.getOwnPropertyDescriptor(input, input.name));`],
    ["Object.getOwnPropertyDescriptors", `console.log(Object.getOwnPropertyDescriptors(input));`],
    ["__lookupGetter__", `console.log(input.__lookupGetter__(input.name));`],
    ["__lookupSetter__", `console.log(input.__lookupSetter__(input.name));`],
    ["__lookupGetter__ in a pattern", `const { __lookupGetter__: look } = input;\nconsole.log(look.call(input, input.name));`],
    ["__lookupSetter__ in a pattern that is assigned to", `let look: any;\n({ __lookupSetter__: look } = input);\nconsole.log(look.call(input, input.name));`],
    ["__lookupGetter__ that Reflect.get reads", `console.log(Reflect.get(input, "__lookupGetter__").call(input, input.name));`],
    ["__lookupSetter__ out of its descriptor", `console.log(Object.getOwnPropertyDescriptor(input, "__lookupSetter__")!.value.call(input, input.name));`],
    ["JSON.stringify with a list that has an unknown name", `console.log(JSON.stringify(input, [input.name]));`],
    ["JSON.stringify with an unknown list", `console.log(JSON.stringify(input, input.names));`],
    ["JSON.stringify with a variable that may hold a list", `function print(names?: string[]) { return JSON.stringify(input, names); }\nconsole.log(print(input.names));`],
    ["JSON.stringify with spread arguments", `console.log(JSON.stringify(...(input as [unknown, string[]])));`],
    ["JSON.stringify with a list that is spread", `console.log(JSON.stringify(input, [...input.names]));`],
    ["an alias of JSON.stringify", `const print = JSON.stringify;\nconsole.log(print(input, input.names));`],
    ["JSON.stringify in a pattern", `const { stringify } = JSON;\nconsole.log(stringify(input, input.names));`],
    ["JSON.stringify through call", `console.log(JSON.stringify.call(null, input, input.names));`],
    ["stringify of a JSON that is a parameter", `function print(json: typeof JSON) { return json.stringify(input, input.names); }\nconsole.log(print(JSON));`],
  ])("any member may be used with %s", async (_, text) => {
    expect(await members(text)).toEqual({ first: closed.first, named: true, every: true });
  });

  test.each([
    ["called on it", `const holder: any = {}.constructor;\nconsole.log(holder.getOwnPropertyDescriptor(input, input.name).value);`],
    ["for all properties, called on it", `const holder: any = {}.constructor;\nconsole.log(holder.values(holder.getOwnPropertyDescriptors(input))[0].value);`],
    ["as an alias", `const holder: any = {}.constructor;\nconst take = holder.getOwnPropertyDescriptor;\nconsole.log(take(input, input.name).value);`],
    ["in a pattern", `const { getOwnPropertyDescriptor: take }: any = {}.constructor;\nconsole.log(take(input, input.name).value);`],
    ["in brackets", `const holder: any = {}.constructor;\nconsole.log(holder["getOwnPropertyDescriptor"](input, input.name).value);`],
    ["through super in a class that extends it", `class Child extends ({}.constructor as any) {\n  static take(from: unknown, name: string) {\n    return (super.getOwnPropertyDescriptor as any)(from, name);\n  }\n}\nconsole.log(Child.take(input, input.name).value);`],
    ["inherited by a class that extends it", `class Child extends ({}.constructor as any) {}\nconsole.log((Child as any).getOwnPropertyDescriptor(input, input.name).value);`],
  ])("Object can be reached without its name: any member may be used with the function that returns a descriptor, %s", async (_, text) => {
    expect((await members(text)).every).toBe(true);
  });

  eachRow([
    ["a number", `console.log(input[0]);`],
    ["a counter", `for (let i = 0; i < 9; i++) console.log(input[i]);`],
    ["a function of Math", `console.log(input[Math.floor(input.length / 2)]);`],
    ["a well-known symbol", `console.log(input[Symbol.iterator]);`],
    ["a number as an argument", `function read(at: number) { return input[at]; }\nconsole.log(read(1));`],
    ["a parameter that only literals reach", `function read(key: string) { return input[key]; }\nconsole.log(read("a"));`],
    ["a store under a parameter that only literals reach", `function store(key: string) { input[key] = 1; }\nstore("a");`],
    ["a key of a class of the program's own", `class Point { x = 1; y = 2; }\nfunction read(point: Point, key: keyof Point) { return point[key] === 1; }\nconsole.log(read(new Point(), "x"));`],
    ["a key in a function that nothing calls", `function never(key: string) { return input[key]; }\nconsole.log(1);`],
    ["the type of the functions that return descriptors", `console.log(typeof input.getOwnPropertyDescriptor, input.getOwnPropertyDescriptors === undefined);`],
    ["JSON.stringify without a second argument", `console.log(JSON.stringify(input));`],
    ["JSON.stringify with null and an indentation", `console.log(JSON.stringify(input, null, 2), JSON.stringify(input, undefined, 2));`],
    ["JSON.stringify with a function literal", `console.log(JSON.stringify(input, (key, value) => value), JSON.stringify(input, function (key, value) { return value; }));`],
    ["JSON.stringify with the name of a function", `function keep(key: string, value: unknown) { return value; }\nconst all = (key: string, value: unknown) => value;\nconsole.log(JSON.stringify(input, keep), JSON.stringify(input, all));`],
    ["JSON.parse", `console.log(JSON.parse(input.text), typeof JSON);`],
  ])("no other member is used with %s", async (_, text) => {
    expect(await members(text)).toEqual({ first: closed.first, named: false, every: false });
  });
});

group("a member of Bun while Bun is in hands that nobody follows", () => {
  const inUnknownHands =
    `declare const CustomEvent: any;\nconst unknown = (value: any): any => new CustomEvent("x", { detail: value }).detail;\n` +
    `console.log(Object.keys(unknown(Bun)).length, new Function("return 1")());\n`;
  const usesColor = async (text: string) => (await of(inUnknownHands + text)).lines.includes("Bun color");

  test.each([
    ["the global", `console.log(Bun.color("red", "css"));`],
    ["globalThis", `console.log((globalThis as any).Bun.color("red", "css"));`],
    ["a pattern", `const { color } = Bun;\nconsole.log(color("red", "css"));`],
    ["a named import", `import { color } from "bun";\nconsole.log(color("red", "css"));`],
    ["the namespace", `import * as namespace from "bun";\nconsole.log(namespace.color("red", "css"));`],
    ["the default export", `import all from "bun";\nconsole.log((all as any).color("red", "css"));`],
    ["a constant", `const bun = Bun;\nconsole.log(bun.color("red", "css"));`],
    ["a parameter", `const paint = (bun: any) => bun.color("red", "css");\nconsole.log(paint(Bun));`],
    ["a parameter that other values reach too", `const paint = (bun: any) => bun.color("red", "css");\nconsole.log(paint(Bun), paint(unknown({ color: () => 1 })));`],
    ["an element", `console.log([Bun][0].color("red", "css"));`],
    ["a property", `console.log({ bun: Bun }.bun.color("red", "css"));`],
    ["a result", `console.log((() => Bun)().color("red", "css"));`],
    ["a static field", `class Holder { static bun = Bun; }\nconsole.log(Holder.bun.color("red", "css"));`],
    ["a field", `class Holder { bun = Bun; }\nconsole.log(new Holder().bun.color("red", "css"));`],
    ["a string in brackets", `console.log(Bun["color"]("red", "css"));`],
    ["an optional chain", `console.log(Bun?.color("red", "css"));`],
    ["require", `console.log(require("bun").color("red", "css"));`],
    ["a dynamic import", `console.log(((await import("bun")) as any).color("red", "css"));`],
    ["one arm of a condition", `const bun = process.argv.length > 5 ? unknown({}) : Bun;\nconsole.log(bun.color("red", "css"));`],
    ["a Map", `const map = new Map([["bun", Bun]]);\nconsole.log(map.get("bun").color("red", "css"));`],
    ["a variable that held something else", `let bun = unknown({});\nbun = Bun;\nconsole.log(bun.color("red", "css"));`],
  ])("is used where the program names it on Bun, which it reached by %s", async (_, text) => {
    expect(await usesColor(text)).toBe(true);
  });

  test.each([
    ["what came back out of those hands", `console.log(typeof unknown(Bun).color);`],
    ["another object", `console.log(unknown({ color: () => 1 }).color());`],
    ["Bun, by a computed key", `console.log(typeof Bun[process.argv[9]]);`],
  ])("is not used where its name is read off %s", async (_, text) => {
    expect(await usesColor(text)).toBe(false);
  });

  test.todo("is used where the program names it on Bun, which it reached by a promise that a built-in made: (await Promise.resolve(Bun)).color()");
});

// Each title says what was once taken for granted of the program. The compiler follows the value all the way instead: nothing blocks --trim, and neither the global object nor process nor Bun
// counts as handed to code that nobody sees. What such a program uses is what it names.
group("what the compiler follows, so that it is no longer so:", () => {
  test.each([
    ["any member of Bun or process may be used with a function defined on Bun, destructured out of the global object", "const { Bun: taken } = globalThis as any; Object.defineProperty(taken, \"mine\", { value: function (this: any) { return this; } }); console.log(taken.mine());"],
    ["the report is open with eval that reaches unknown code", "declare const external: (...values: unknown[]) => unknown;\nexternal(eval);"],
    ["the report is open with Function that reaches unknown code", "declare const external: (...values: unknown[]) => unknown;\nexternal(Function);"],
    ["the report is open with createRequire, called at once", "import { createRequire } from \"node:module\";\nconsole.log(typeof createRequire((import.meta as any).url)(\"node:path\").join);"],
    ["the report is open with createRequire, stored", "import { createRequire } from \"node:module\";\nconst load = createRequire((import.meta as any).url);\ntry { console.log(load(\"late-package\")); } catch {}"],
    ["the report is open with module.require as a value", "const load = module.require; console.log(load);"],
    ["the report is open with module.require of a computed name", "console.log(module.require(process.argv[2]));"],
    ["the report is open with module.require of one of two literals", "console.log(module.require(process.argv[2] ? \"node:vm\" : \"node:fs\"));"],
    ["the report is open with import() of bun:main", "try { await import(\"bun:main\"); } catch {}\nexport {};"],
    ["any global may be used with __defineGetter__ of the global object", "(globalThis as any).__defineGetter__(\"mine\", function (this: any) { return this; });"],
    ["any global may be used with the getter of self", "console.log((globalThis as any).__lookupGetter__(\"self\")());"],
    ["any global may be used with the getter of self, through an alias", "const everything: any = globalThis; console.log(everything.__lookupGetter__(\"self\")());"],
    ["process as a member of the global object escapes like process, after a type assertion", "console.log(Object.keys((globalThis as any).process));"],
    ["process as a member of the global object escapes like process, in brackets", "console.log(Object.keys((globalThis as any)[\"process\"]));"],
    ["any global may be used with the getter of a computed name", "console.log((globalThis as any).__lookupGetter__(process.argv[2])());"],
    ["any member of Bun or process may be used with Bun as an argument", "console.log(Object.keys(Bun));"],
    ["any member of Bun or process may be used with valueOf() of process as an argument", "console.log(Object.keys(process.valueOf()));"],
    ["any member of Bun or process may be used with an accessor on Bun that the descriptor inherits", "Object.defineProperty(Bun, \"mine\", { __proto__: { get(this: any) { return this; } } } as any); console.log(Bun.mine);"],
    ["any member of Bun or process may be used with __defineSetter__ of process", "process.__defineSetter__(\"mine\", function (this: any) { console.log(this); });"],
    ["any member of Bun or process may be used with a function of the program's own, called on Bun under a var that is read before its initializer", "(Bun as any).undefined = function (this: any) { return this; };\nfunction early() { return (Bun as any)[key](); }\nconsole.log(early());\nvar key = \"mine\";"],
    ["any member of Bun or process may be used with a function stored on Bun, destructured out of the global object, and called there", "const { Bun: taken } = globalThis as any; taken.mine = function (this: any) { return this; }; console.log(taken.mine());"],
    ["any member of Bun or process may be used with valueOf() of Bun as an argument", "console.log(Object.keys(Bun.valueOf()));"],
    ["a function defined on performance leaves the report closed, and any member of the holder may be used", "declare const performance: any; Object.defineProperty(performance, \"mine\", { value: function (this: any) { return this; } }); console.log(performance.mine());"],
    ["a call of what is no member of performance leaves the report closed, and any member of the holder may be used", "declare const performance: any; console.log(performance.me());"],
    ["the base of a class leaves the report closed, and any member of the holder may be used", "class Text extends String { compare() { return super.localeCompare(\"a\"); } }\nconsole.log(new Text().compare());"],
    ["in, of Bun leaves the report closed, and any member of the holder may be used", "console.log(process.argv[2] in Bun);"],
    ["a computed member of super leaves the report closed, and any member of the holder may be used", "declare const input: any;\nclass Text extends String { read(key: string) { return (super[key as any] as any); } }\nconsole.log(new Text().read(input.name));"],
    ["a computed member of Bun leaves the report closed, and any member of the holder may be used", "console.log(Bun[process.argv[2]]);"],
    ["a global is named by an export of the entry point", "declare const external: (...values: unknown[]) => unknown;\nexport function create() { return new HTMLRewriter(); }"],
    ["console as an async iterable brings what it leads to", "export {};\nfor await (const line of console) console.log(line);"],
  ])("%s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });

  test.each<[string, Record<string, string>, string]>([
    ["may be the global object: the report is open when it is read by a computed name in an arrow function", { "main.ts": "import lib from \"./lib.cjs\";\ndeclare const console: any;\nconsole.log(lib());", "lib.cjs": "module.exports = function (name) { return (() => this[name])(); };" }, "main.ts"],
    ["may be the global object: the report is open when it is read by a computed name through a variable", { "main.ts": "import lib from \"./lib.cjs\";\ndeclare const console: any;\nconsole.log(lib());", "lib.cjs": "module.exports = function (name) { var self = this; return self[name]; };" }, "main.ts"],
    ["may be the global object: the report is open when it is read by a computed name", { "main.ts": "import lib from \"./lib.cjs\";\ndeclare const console: any;\nconsole.log(lib());", "lib.cjs": "module.exports = function (name) { return this[name]; };" }, "main.ts"],
    ["a member is named by in", { "main.ts": declared + "declare const input: any;\nconsole.log(\"localeCompare\" in input);", "other.ts": "export const localeCompare = 1;" }, "main.ts"],
  ])("%s", async (_, files, entryPoint) => {
    expect(completeness(await runtimeUse(files, undefined, entryPoint))).toEqual(closed);
  });
});

/** The groups are dealt out in turn to the files runtime-use-<part>.test.ts: each test is a run of the compiler, and a file has five minutes. */
export function runtimeUseTests(part: number, parts: number) {
  groups.forEach(([name, body], index) => {
    if (index % parts === part - 1) describe.concurrent(name, body);
  });
}
