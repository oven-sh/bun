import { describe, expect } from "bun:test";
import { declared, of, runtimeUse, withDeclarations } from "./runtime-use-harness";
import { test } from "./supported";

describe.concurrent("a store on a global under a name that is computed", () => {
  const key = `const key: string = process.argv[2];\nconst root: any = globalThis;\n`;

  test.each([
    ["a number on the global object", `root[key] = 1;`, []],
    ["null on the global object", `root[key] = null;`, []],
    ["a string on the global object, written out", `(globalThis as any)[key] = "a";`, []],
    ["a string on process, which has setters of its own", `process[key] = "a";`, ["process *"]],
    ["a boolean on Bun", `Bun[key] = true;`, ["Bun *"]],
    ["a number on process through the global object", `root.process[key] = 1;`, ["process *"]],
  ])("%s hands nothing out: the world stays closed", async (_, text, kept) => {
    const use = await of(key + text);
    expect({ world: use.world, whyOpen: use.whyOpen, kept: kept.filter(fact => use.facts.has(fact)), keepsEveryGlobal: use.facts.has("global *") }).toEqual({ world: "closed", whyOpen: [], kept, keepsEveryGlobal: false });
  });

  test.each([
    ["an object, which under __proto__ stands behind every name", `root[key] = { get mine() { return this; } };\nconsole.log(typeof root.mine);`, "what may be an object or a function, stored on the global object under a name that is computed"],
    ["a function", `root[key] = function (this: any) { return this; };`, "what may be an object or a function, stored on the global object under a name that is computed"],
    ["an arrow function, which an event may be handed to", `root[key] = (event: any) => console.log(event.target);`, "what may be an object or a function, stored on the global object under a name that is computed"],
    ["a value that is not known", `root[key] = JSON.parse(process.argv[3]);`, "what may be an object or a function, stored on the global object under a name that is computed"],
    ["an object on process", `process[key] = { get mine() { return this; } };`, "process"],
    ["an object on Bun", `Bun[key] = { get mine() { return this; } };`, "Bun"],
  ])("the world is open with %s, and no built-in module comes with it", async (_, text, why) => {
    const use = await of(key + text);
    expect({ world: use.world, whyOpen: use.whyOpen, bringsModules: use.facts.has("module node:zlib") }).toEqual({ world: "open", whyOpen: [why], bringsModules: false });
  });

  test.each([
    ["a store that reads first", `root[key] += 1;`],
    ["a store that reads first, by ??=", `root[key] ??= 1;`],
    ["an increment", `root[key]++;`],
    ["a pattern", `[root[key]] = [1];`],
    ["a read", `console.log(root[key]);`],
    ["a call", `root[key]();`],
    ["delete", `delete root[key];`],
  ])("the global object escapes with %s", async (_, text) => {
    const use = await of(key + text);
    expect({ world: use.world, escapes: use.whyOpen.includes("the global object") }).toEqual({ world: "open", escapes: true });
  });

  test.each([
    ["a primitive under a written name", `Object.defineProperty(held, "mine", { value: true, enumerable: false });`, "closed"],
    ["a function under a written name", `Object.defineProperty(held, "mine", { value: function (this: any) { return this; } });`, "open"],
    ["a getter", `Object.defineProperty(held, "mine", { get() { return this; } });`, "open"],
    ["a descriptor that is not written out", `Object.defineProperty(held, "mine", JSON.parse(process.argv[3]));`, "open"],
    ["a name that is computed", `Object.defineProperty(held, key, { value: true });`, "open"],
  ])("Object.defineProperty on a parameter that holds the global object, with %s", async (_, text, world) => {
    expect((await of(key + `function define(held: any) { ${text} }\ndefine(globalThis);`)).world).toBe(world);
  });

  test("the header of a library that exports to the global object by a function brings no built-in module", async () => {
    const use = await runtimeUse(
      {
        "main.cjs": `var assign;
(function (factory) {
  var root = typeof global === "object" ? global : typeof self === "object" ? self : typeof this === "object" ? this : {};
  factory(createExporter(root, createExporter(module.exports)));
  function createExporter(exports, previous) {
    if (exports !== root) Object.defineProperty(exports, "__esModule", { value: true });
    return function (id, v) { return exports[id] = previous ? previous(id, v) : v; };
  }
})(function (exporter) {
  assign = function (a) { return a; };
  exporter("assign", assign);
});
console.log(typeof module.exports.assign);`,
      },
      undefined,
      "main.cjs",
    );
    expect({ whyOpen: [...new Set(use.whyOpen)], bringsModules: use.facts.has("module node:zlib") }).toEqual({ whyOpen: ["what may be an object or a function, stored on the global object under a name that is computed"], bringsModules: false });
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
    ["a number that is defined on a variable that holds it", `const same = process;\nObject.defineProperty(same, "me", { value: 1 });`],
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
    ["a function that is defined on a variable that holds it", `const same = process;\nObject.defineProperty(same, "me", { value: function (this: any) { return this; } });`],
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
    ["a store on the global object under a name that is joined", `(globalThis as any)["mi" + process.argv[2]] = function (this: any) { return this; };`, "what may be an object or a function, stored on the global object under a name that is computed"],
    ["a store on process under a computed name", `process[process.argv[2]] = {};`, "process"],
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
    ["a store through an array pattern", `const seen = function (this: any) { return this; };\n[(globalThis as any).mine] = [seen];\nconsole.log((globalThis as any).mine());`, onTheGlobalObject],
    ["a store through an object pattern", `const seen = function (this: any) { return this; };\n({ a: (globalThis as any).mine } = { a: seen });\nconsole.log((globalThis as any).mine());`, onTheGlobalObject],
    ["a store through a pattern in a pattern", `const seen = function (this: any) { return this; };\n[[(globalThis as any).mine]] = [[seen]];\nconsole.log((globalThis as any).mine());`, onTheGlobalObject],
    ["a store through the head of a loop", `const seen = function (this: any) { return this; };\nfor ((globalThis as any).mine of [seen]);\nconsole.log((globalThis as any).mine());`, onTheGlobalObject],
    ["a store through a pattern to a free name of a native function", `declare let fetch: any;\nconst seen = function (this: any) { return this; };\n[fetch] = [seen];\nconsole.log((globalThis as any).fetch());`, onTheGlobalObject],
    ["a store through the head of a loop to a free name of a native function", `declare let fetch: any;\nconst seen = function (this: any) { return this; };\nfor (fetch of [seen]);\nconsole.log((globalThis as any).fetch());`, onTheGlobalObject],
    ["a store through a pattern on a variable that holds the global object", `const scope: any = globalThis;\nconst seen = function (this: any) { return this; };\n[scope.mine] = [seen];\nconsole.log(scope.mine());`, onTheGlobalObject],
    ["a handler stored through a pattern", `[(globalThis as any).onerror] = [(event: any) => console.log(event.target)];`, onTheGlobalObject],
    ["a store through a pattern on process", `const seen = function (this: any) { return this; };\n[process.mine] = [seen];\nconsole.log(process.mine());`, "process"],
    ["a store through a pattern on Bun", `const seen = function (this: any) { return this; };\n[Bun.mine] = [seen];\nconsole.log(Bun.mine());`, "Bun"],
  ])("the world opens with %s", async (_, text, why) => {
    const use = await of(text);
    expect({ world: use.world, whyOpen: use.whyOpen.filter(it => it === why) }).toEqual({ world: "open", whyOpen: [why] });
  });

  test.each([
    ["a string", `process.title = "a";`],
    ["a member of a global in an array that is no pattern", `const seen = [(globalThis as any).mine, process.title];\nconsole.log(seen.length);`],
    ["a member of a global in an object that is no pattern", `const seen = { a: (globalThis as any).mine };\nconsole.log(seen.a);`],
    ["a store through a pattern under a name that nothing calls", `[(globalThis as any).mine] = [function (this: any) { return this; }];\nconsole.log(typeof (globalThis as any).mine);`],
    ["a member of a global that a pattern reads from", `const [first] = [(globalThis as any).mine];\nconsole.log(first);`],
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
    return { world: [use.world, ...new Set(use.whyOpen)].join(" "), options: of("serve-option").sort(), routeOptions: of("serve-route-option").sort() };
  };
  const optionsOf = (text: string) => optionsIn({ "main.ts": text });
  const worldWith = (routeOptions: string[]) => (routeOptions.includes("style") ? "open a route of Bun.serve with a style" : "closed");

  test.each([
    ["an object literal", `Bun.serve({ ${fetch} }).reload({ ${fetch}, routes: {} });`, ["fetch", "routes"]],
    ["an object literal, on a server that a variable holds", `const server = Bun.serve({ port: 0, ${fetch} });\nserver.reload({ ${fetch}, websocket: {} });`, ["fetch", "port", "websocket"]],
    ["an object literal, in another file", { "main.ts": `import { again } from "./again";\nagain(Bun.serve({ ${fetch} }));`, "again.ts": `export function again(server: any) { server.reload({ tls: {} }); }` }, ["fetch", "tls"]],
    ["no argument", `Bun.serve({ ${fetch} }).reload();`, ["fetch"]],
  ])("what a server is handed anew counts like what it was made with: reload with %s", async (_, files, options) => {
    expect(await optionsIn(typeof files === "string" ? { "main.ts": files } : files)).toEqual({ world: "closed", options, routeOptions: [] });
  });

  test.each([
    ["handed options that are not seen", `Bun.serve({ ${fetch} }).reload(JSON.parse(process.argv[2]));`],
    ["taken out", `const again = Bun.serve({ ${fetch} }).reload;\nconsole.log(typeof again);`.replace("typeof again", "again")],
    ["taken out by a pattern", `const { reload } = Bun.serve({ ${fetch} });\nconsole.log(reload);`],
  ])("any option may be handed to a server with reload %s", async (_, text) => {
    expect((await optionsOf(text)).options).toContain("*");
  });

  test("reload of something else names no option where no server is made", async () => {
    expect(await optionsOf(`declare const page: any;\npage.reload(JSON.parse(process.argv[2]));`)).toEqual({ world: "closed", options: [], routeOptions: [] });
  });

  test.each([
    ["an object literal", `Bun.serve({ port: 0, ${fetch} });`, ["fetch", "port"]],
    ["names in quotes and in brackets", `Bun.serve({ "port": 0, ["hostname"]: "localhost", ${fetch} });`, ["fetch", "hostname", "port"]],
    ["a shorthand", `const port = 0;\nBun.serve({ port, ${fetch} });`, ["fetch", "port"]],
    ["a variable that is also read by name", `const options: any = { port: 0, ${fetch} };\nconsole.log(options.port, options["port"], options?.hostname, typeof options.fetch);\nBun.serve(options);`, ["fetch", "port"]],
    ["a variable that a function reads by name", `const options = { port: 0, ${fetch} };\nconst port = () => options.port;\nBun.serve(options);\nconsole.log(port());`, ["fetch", "port"]],
    ["a literal that is asserted to be something else", `Bun.serve({ tls: {}, ${fetch} } as any);`, ["fetch", "tls"]],
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
    ["a variable whose method is called", `const options: any = { grow() { this.app = {}; }, ${fetch} };\noptions.grow();\nBun.serve(options);`],
    ["a variable whose method is a tag", "const options: any = { grow() { this.app = {}; }, fetch() { return new Response(\"served\"); } };\noptions.grow``;\nBun.serve(options);"],
    ["a variable whose routes are read", `const options: any = { routes: {}, ${fetch} };\noptions.routes["/*"] = JSON.parse(process.argv[2]);\nBun.serve(options);`],
    ["a variable whose routes are read in brackets", `const options: any = { static: {}, ${fetch} };\nconst held = options["static"];\nheld["/*"] = JSON.parse(process.argv[2]);\nBun.serve(options);`],
    ["a variable whose prototype is read", `const options: any = { ${fetch} };\nconsole.log(options.__proto__);\nBun.serve(options);`],
    ["a variable that is stored to through a pattern", `const options: any = { ${fetch} };\n[options.app] = [{}];\nBun.serve(options);`],
    ["a variable that is stored to in the head of a loop", `const options: any = { ${fetch} };\nfor (options.app of [{}]);\nBun.serve(options);`],
    ["a variable a member of which is deleted", `const options: any = { port: 0, ${fetch} };\ndelete options.port;\nBun.serve(options);`],
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
    ["options that are not seen", `Bun.serve(JSON.parse(process.argv[2]));`],
    ["a variable of options that is handed on", `const options = { ${fetch} };\nconsole.log(options);\nBun.serve(options);`],
    ["a route that is not seen", `Bun.serve({ routes: { "/a": JSON.parse(process.argv[2]) }, ${fetch} });`],
    ["Bun.serve that is handed on", `console.log(Bun.serve);`],
  ])("under --disallow-code-generation-from-strings, where what runs files from the disk is left out, the world opens with %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declaredHere + text }, ["check", "--aot", "--no-pretty", "--disallow-code-generation-from-strings"]);
    expect({ world: use.world, whyOpen: [...new Set(use.whyOpen)] }).toEqual({ world: "open", whyOpen: ["options of Bun.serve that are not seen"] });
  });

  test.each([
    ["an object literal", `Bun.serve({ port: 0, app: { framework: "react" } });`],
    ["a literal that is asserted to be something else", `Bun.serve({ app: {}, ${fetch} } as any);`],
    ["a variable that goes nowhere else", `const options = { port: 0, app: {} };\nBun.serve(options);`],
    ["a spread literal", `Bun.serve({ ...{ app: {} }, ${fetch} });`],
  ])("the development server, which bundles and runs files that the compiler has not seen, opens the world: app in %s", async (_, text) => {
    expect(await optionsOf(text)).toMatchObject({ world: "open the app option of Bun.serve", options: expect.arrayContaining(["app"]) });
  });

  test("a server in a function that nothing mentions opens nothing", async () => {
    expect(await optionsOf(`function never(options: object) { Bun.serve({ app: {} }); Bun.serve(options); Bun.serve({ routes: { "/*": { dir: ".", style: "nextjs-pages" } } }); }\nconsole.log(1);`)).toMatchObject({ world: "closed" });
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
    expect(await optionsOf(`Bun.serve({ routes: ${routes}, ${fetch} });`)).toEqual({ world: worldWith(routeOptions), options: ["fetch", "routes"], routeOptions });
    expect(await optionsOf(`Bun.serve({ static: ${routes}, ${fetch} });`)).toEqual({ world: worldWith(routeOptions), options: ["fetch", "static"], routeOptions });
  });

  test.each([
    ["a function that is declared", `function a() { return new Response("a"); }\nBun.serve({ routes: { "/a": a, "/b": { GET: a } } });`, ["GET"]],
    ["a function in a variable", `export const a = () => new Response("a");\nBun.serve({ routes: { "/a": a } });`, []],
    ["routes in a variable", `const routes = { "/a": { GET: () => new Response("a") } };\nBun.serve({ routes });`, ["GET"]],
    ["a route in a variable", `const a = { GET: () => new Response("a") };\nBun.serve({ routes: { "/a": a } });`, ["GET"]],
    ["routes in the variable of the options", `const options = { routes: { "/*": { dir: ".", style: "nextjs-pages" } } };\nBun.serve(options);`, ["dir", "style"]],
    ["routes that are spread", `const shared = { "/a": { GET: () => new Response("a") } };\nBun.serve({ routes: { ...shared, "/b": { POST: () => new Response("b") } } });`, ["GET", "POST"]],
  ])("the options of a route are listed by name for %s", async (_, text, routeOptions) => {
    expect(await optionsOf(text)).toEqual({ world: worldWith(routeOptions), options: ["routes"], routeOptions });
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
