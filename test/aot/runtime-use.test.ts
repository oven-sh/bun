import { describe, expect } from "bun:test";
import { declared, of, runtimeUse } from "./runtime-use-harness";
import { test } from "./supported";

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
      "main.ts": `import { file } from "bun";\ndeclare const Bun: any, process: any, console: any;\nconst { write } = Bun;\nconsole.log(Bun.nanoseconds, file, write, process.env.HOME, process["argv"]);`,
    });
    expect(use.lines[0]).toBe("closed");
    for (const fact of ["Bun nanoseconds", "Bun file", "Bun write", "process env", "process argv"]) expect(use.lines).toContain(fact);
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
    expect(use.world).toBe("closed");
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
    ["a listener on a variable that holds the global object", `const held: any = globalThis;\nheld.addEventListener("error", function (this: any) { console.log(this); });`, "addEventListener of the global object"],
    ["addEventListener taken out of the global object", `const { addEventListener: listen } = globalThis as any;\nlisten("popstate", function (this: any) { console.log(this); });`, "addEventListener of the global object"],
    ["a listener for an event, where an event that is not seen is dispatched", `declare const dispatchEvent: any; addEventListener("mine", function (this: any) { console.log(this); }); dispatchEvent(JSON.parse(process.argv[2]));`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for an event, where the type of what is dispatched is computed", `declare const dispatchEvent: any; addEventListener("mine", function (this: any) { console.log(this); }); dispatchEvent(new Event(process.argv[2]));`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for an event, where an event of a class of the program's own is dispatched", `declare const dispatchEvent: any; class Other extends Event { constructor(_: string) { super("mine"); } } addEventListener("mine", function (this: any) { console.log(this); }); dispatchEvent(new Other("other"));`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for an event, where the class of what is dispatched is stored to", `declare const dispatchEvent: any; (globalThis as any).Event = class extends Event { constructor(_: string) { super("mine"); } }; addEventListener("mine", function (this: any) { console.log(this); }); dispatchEvent(new Event("other"));`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for an event, where the class of what is dispatched is stored to through a pattern", `declare const dispatchEvent: any; declare let Event: any; class Mine extends Event { constructor() { super("mine"); } } addEventListener("mine", function (this: any) { console.log(this); }); [Event] = [Mine]; dispatchEvent(new Event("other"));`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for an event, where the class of what is dispatched is stored to through an object pattern", `declare const dispatchEvent: any; declare let Event: any; class Mine extends Event { constructor() { super("mine"); } } addEventListener("mine", function (this: any) { console.log(this); }); ({ a: Event } = { a: Mine }); dispatchEvent(new Event("other"));`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for an event, where the class of what is dispatched is stored to by the head of a loop", `declare const dispatchEvent: any; declare let Event: any; class Mine extends Event { constructor() { super("mine"); } } addEventListener("mine", function (this: any) { console.log(this); }); for (Event of [Mine]); dispatchEvent(new Event("other"));`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for an event, where the class of what is dispatched is stored to as a member through a pattern", `declare const dispatchEvent: any; class Mine extends Event { constructor() { super("mine"); } } addEventListener("mine", function (this: any) { console.log(this); }); [(globalThis as any).CustomEvent] = [Mine]; dispatchEvent(new CustomEvent("other"));`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for an event, where what is dispatched is given another type first", `declare const dispatchEvent: any; addEventListener("mine", function (this: any) { console.log(this); }); const event = new Event("other"); event.initEvent("mine"); dispatchEvent(event);`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for an event, where dispatchEvent is kept", `declare const dispatchEvent: any; addEventListener("mine", function (this: any) { console.log(this); }); const dispatch = dispatchEvent; dispatch(new Event("mine"));`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for an event that is dispatched in another spelling", `addEventListener("mine", function (this: any) { console.log(this); }); const event = new (globalThis as any).CustomEvent("mine"); (globalThis as any).dispatchEvent(event);`, "addEventListener and dispatchEvent of the global object"],
    ["a listener for an event of the global object that a constant names", `const event = "error"; addEventListener(event, function (this: any) { console.log(this); });`, "addEventListener of the global object"],
    ["a listener for an event in a variable that is stored to", `let event = "fetch"; event = "error"; addEventListener(event, function (this: any) { console.log(this); });`, "addEventListener of the global object"],
    ["a value defined on the global object under a name in a variable that is stored to", `let name = "mine"; name = process.argv[2]; Object.defineProperty(globalThis, name, { value: 1 });`, "an accessor on the global object"],
    ["a function stored on Bun under a name in a var that is read before its initializer", `function early() { (Bun as any)[key] = function (this: any) { return this; }; }\nearly();\nvar key = "mine";\nconsole.log((Bun as any).undefined());`, "Bun"],
    ["a function of its own called on Bun under a name in a var that is read before its initializer", `(Bun as any).undefined = function (this: any) { return this; };\nfunction early() { return (Bun as any)[key](); }\nconsole.log(early());\nvar key = "mine";`, "Bun"],
    ["a function defined on process under a name in a var that is read before its initializer", `function early() { Object.defineProperty(process, key, { value: function (this: any) { return this; } }); }\nearly();\nvar key = "mine";\nconsole.log((process as any).undefined());`, "process"],
    ["a listener for an event named by a var that is read before its initializer", `declare const dispatchEvent: any;\nfunction early() { addEventListener(type, function (this: any) { console.log(this); }); }\nearly();\nvar type = "pagehide";\ndispatchEvent(new Event("undefined"));`, "addEventListener and dispatchEvent of the global object"],
    ["an event of a type named by a var that is read before its initializer", `declare const dispatchEvent: any;\naddEventListener("undefined", function (this: any) { console.log(this); });\nfunction early() { dispatchEvent(new Event(type)); }\nearly();\nvar type = "other";`, "addEventListener and dispatchEvent of the global object"],
    ["an accessor on the global object under a name that a constant holds", `const name = "mine"; Object.defineProperty(globalThis, name, { get() { return this; } }); console.log((globalThis as any).mine);`, "an accessor on the global object"],
    ["a function of its own called on the global object", `(globalThis as any).mine = function (this: any) { return this; }; console.log((globalThis as any).mine());`, "what may be a function that sees the global object, stored on it"],
    ["an accessor on the global object", `Object.defineProperty(globalThis, "mine", { get() { return this; } }); console.log((globalThis as any).mine);`, "an accessor on the global object"],
    ["a function defined on the global object, written as a member of itself", `Object.defineProperty((globalThis as any).self, "mine", { value: function (this: any) { return this; } }); console.log((globalThis as any).mine());`, "the global object"],
    ["a function defined on the global object under a name of it that the file declares", `declare const self: any; Object.defineProperty(self, "mine", { value: function (this: any) { return this; } }); console.log(self.mine());`, "what may be a function that sees the global object, stored on it"],
    ["a function that a built-in module exports, stored on the global object and called there", `import EventEmitter from "node:events"; (globalThis as any).mine = EventEmitter; (globalThis as any).mine({ captureRejections: true });`, "what may be a function that sees the global object, stored on it"],
    ["the same by its name, through a constant and a conditional", `import { EventEmitter } from "node:events"; const held = EventEmitter; (globalThis as any).mine = process.argv[2] ? held : null; (globalThis as any).mine({ captureRejections: true });`, "what may be a function that sees the global object, stored on it"],
    ["the same defined on the global object", `import Stream from "node:stream"; Object.defineProperty(globalThis, "mine", { value: Stream }); (globalThis as any).mine({ captureRejections: true });`, "what may be a function that sees the global object, stored on it"],
    ["the same stored on Bun", `import EventEmitter from "node:events"; Bun.mine = EventEmitter; Bun.mine({ captureRejections: true });`, "Bun"],
    ["the same under a name that is handed events", `import EventEmitter from "node:events"; (globalThis as any).onerror = EventEmitter;`, "what may be a function that sees the global object, stored on it"],
    ["the same under a name of process that the runtime calls", `import EventEmitter from "node:events"; process.emitWarning = EventEmitter;`, "process"],
    ["a function defined on process, written as a member of a member of the global object", `Object.defineProperty((globalThis as any).self.process, "mine", { value: function (this: any) { return this; } }); console.log(process.mine());`, "the global object"],
    ["a function defined on process, taken out of the global object by a pattern", `const { process: taken } = globalThis as any; Object.defineProperty(taken, "mine", { value: function (this: any) { return this; } }); console.log(taken.mine());`, "the global object"],
    ["a function defined on Bun, taken out of the global object by a pattern", `const { Bun: taken } = globalThis as any; Object.defineProperty(taken, "mine", { value: function (this: any) { return this; } }); console.log(taken.mine());`, "the global object"],
    ["a function stored on process, taken out of the global object by a pattern, and called there", `const { process: taken } = globalThis as any; taken.mine = function (this: any) { return this; }; console.log(taken.mine());`, "process"],
    ["a function stored on Bun, taken out of the global object by a pattern, and called there", `const { Bun: taken } = globalThis as any; taken.mine = function (this: any) { return this; }; console.log(taken.mine());`, "Bun"],
    ["a function stored on process by name and called on what a pattern took out of the global object", `process.mine = function (this: any) { return this; }; const { process: taken } = globalThis as any; console.log(taken.mine());`, "process"],
    ["a function stored on process, written as a member of a member of the global object", `(globalThis as any).self.process.mine = function (this: any) { return this; }; console.log((globalThis as any).self.process.mine());`, "process"],
    ["an accessor on the global object that the descriptor inherits", `Object.defineProperty(globalThis, "mine", { __proto__: { get(this: any) { return this; } } } as any); console.log((globalThis as any).mine);`, "an accessor on the global object"],
    ["a function on the global object that the descriptor inherits", `Object.defineProperty(globalThis, "mine", { __proto__: { value: function (this: any) { return this; } } } as any); console.log((globalThis as any).mine());`, "an accessor on the global object"],
    ["an accessor on Bun that the descriptor inherits", `Object.defineProperty(Bun, "mine", { __proto__: { get(this: any) { return this; } } } as any); console.log(Bun.mine);`, "Bun"],
    ["a method defined on the global object that hands its receiver to what super finds", `Object.defineProperty(globalThis, "mine", { value() { return super.valueOf(); } }); console.log((globalThis as any).mine());`, "what may be a function that sees the global object, stored on it"],
    ["a method defined on process that hands its receiver to what super finds", `Object.defineProperty(process, "mine", { value() { return super.valueOf(); } }); console.log(process.mine());`, "process"],
    ["a native addon that is required", `console.log(require("./hello.node"));`, "a native addon"],
    ["a native addon that is required in a function that nothing calls", `function never() { return require("./hello.node"); }\nconsole.log(1);`, "a native addon"],
    ["a native addon that is imported", `// @ts-ignore\nimport addon from "./hello.node";\nconsole.log(addon);`, "a native addon"],
    ["a native addon that import() loads", `// @ts-ignore\nconsole.log(await import("./hello.node"));`, "a native addon"],
    ["a file that is imported as a native addon", `// @ts-ignore\nimport addon from "./hello.bin" with { type: "napi" };\nconsole.log(addon);`, "a native addon"],
    ["module.require of one of two written names", `console.log(module.require(process.argv[2] ? "node:vm" : "node:fs"));`, "require"],
    ["module.require of a name that is computed", `console.log(module.require(process.argv[2]));`, "require"],
    ["module.require that is kept", `const load = module.require; console.log(load);`, "require"],
    ["require.cache", `console.log(require.cache);`, "require.main, require.cache or require.extensions"],
    ["node:vm", `import vm from "node:vm"; console.log(vm);`, "a module that loads modules or evaluates text"],
    ["the worker of node:cluster, which holds process", `import cluster from "node:cluster"; console.log(cluster.worker?.process.pid);`, "a module that loads modules or evaluates text"],
    ["the worker of node:cluster, imported by name", `import { worker } from "node:cluster"; console.log(worker);`, "a module that loads modules or evaluates text"],
    ["the worker of node:cluster, taken out of what is required", `const { worker } = require("node:cluster"); console.log(worker);`, "a module that loads modules or evaluates text"],
    ["the worker of node:cluster, asked of process", `console.log(process.getBuiltinModule("cluster").worker);`, "a module that loads modules or evaluates text"],
    ["node:cluster that is handed on", `import * as cluster from "node:cluster"; console.log(cluster);`, "a module that loads modules or evaluates text"],
    ["node:cluster under a name that is computed", `import cluster from "node:cluster"; console.log((cluster as any)[process.argv[2]]);`, "a module that loads modules or evaluates text"],
    ["what a listener on node:cluster returns", `import cluster from "node:cluster"; console.log(cluster.on("exit", () => {}));`, "a module that loads modules or evaluates text"],
    ["a listener on node:cluster that says this", `import cluster from "node:cluster"; cluster.on("exit", function (this: any) { console.log(this); });`, "a module that loads modules or evaluates text"],
    ["node:module asked of process", `console.log(process.getBuiltinModule("node:module").createRequire(import.meta.url)("late-package"));`, "a module that loads modules or evaluates text"],
    ["node:module asked of process in a function that is called", `function load() { return process.getBuiltinModule("node:module").createRequire(import.meta.url)("late-package"); }\nconsole.log(load());`, "a module that loads modules or evaluates text"],
    ["node:module asked of process in a function that nothing mentions, beside node:vm", `import vm from "node:vm";\nfunction never() { return process.getBuiltinModule("node:module"); }\nconsole.log(vm);`, "a module that loads modules or evaluates text"],
  ])("the world is open with %s", async (_, text, why) => {
    const use = await of(text);
    expect(use.world).toBe("open");
    expect(use.whyOpen).toContain(why);
  });

  test("the path in a reason is spelled as the file is", async () => {
    const use = await runtimeUse({ "Upper-Case/main.ts": declared + `eval("1");` }, undefined, "Upper-Case/main.ts");
    expect(use.lines.find(line => line.startsWith("open a call of eval in "))).toEndWith("/Upper-Case/main.ts");
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
    ["a listener for an event that nothing dispatches, on a variable that holds the global object", `declare const window: any, document: any;\nconst held = typeof document !== "undefined" ? window : undefined;\nheld.addEventListener("popstate", function (this: any) { console.log(this); });`],
    ["a listener for an event, where an event of another type is dispatched", `declare const dispatchEvent: any; addEventListener("pagehide", function (this: any) { console.log(this); }); dispatchEvent(new Event("other"));`],
    ["a listener for an event, where an event of another type, held by a variable, is dispatched on the global object", `declare const window: any; addEventListener("pagehide", function (this: any) { console.log(this); }); const event = new window.ErrorEvent("error", { message: "a" }); if (!window.dispatchEvent(event)) console.log(1);`],
    ["a listener for an event that nothing dispatches, named by a constant", `const event = "pagehide"; addEventListener(event, function (this: any) { console.log(this); });`],
    ["a listener for an event that nothing dispatches, named by a var of the file", `var type = "pagehide";\nfunction listen() { addEventListener(type, function (this: any) { console.log(this); }); }\nlisten();`],
    ["a value defined on the global object under a name that a var holds", `var key = "__references__";\nfunction define() { Object.defineProperty(globalThis, key, { value: new Map() }); }\ndefine();`],
    ["a member of Bun under a name that a var holds, read behind its initializer", `var key = "version";\nconsole.log((Bun as any)[key]);`],
    ["members of process, taken out of the global object by a pattern, read and called", `const { process: taken } = globalThis as any; taken.title = "a"; console.log(taken.cwd(), taken.pid);`],
    ["a value defined on the global object under a name that a constant holds", `const name = "__references__"; Object.defineProperty(globalThis, name, { value: new Map(), configurable: true, writable: false, enumerable: false });`],
    ["the same on whichever name the global object has", `declare const window: any, self: any, global: any;\nconst name = "__references__", held = new Map();\nif (typeof globalThis !== "undefined") Object.defineProperty(globalThis, name, { value: held });\nelse if (typeof window !== "undefined") Object.defineProperty(window, name, { value: held });\nelse if (typeof self !== "undefined") Object.defineProperty(self, name, { value: held });\nelse if (typeof global !== "undefined") Object.defineProperty(global, name, { value: held });`],
    ["a value defined on the global object under a name of it that the file declares", `declare const self: any;\nObject.defineProperty(self, "__references__", { value: new Map() });`],
    ["the same under the name that only browsers have", `declare const window: any;\nif (typeof window !== "undefined") Object.defineProperty(window, "__references__", { value: new Map() });`],
    ["a native function bound to the global object", `declare const self: any; console.log(self.removeEventListener.bind(self));`],
    ["node:cluster, forked and listened to", `import cluster from "node:cluster";\nif (cluster.isPrimary) {\n  cluster.schedulingPolicy = cluster.SCHED_RR;\n  cluster.fork();\n  cluster.on("exit", (worker: any, code: number) => console.log(code));\n} else console.log(cluster.isWorker);`],
    ["names of node:cluster that do not lead to its worker", `import { isPrimary, fork, settings } from "node:cluster"; console.log(isPrimary, typeof fork, settings);`],
    ["what a built-in module exports, stored on the global object under its own name", `import { Buffer } from "node:buffer"; (globalThis as any).Buffer = Buffer; console.log(Buffer.from("a").length);`],
    ["a function that a built-in module exports, stored on the global object and only constructed there", `import EventEmitter from "node:events"; (globalThis as any).mine = EventEmitter; console.log(typeof new (globalThis as any).mine());`],
  ])("a feature test leaves the world closed: %s", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });
});

describe.concurrent("what Object.defineProperty gives console, performance or Intl", () => {
  test.each([
    ["console", `Object.defineProperty(console, "mine", { value: function (this: any) { return this; } }); console.log(console.mine());`],
    ["performance", `declare const performance: any; Object.defineProperty(performance, "mine", { value: function (this: any) { return this; } }); console.log(performance.mine());`],
    ["Intl", `Object.defineProperty(Intl, "mine", { get(this: any) { return this; } }); console.log((Intl as any).mine);`],
  ])("may see all of %s", async (host, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
    expect(use.lines).toContain(host + " *");
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
  const wildcards = (lines: string[]) => lines.filter(line => line.endsWith(" *") && line !== "property *" && line !== "program-key *" && line !== "symbol *");

  test.each([
    ["the global object", `delete (globalThis as any).fetch;`, "global *"],
    ["the global object, in brackets", `delete (globalThis as any)["fetch"];`, "global *"],
    ["the global object, by a constant name", `const name = "fetch"; const scope: any = globalThis; delete scope[name];`, "global *"],
    ["the global object, in an optional chain", `delete (globalThis as any)?.fetch;`, "global *"],
    ["globalThis.self", `delete (globalThis as any).self.fetch;`, "global *"],
    ["a variable that holds the global object", `const scope: any = globalThis; delete scope.fetch;`, "global *"],
    ["Bun", `delete Bun.color;`, "Bun *"],
    ["console", `delete console.table;`, "console *"],
  ])("of a member of %s", async (_, text, wildcard) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
    expect(wildcards(use.lines)).toContain(wildcard);
  });

  test.each([
    ["process", `delete process.title;`],
    ["globalThis.process", `delete (globalThis as any).process.title;`],
    ["globalThis.process, in brackets", `delete (globalThis as any)["process"].title;`],
    ["process of a variable that holds the global object", `const scope: any = globalThis; delete scope.process.title;`],
    ["a variable that holds process", `const held: any = process; delete held.title;`],
    ["process, taken out of the global object by a pattern", `const { process: taken } = globalThis as any; delete taken.title;`],
  ])("of a member of %s, which the runtime then looks for on what process inherits from: the world opens", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "open", whyOpen: ["process"] });
    expect(wildcards(use.lines)).toContain("process *");
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
  const wildcards = (lines: string[]) => lines.filter(line => line.endsWith(" *") && line !== "property *" && line !== "program-key *" && line !== "symbol *");

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
    ["a call of eval", `function never(text: string) { return (0, eval)(text); }\n`],
    ["a require of a name that is computed", `function never(name: string) { return require(name); }\n`],
    ["an import() of a name that is computed", `function never(name: string) { return import(name); }\n`],
  ])("%s in a function that nothing mentions brings no built-in module along", async (_, never) => {
    const modulesOf = (use: { lines: string[] }) => use.lines.filter(line => /^(program-)?module /.test(line));
    const [plain, withDoor] = await Promise.all([of(`console.log(1);`), of(never + `console.log(1);`)]);
    expect({ world: withDoor.world, modules: modulesOf(withDoor) }).toEqual({ world: "closed", modules: modulesOf(plain) });
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
    ["any member of process", `process[process.argv[2]] = 1;`, ["Bun stdin"]],
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
    ["a key that is put together around letters", "function read(one: string, other: string) { return given[`${one}Locale${other}`]; }\nconsole.log(read(given.one, given.other));"],
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
    ["a sum with what may be a text", `function read(one: any, other: any) { return given[one + other]; }\nconsole.log(read(given.one, given.other));`],
    ["a sum of what may be a text and a number", `function read(one: any) { return given[one + 1]; }\nconsole.log(read(given.one));`],
    ["a counter that starts as what may be a text", `function read(at: any) { for (; at < 9; at++) console.log(given[at]); }\nread(given.one);`],
    ["__lookupGetter__ that Reflect.get reads", `console.log(Reflect.get(given, "__lookupGetter__").call(given, "a"));`],
    ["__lookupSetter__ out of its descriptor", `console.log(Object.getOwnPropertyDescriptor(given, "__lookupSetter__")!.value.call(given, "a"));`],
  ])("any property may be read with %s", async (_, text) => {
    expect(await property(text)).toEqual({ world: "closed", named: false, any: true });
  });

  test.each([
    ["__lookupGetter__", `console.log(given.__lookupGetter__("a"));`],
    ["__lookupSetter__", `console.log(given.__lookupSetter__("a"));`],
    ["__lookupGetter__, taken out by a pattern", `const { __lookupGetter__: look } = given;\nconsole.log(look.call(given, "a"));`],
    ["__lookupSetter__, taken out by a pattern that is assigned to", `let look: any;\n({ __lookupSetter__: look } = given);\nconsole.log(look.call(given, "a"));`],
  ])("any accessor may be taken out with %s", async (_, text) => {
    expect(await property(text)).toEqual({ world: "closed", named: false, any: true });
  });

  test.each([
    ["an interface", `interface Point { x: number }\nfunction look(point: Point, key: keyof Point) { return typeof point[key]; }\nconsole.log(look({ x: 1 }, given.name));`],
    ["a type alias", `type Point = { x: number };\nfunction look(point: Point, key: keyof Point) { return point[key] === 1; }\nconsole.log(look({ x: 1 }, given.name));`],
    ["an interface, whose parent is changed where nothing sees it", `interface Point { x: number }\nconst point: Point = { x: 1 };\nReflect.set(point, "__proto__", given);\nif (point[given.name as keyof Point]) console.log(1);`],
  ])("an object literal does not keep its prototype: a look under a key may run any getter where its type is %s", async (_, text) => {
    expect(await property(text)).toEqual({ world: "closed", named: false, any: true });
  });

  test.each([
    ["called on it", `const holder: any = {}.constructor;\nconsole.log(holder.getOwnPropertyDescriptor(given, given.name).value);`],
    ["all of them, called on it", `const holder: any = {}.constructor;\nconsole.log(holder.values(holder.getOwnPropertyDescriptors(given))[0].value);`],
    ["taken out of it", `const holder: any = {}.constructor;\nconst take = holder.getOwnPropertyDescriptor;\nconsole.log(take(given, given.name).value);`],
    ["taken out of it by a pattern", `const { getOwnPropertyDescriptor: take }: any = {}.constructor;\nconsole.log(take(given, given.name).value);`],
    ["read from it in brackets", `const holder: any = {}.constructor;\nconsole.log(holder["getOwnPropertyDescriptor"](given, given.name).value);`],
    ["asked of super by a class that extends it", `class Child extends ({}.constructor as any) {\n  static take(from: unknown, name: string) {\n    return (super.getOwnPropertyDescriptor as any)(from, name);\n  }\n}\nconsole.log(Child.take(given, given.name).value);`],
    ["inherited by a class that extends it", `class Child extends ({}.constructor as any) {}\nconsole.log((Child as any).getOwnPropertyDescriptor(given, given.name).value);`],
    ["called on a global of the program's own", `declare let holder: any;\nholder = {}.constructor;\nconsole.log(holder.getOwnPropertyDescriptor(given, given.name).value);`],
  ])("Object may be had without its name: any property may be read with the function that hands out a descriptor %s", async (_, text) => {
    expect((await property(text)).any).toBe(true);
  });

  test("no other property is read where that function of a holder without a name is only looked at", async () => {
    expect((await property(`console.log(typeof given.getOwnPropertyDescriptor, given.getOwnPropertyDescriptors === undefined);`)).any).toBe(false);
  });

  test.each([
    ["a list with a name that is not seen", `console.log(JSON.stringify(given, [given.name]));`],
    ["a list that is not seen", `console.log(JSON.stringify(given, given.names));`],
    ["a variable that may hold a list", `function print(names?: string[]) { return JSON.stringify(given, names); }\nconsole.log(print());`],
    ["arguments that are spread", `console.log(JSON.stringify(...(given as [unknown, string[]])));`],
    ["a list that is spread", `console.log(JSON.stringify(given, [...given.names]));`],
  ])("JSON.stringify reads the members that its second argument lists, inherited accessors too: any property may be read with %s", async (_, text) => {
    expect(await property(text)).toEqual({ world: "closed", named: false, any: true });
  });

  test.each([
    ["taken out", `const print = JSON.stringify;\nconsole.log(print(given, given.names));`],
    ["taken out by a pattern", `const { stringify } = JSON;\nconsole.log(stringify(given, given.names));`],
    ["called through call", `console.log(JSON.stringify.call(null, given, given.names));`],
    ["of a JSON that is handed on", `function print(json: typeof JSON) { return json.stringify(given, given.names); }\nconsole.log(print(JSON));`],
  ])("any property may be read with JSON.stringify %s", async (_, text) => {
    expect(await property(text)).toEqual({ world: "closed", named: false, any: true });
  });

  test("the names in a list that is written are named", async () => {
    expect(await property(`console.log(JSON.stringify(given, ["localeCompare", 0]));`)).toEqual({ world: "closed", named: true, any: false });
  });

  test.each([
    ["no second argument", `console.log(JSON.stringify(given));`],
    ["null and an indentation", `console.log(JSON.stringify(given, null, 2), JSON.stringify(given, undefined, 2));`],
    ["a function written in place", `console.log(JSON.stringify(given, (key, value) => value), JSON.stringify(given, function (key, value) { return value; }));`],
    ["the name of a function", `function keep(key: string, value: unknown) { return value; }\nconst all = (key: string, value: unknown) => value;\nconsole.log(JSON.stringify(given, keep), JSON.stringify(given, all));`],
    ["JSON.parse", `console.log(JSON.parse(given.text), typeof JSON);`],
  ])("no other property is read by JSON.stringify with %s", async (_, text) => {
    expect(await property(text)).toEqual({ world: "closed", named: false, any: false });
  });

  test.each([
    ["a number", `console.log(given[0]);`],
    ["a counter", `for (let i = 0; i < given.length; i++) console.log(given[i]);`],
    ["a counter that goes down", `let i = 10;\nwhile (i--) console.log(given[i]);`],
    ["arithmetic", `for (let i = 0; i < given.length; i += 2) console.log(given[i + 1], given[i * 2], given[given.length - 1], given[i >> 1]);`],
    ["a function of Math", `console.log(given[Math.floor(given.length / 2)]);`],
    ["a well-known symbol", `console.log(given[Symbol.iterator]);`],
    ["a key that is put together around a character that no name holds", "function read(one: string, other: string) { return given[`${one}#${other}`]; }\nconsole.log(read(given.one, given.other));"],
    ["a symbol of the program's own", `const mine = Symbol("mine");\nconsole.log(given[mine]);`],
    ["a store", `function store(key: string) { given[key] = 1; }\nstore("a");`],
    ["a key of a class of the program's own", `class Point { x = 1; y = 2; }\nfunction read(point: Point, key: keyof Point) { return point[key] === 1; }\nconsole.log(read(new Point(), "x"));`],
    ["a number that is handed in", `function read(at: number) { return given[at]; }\nconsole.log(read(1));`],
    ["what has been counted down, whatever it was", `function read(at: any) { for (let i = at; i-- !== 0; ) console.log(given[i]); }\nread(given.length);`],
    ["what has been counted up, whatever it was", `function read(at: any) { at++; console.log(given[at], given[++at], given[at++]); }\nread(given.length);`],
    ["what an operator other than + answers, whatever it is handed", `function read(one: any, other: any) { console.log(given[one - other], given[one * other], given[one % other], given[one | other], given[-one], given[+one], given[~one]); }\nread(given.one, given.other);`],
    ["a sum of what cannot be a text", `function read(one: any, other: any) { console.log(given[(one - 1) + (other >> 1)], given[-one + 1]); }\nread(given.one, given.other);`],
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
    ["is given a function by Object.defineProperty", `module.exports = function () { Object.defineProperty(this, "mine", { value: function () { "use strict"; return this; }, writable: true, configurable: true, enumerable: true }); return this.mine(); };`],
    ["is given a function by Object.defineProperty that another place calls", `(function () { Object.defineProperty(this, "mine", { value: function () { "use strict"; return this; } }); })();\nmodule.exports = globalThis.mine();`],
    ["is handed to what super finds", `module.exports = { me() { return super.valueOf(); } }.me;`],
    ["is handed to what super finds in an arrow function", `module.exports = { me() { return () => super.valueOf(); } }.me;`],
  ])("opens the world when it %s", async (_, lib) => {
    const use = await runtimeUse({ "main.ts": main, "lib.cjs": lib });
    expect(use.world).toBe("open");
    expect(use.whyOpen).toContain(why);
  });

  test("may be given a primitive by Object.defineProperty", async () => {
    const use = await runtimeUse({ "main.ts": main, "lib.cjs": `module.exports = function () { Object.defineProperty(this, "mine", { value: 1, writable: true }); };` });
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
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

  test("super in a method of a class, which is strict, is no such place", async () => {
    const use = await runtimeUse({ "main.ts": main, "lib.cjs": `module.exports = class extends Object { me() { return super.valueOf(); } };` });
    expect(use.whyOpen).not.toContain(why);
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

describe.concurrent("whether text may become code is the user's word", () => {
  const given = `declare const given: any;\n`;
  const allowed = "text-to-code allowed";

  test.each([
    ["the constructor of a function", `console.log((function () {}).constructor("return 1")());`],
    ["the constructor of an async function", `console.log((async function () {}).constructor("return 1"));`],
    ["the constructor of the constructor of a number", `console.log((0).constructor.constructor("return 1")());`],
    ["the constructor of what is not seen", `console.log(given.constructor("return 1"));`],
    ["a name that is computed, read from what is not seen and called", `console.log(given[process.argv[2]]("return 1"));`],
    ["a name that is computed, read from a function", `function mine() {}\nconsole.log((mine as any)[process.argv[2]]);`],
  ])("%s opens nothing: Function may be found, and works", async (_, text) => {
    const use = await of(given + text);
    expect({ world: use.world, whyOpen: use.whyOpen, allowed: use.facts.has(allowed) }).toEqual({ world: "closed", whyOpen: [], allowed: true });
  });

  test.each([
    ["a call of eval", `console.log(eval("1"));`, "a call of eval"],
    ["new Function", `console.log(new Function("return 1")());`, "a call of Function"],
    ["a call of Function", `console.log(Function("return 1")());`, "a call of Function"],
    ["Function that is handed on", `console.log([Function].length);`, "Function"],
  ])("%s, by its binding, opens the world: the text may name anything", async (_, text, why) => {
    const use = await of(text);
    expect({ world: use.world, says: use.whyOpen.includes(why), allowed: use.facts.has(allowed) }).toEqual({ world: "open", says: true, allowed: true });
  });

  test("the fact is there for a program that says nothing of it, and absent under --disallow-code-generation-from-strings", async () => {
    const files = { "main.ts": declared + `console.log("hello");` };
    const [byDefault, withTheFlag] = await Promise.all([runtimeUse(files), runtimeUse(files, ["check", "--aot", "--no-pretty", "--disallow-code-generation-from-strings"])]);
    expect({ byDefault: byDefault.facts.has(allowed), withTheFlag: withTheFlag.facts.has(allowed), worlds: [byDefault.world, withTheFlag.world] }).toEqual({ byDefault: true, withTheFlag: false, worlds: ["closed", "closed"] });
  });
});

describe.concurrent("a module that loads modules, asked of process where the program never comes", () => {
  const asks = `process.getBuiltinModule("node:module").createRequire(import.meta.url)("late-package")`;

  test.each([
    ["in a function that nothing mentions", { "main.ts": declared + `function never() { return ${asks}; }\nconsole.log(1);` }],
    ["in an export that nothing imports", { "main.ts": declared + `import { used } from "./other";\nconsole.log(used());`, "other.ts": `declare const process: any;\nexport function used() { return 1; }\nexport function never() { return ${asks}; }` }],
  ])("%s: the world stays closed", async (_, files) => {
    expect((await runtimeUse(files)).whyOpen).toEqual([]);
  });
});

describe.concurrent("a module that was not there at the build may be there at run time", () => {
  const why = "a module that the executable does not hold, loaded at run time";

  test.each([
    ["require in a try", { "main.ts": declared + `try { console.log(require("late-package")); } catch {}` }],
    ["require whose answer is not used", { "main.ts": declared + `try { require("late-package"); } catch {}` }],
    ["require outside a try", { "main.ts": declared + `console.log(require("late-package"));` }],
    ["require of a file", { "main.ts": declared + `try { console.log(require("./late-file.js")); } catch {}` }],
    ["import()", { "main.ts": declared + `// @ts-ignore\ntry { console.log(await import("late-package")); } catch {}\nexport {};` }],
    ["a require function that the program makes and calls at once", { "main.ts": declared + `import { createRequire } from "node:module";\ntry { console.log(createRequire(import.meta.url)("late-package")); } catch {}` }],
    ["a require function that the program makes and holds", { "main.ts": declared + `import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\ntry { console.log(load("late-package")); } catch {}` }],
  ])("%s opens the world", async (_, files) => {
    const use = await runtimeUse(files);
    expect({ world: use.world, whyOpen: use.whyOpen.filter(it => it === why) }).toEqual({ world: "open", whyOpen: [why] });
  });

  test.each([
    ["a built-in module that is required", { "main.ts": declared + `console.log(typeof require("node:path").join, typeof require("path").join);` }],
    ["names without a prefix that Bun answers itself", { "main.ts": declared + `console.log(typeof require("sys"), typeof require("punycode"), typeof require("_http_server"), typeof require("stream/promises"));` }],
    ["packages that Bun answers itself where they are not installed", { "main.ts": declared + `try { console.log(typeof require("node-fetch"), typeof require("abort-controller"), typeof require("isomorphic-fetch"), typeof require("@vercel/fetch"), typeof require("undici")); } catch {}` }],
    ["a built-in module asked of a require function that the program makes and calls at once", { "main.ts": declared + `import { createRequire } from "node:module";\nconsole.log(typeof createRequire(import.meta.url)("node:path").join);` }],
    ["a built-in module that is imported at run time", { "main.ts": declared + `console.log(typeof (await import("node:path")).join);\nexport {};` }],
    ["a file of the program that is imported at run time", { "main.ts": declared + `console.log((await import("./own")).a);\nexport {};`, "own.ts": `export const a = 1;` }],
    ["a load in a function that nothing mentions", { "main.ts": declared + `function never() { return require("late-package"); }\nconsole.log(1);` }],
  ])("%s does not", async (_, files) => {
    expect((await runtimeUse(files)).whyOpen).toEqual([]);
  });
});

describe.concurrent("the helpers of the bundler, which it imports from bun:wrap into every file with decorators, are compiled with the program", () => {
  test("taken by name they open nothing", async () => {
    const use = await of(`// @ts-ignore\nimport { __legacyDecorateClassTS, __legacyMetadataTS } from "bun:wrap";\nconsole.log(typeof __legacyDecorateClassTS, typeof __legacyMetadataTS);`);
    expect({ world: use.world, whyOpen: use.whyOpen }).toEqual({ world: "closed", whyOpen: [] });
  });

  test.each([
    ["the whole module", `// @ts-ignore\nimport * as helpers from "bun:wrap";\nconsole.log(helpers);`],
    ["its default", `// @ts-ignore\nimport helpers from "bun:wrap";\nconsole.log(helpers);`],
    ["what is exported again", `// @ts-ignore\nexport { __legacyDecorateClassTS } from "bun:wrap";`],
    ["all that is exported again", `// @ts-ignore\nexport * from "bun:wrap";`],
    ["import()", `// @ts-ignore\nconsole.log(await import("bun:wrap"));\nexport {};`],
    ["require", `console.log(require("bun:wrap"));`],
  ])("%s still opens the world", async (_, text) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen.filter(why => why === "bun:wrap") }).toEqual({ world: "open", whyOpen: ["bun:wrap"] });
  });
});

describe.concurrent("process.binding of a written name hands out one of a closed table of native objects", () => {
  test.each([
    ["a name that answers", `console.log(process.binding("buffer").kStringMaxLength);`, "buffer"],
    ["a name that throws", `try { process.binding("zlib"); } catch {}`, "zlib"],
    ["a name that is not in the table", `try { process.binding("mine"); } catch {}`, "mine"],
    ["a variable that holds process", `const same = process;\nconsole.log(same.binding("uv").errname(-2));`, "uv"],
    ["an optional call", `console.log(process.binding?.("config").bits);`, "config"],
  ])("%s", async (_, text, name) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen, isNamed: use.facts.has("process binding:" + name), namesTheFunction: use.facts.has("process binding") }).toEqual({ world: "closed", whyOpen: [], isNamed: true, namesTheFunction: true });
  });
});

describe.concurrent("what runs native code that the compiler has not seen opens the world", () => {
  test.each([
    ["process.dlopen", `process.dlopen(module, "./addon.node");`, "process.dlopen"],
    ["process.dlopen that is taken out", `const { dlopen } = process;\nconsole.log(dlopen);`, "process.dlopen"],
    ["process.dlopen that is imported", `import { dlopen } from "node:process";\nconsole.log(dlopen);`, "process.dlopen"],
    ["process.dlopen of a variable that holds the global object", `const everything: any = globalThis;\neverything.process.dlopen(module, "./addon.node");`, "process.dlopen"],
    ["process.binding of a name that is computed", `console.log(process.binding(process.argv[2]));`, "process.binding"],
    ["process.binding of arguments that are spread", `console.log(process.binding(...["fs"]));`, "process.binding"],
    ["process.binding that is taken out", `const { binding } = process;\nconsole.log(binding("fs"));`, "process.binding"],
    ["process.binding that is kept", `const binding = process.binding;\nconsole.log(binding("fs"));`, "process.binding"],
    ["process.binding that is called by call", `console.log(process.binding.call(process, "fs"));`, "process.binding"],
    ["process.binding that is imported", `import { binding } from "node:process";\nconsole.log(binding("fs"));`, "process.binding"],
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
