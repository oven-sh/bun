import { describe, expect } from "bun:test";
import { accountsFor, closed, completeness, computedModuleName, escapes, everyMemberOf, globalObject, notYet, open, retainsFeature, type Use } from "./runtime-use-expectations";
import { declared, of, runtimeUse } from "./runtime-use-harness";
import { eachRow, gap, test } from "./supported";

const groups: [name: string, body: () => void][] = [];
const group = (name: string, body: () => void) => void groups.push([name, body]);

const me = `function (this: any) { return this; }`;
const classesOfIntl = ["Collator", "DateTimeFormat", "DisplayNames", "DurationFormat", "ListFormat", "Locale", "NumberFormat", "PluralRules", "RelativeTimeFormat", "Segmenter"];
const listsEveryMember = (use: Use, holder: string) =>
  use.lines.includes(everyMemberOf(holder)) || (holder === "Intl" && classesOfIntl.every(name => use.lines.includes(`Intl ${name}`)));
const usesEveryInstanceMember = (use: Use) => use.lines.includes("property toTemporalInstant");

group("a computed name on the global object, process and Bun", () => {
  const key = `const key: string = process.argv[2];\nconst root: any = globalThis;\n`;

  test.each([
    ["a number stored on an alias", `root[key] = 1;`],
    ["null stored on an alias", `root[key] = null;`],
    ["a string stored on globalThis", `(globalThis as any)[key] = "a";`],
    ["an object", `const trap: any = { get mine() { return this; } };\nroot[key] = trap;\nconsole.log(typeof root.mine);`],
    ["a function", `root[key] = ${me};`],
    ["an arrow function", `root[key] = (event: any) => console.log(event.target);`],
    ["an unknown value", `root[key] = JSON.parse(process.argv[3]);`],
    ["a concatenated name", `(globalThis as any)["mi" + process.argv[2]] = ${me};`],
    ["a symbol whose member is called", `const mine = Symbol("mine");\n(globalThis as any)[mine] = ${me};\nconsole.log((globalThis as any)[mine]());`],
    ["a compound assignment", `root[key] += 1;`],
    ["??=", `root[key] ??= 1;`],
    ["an increment", `root[key]++;`],
    ["a pattern", `[root[key]] = [1];`],
    ["a read", `console.log(root[key]);`],
    ["a call", `root[key]();`],
    ["a variable that is stored to through an assertion", `let member = "Map";\n(member as string) = process.argv[2];\nconsole.log((globalThis as any)[member]);`],
  ])("the report is open with %s on the global object", async (_, text) => {
    expect(completeness(await of(key + text))).toEqual(open(globalObject));
  });

  eachRow([
    gap(notYet.globalObject, ["a string on process", `process[key] = "a";`]),
    gap(notYet.globalObject, ["a boolean on Bun", `Bun[key] = true;`]),
    gap(notYet.globalObject, ["a number on process through an alias of the global object", `root.process[key] = 1;`]),
    gap(notYet.globalObject, ["an object on process", `process[key] = {};`]),
    gap(notYet.globalObject, ["an object on Bun", `Bun[key] = {};`]),
    gap(notYet.globalObject, ["a member of process that is deleted", `delete process[key];`]),
  ])("a store reads no member, so the report stays closed: %s", async (_, text) => {
    expect(completeness(await of(key + text))).toEqual(closed);
  });

  test.each([
    ["process", `process[key] = function (this: any) { return typeof this.report; };\nconsole.log(process[key]());`, "process report"],
    ["process, as a tag", "process[key] = function (this: any) { return typeof this.report; };\nconsole.log(process[key]`a`);", "process report"],
    ["Bun", `Bun[key] = function (this: any) { return typeof this.color; };\nconsole.log(Bun[key]());`, "Bun color"],
  ])("a function that is stored under a computed name and called there may read any member of %s", async (_, text, line) => {
    expect(accountsFor(await of(key + text), line)).toBe(true);
  });

  eachRow([
    gap(notYet.globalObjectForHolder, ["an assertion", `let member = "pid";\n(member as any) = process.argv[2];\nconsole.log(process[member]);`]),
    gap(notYet.globalObjectForHolder, ["an assertion in a pattern", `let member = "pid";\n[member as any] = process.argv;\nconsole.log(process[member]);`]),
  ])("a variable that is stored to through %s is no constant key of process", async (_, text) => {
    const use = await of(text);
    expect({ ...completeness(use), every: listsEveryMember(use, "process") }).toEqual({ ...closed, every: true });
  });

  test("a variable that is stored to through an assertion is no constant key of an unknown object", async () => {
    const use = await of(`declare const input: any;\nlet member = "at";\n(member as any) = process.argv[2];\nconsole.log(input[member]);`);
    expect({ ...completeness(use), every: usesEveryInstanceMember(use) }).toEqual({ ...closed, every: true });
  });

  test.each([
    ["a variable that is never stored to", `let member = "pid";\nconsole.log(process[member]);`],
    ["a constant", `const member = "pid";\nconsole.log(process[member]);`],
    ["a variable that is only read through an assertion", `let member = "pid";\nconsole.log(member as any, process[member]);`],
  ])("%s is a constant key", async (_, text) => {
    const use = await of(text);
    expect({ ...completeness(use), named: use.lines.includes("process pid"), every: listsEveryMember(use, "process") }).toEqual({ ...closed, named: true, every: false });
  });

  test("the header of a library that exports to the global object brings no built-in module", async () => {
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
    expect({ ...completeness(use), bringsModules: use.lines.includes("module node:zlib") }).toEqual({ ...closed, bringsModules: false });
  });
});

group("a holder that is passed on", () => {
  eachRow([
    ["the global object, to a function that reads a member", `function read(scope: any) { return typeof scope.fetch; }\nconsole.log(read(globalThis));`, closed],
    ["the global object, to a function that defines a primitive on it", `function define(scope: any) { Object.defineProperty(scope, "mine", { value: true, enumerable: false }); }\ndefine(globalThis);`, closed],
    ["the global object, to a function declaration that is stored to", `function read(input: any) { return typeof input; }\n(read as any) = (input: any) => input;\nconsole.log(read(globalThis));`, open(globalObject)],
    ["the global object, as the receiver of call()", `declare let fetch: any;\n(globalThis as any).fetch = function (this: any) { console.log(this); };\nfetch.call(globalThis, "data:,");`, open(globalObject)],
    ["the global object, as the receiver of bind()", `declare let setTimeout: any;\nsetTimeout = function (this: any) { console.log(this); };\nsetTimeout.bind(globalThis)();`, open(globalObject)],
    ["the prototype of the global object, only compared", `console.log(Object.getPrototypeOf(globalThis) === Object.prototype);`, closed],
    ["the descriptor of a member of Bun", `console.log(typeof Object.getOwnPropertyDescriptor(Bun, "serve")!.value);`, closed],
    ["the prototype of process, only compared", `console.log(Object.getPrototypeOf(process) === null);`, closed],
    ["a number defined on process", `Object.defineProperty(process, "mine", { value: 1 });\nconsole.log(process.mine);`, closed],
    gap(notYet.globalObjectForHolder, ["a method defined on process", `Object.defineProperty(process, "mine", { value(this: any) { return this; } });\nconsole.log(process.mine());`, escapes("process")]),
    gap(notYet.globalObjectForHolder, ["an accessor defined on process", `Object.defineProperty(process, "me", { get() { return this; } });\nconsole.log(process.me);`, escapes("process")]),
    ["process in a variable that is not a constant", `let same = process;\nconsole.log(same.pid);`, closed],
    ["process as one arm of a conditional", `const same = process.argv[2] ? process : null;\nconsole.log(same?.pid);`, closed],
  ])("the report says what can be reached with %s", async (_, text, expected) => {
    expect(completeness(await of(text))).toEqual(expected);
  });
});

group("process and its listeners", () => {
  const reads = `console.log(typeof this.report);`;

  test.each([
    ["an arrow function", `process.on("exit", () => console.log(1));`],
    ["a function that does not mention this", `process.on("exit", function () { console.log(1); });`],
    ["a function in which only a nested function mentions this", `process.on("exit", function () { console.log(function (this: any) { return this; }); });`],
    ["a declared function that does not mention this", `function stop() { console.log(1); }\nprocess.once("SIGINT", stop);`],
    ["a constant with an arrow function", `const stop = () => console.log(1);\nprocess.addListener("SIGINT", stop);`],
    ["a listener that is removed", `const stop = () => console.log(1);\nprocess.off("SIGINT", stop);`],
    ["typeof process.on", `console.log(typeof process.on);`],
    ["on() after a comma, as a statement", `console.log(1), process.on("exit", () => {});`],
    ["on() before a comma", `console.log((process.on("exit", () => {}), 1));`],
    ["on() after &&, as a statement", `process.title && process.on("exit", () => {});`],
    ["on() in both arms of a conditional, as a statement", `process.title ? process.on("exit", () => {}) : process.once("exit", () => {});`],
    ["on() under void", `console.log(void process.on("exit", () => {}));`],
    ["on() of an alias of process", `const same = process;\nsame.on("exit", () => {});`],
  ])("the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });

  test.each([
    ["a function expression", `process.on("exit", function (this: any) { ${reads} });`],
    ["an arrow function in a function expression", `process.on("exit", function (this: any) { const read = () => typeof this.report; console.log(read()); });`],
    ["a declared function", `function stop(this: any) { ${reads} }\nprocess.on("SIGINT", stop);`],
    ["a parameter", `function listen(listener: any) { process.on("exit", listener); }\nlisten(function (this: any) { ${reads} });`],
    ["a member of an object", `const mine = { stop(this: any) { ${reads} } };\nprocess.on("exit", mine.stop);`],
    ["a variable that is stored to twice", `let stop: any = () => {};\nstop = function (this: any) { ${reads} };\nprocess.on("exit", stop);`],
    ["a variable that is stored to through an assertion", `let stop = () => {};\n(stop as any) = function (this: any) { ${reads} };\nprocess.on("exit", stop);`],
    ["spread arguments", `const args: any[] = ["exit", function (this: any) { ${reads} }];\nprocess.on(...args);`],
    ["once()", `process.once("exit", function (this: any) { ${reads} });`],
    ["prependListener()", `process.prependListener("exit", function (this: any) { ${reads} });`],
  ])("this of a listener is process: %s", async (_, text) => {
    expect(accountsFor(await of(text), "process report")).toBe(true);
  });

  test.each([
    ["in a chain", `console.log(typeof process.on("exit", () => {}).report);`],
    ["in a constant", `const same = process.on("exit", () => {});\nconsole.log(typeof same.report);`],
    ["after a comma", `console.log(typeof (console.log(1), process.on("exit", () => {})).report);`],
    ["after &&", `console.log(typeof (process.title && process.on("exit", () => {})).report);`],
    ["in an arm of a conditional", `const same = process.title ? process.on("exit", () => {}) : null;\nconsole.log(typeof same?.report);`],
    ["of an arrow function", `const listen = () => process.on("exit", () => {});\nconsole.log(typeof listen().report);`],
    ["that is printed", `console.log(process.on("exit", () => {}));`],
  ])("what on() returns is process: the result %s", async (_, text) => {
    expect(accountsFor(await of(text), "process report")).toBe(true);
  });
});

group("a function of the program's own on a holder", () => {
  const seen = `const seen = ${me};\n`;

  eachRow([
    gap(notYet.globalObjectForHolder, ["a function on process", `process.mine = ${me};\nconsole.log(process.mine());`, escapes("process")]),
    gap(notYet.globalObjectForHolder, ["a function on process, as a tag", "process.mine = " + me + ";\nconsole.log(process.mine`a`);", escapes("process")]),
    gap(notYet.globalObjectForHolder, ["a pattern that stores on process", `${seen}[process.mine] = [seen];\nconsole.log(process.mine());`, escapes("process")]),
    gap(notYet.globalObjectForHolder, ["toString of process, which toLocaleString calls", `process.toString = function (this: any) { console.log(this); return "a"; };\nprocess.toLocaleString();`, escapes("process")]),
    ["a function on an alias of the global object", `const scope: any = globalThis;\nscope.mine = ${me};\nconsole.log(scope.mine());`, open(globalObject)],
    ["a free name that is stored to", `// @ts-ignore\nmine = ${me};\nconsole.log((globalThis as any).mine());`, open(globalObject)],
    ["an array pattern that stores on the global object", `${seen}[(globalThis as any).mine] = [seen];\nconsole.log((globalThis as any).mine());`, open(globalObject)],
    ["an object pattern that stores on the global object", `${seen}({ a: (globalThis as any).mine } = { a: seen });\nconsole.log((globalThis as any).mine());`, open(globalObject)],
    ["a nested pattern that stores on the global object", `${seen}[[(globalThis as any).mine]] = [[seen]];\nconsole.log((globalThis as any).mine());`, open(globalObject)],
    ["the head of a loop that stores on the global object", `${seen}for ((globalThis as any).mine of [seen]);\nconsole.log((globalThis as any).mine());`, open(globalObject)],
    ["a pattern that stores on an alias of the global object", `const scope: any = globalThis;\n${seen}[scope.mine] = [seen];\nconsole.log(scope.mine());`, open(globalObject)],
    ["a pattern that replaces a native function by its free name", `declare let fetch: any;\n${seen}[fetch] = [seen];\nconsole.log((globalThis as any).fetch());`, open(globalObject)],
    ["the head of a loop that replaces a native function by its free name", `declare let fetch: any;\n${seen}for (fetch of [seen]);\nconsole.log((globalThis as any).fetch());`, open(globalObject)],
    ["valueOf of the global object as a tag", "console.log((globalThis as any).valueOf`a`);", open(globalObject)],
  ])("the holder is this of what is called on it, so the report is open with %s", async (_, text, expected) => {
    expect(completeness(await of(text))).toEqual(expected);
  });

  test("a call in another file is followed too, and handing Bun on names no member of it", async () => {
    const use = await runtimeUse({ "main.ts": declared + `import { later } from "./other";\nBun.mine = ${me};\nconsole.log(later());`, "other.ts": declared + `export function later() { return Bun.mine(); }` });
    expect(completeness(use)).toEqual(closed);
  });

  test("a function that is called on console may read any member of it", async () => {
    const use = await of(`console.mine = ${me};\nconsole.log(String(console.mine()));`);
    expect({ ...completeness(use), every: listsEveryMember(use, "console") }).toEqual({ ...closed, every: true });
  });

  test.each([
    ["emit of process", `process.emit = function (this: any) { console.log(typeof this.report); return true; };`, "process report"],
    ["a handler of the global object, whose events have it as their target", `declare const self: any;\nself.onmessage = (event: any) => console.log(typeof event.target.HTMLRewriter);`, "global HTMLRewriter"],
    ["a handler under its free name", `declare let onmessage: any;\nonmessage = (event: any) => console.log(typeof event.target.HTMLRewriter);`, "global HTMLRewriter"],
    ["a handler for errors on an alias of the global object", `const scope: any = globalThis;\nscope.onerror = function (event: any) { console.log(typeof event.target.HTMLRewriter); };`, "global HTMLRewriter"],
    ["a handler that a pattern stores", `[(globalThis as any).onerror] = [(event: any) => console.log(typeof event.target.HTMLRewriter)];`, "global HTMLRewriter"],
  ])("native code calls %s", async (_, text, line) => {
    expect(accountsFor(await of(text), line)).toBe(true);
  });

  eachRow([
    ["a string", `process.title = "a";`],
    ["a concatenation", `process.title = "a" + process.pid;`],
    ["the result of String()", `Bun.mine = String(JSON.parse(process.argv[2]));`],
    ["an unknown exit code and title", `process.exitCode = JSON.parse(process.argv[2]);\nprocess.title = JSON.parse(process.argv[3]);`],
    ["a member that is stored and read", `process.exitCode = 1;\nconsole.log(process.exitCode);`],
    ["a member that is stored, and another that is called", `process.title = "a";\nprocess.exit(0);`],
    ["an exit code from a call", `function status() { return process.argv.length; }\nprocess.exitCode = status();`],
    ["an exit code from a parameter", `function finish(code: any) { process.exitCode = code; }\nfinish(0);`],
    ["an exit code from a member", `const result = JSON.parse(process.argv[2]);\nprocess.exitCode = result.status;`],
    ["a title from a constant", `const title = process.argv[1];\nprocess.title = title;`],
    ["a declared function that nothing calls on the holder", `function mine() { return 1; }\nBun.mine = mine;`],
    ["a function whose nested function has a receiver of its own", `Bun.mine = function () { return function (this: any) { return this; }; };`],
    ["a function that is called without the holder", `Bun.mine = ${me};\nconst { mine } = Bun;\nconsole.log(mine());`],
    ["a function that a pattern stores and nothing calls", `[(globalThis as any).mine] = [${me}];\nconsole.log(typeof (globalThis as any).mine);`],
    ["a class", `(globalThis as any).Mine = class { me() { return this; } };`],
    ["an object", `(globalThis as any).mine = { me() { return this; } };`],
    ["an array", `(globalThis as any).mine = [1];`],
    ["a cache on the global object", `(globalThis as any).cache ??= new Map();\nconsole.log((globalThis as any).cache.size);`],
    ["the result of a call, on the global object", `(globalThis as any).startedAt = Date.now();`],
    gap(notYet.globalObject, ["a handler that is cleared", `declare const self: any;\nself.onmessage = null;`]),
    ["a handler of another object", `declare const input: any;\ninput.onmessage = (event: any) => console.log(event.target);`],
    ["an export of a built-in module under the name of a global", `import { Buffer as FromNode } from "node:buffer";\n(globalThis as any).Buffer ??= FromNode;`],
    ["a global under the name of another", `declare const setTimeout: any;\n(globalThis as any).setImmediate = setTimeout;`],
    ["a member of a holder in an array that is no pattern", `const list = [(globalThis as any).mine, process.title];\nconsole.log(list.length);`],
    ["a member of a holder in an object that is no pattern", `const record = { a: (globalThis as any).mine };\nconsole.log(record.a);`],
    ["a member of a holder that a pattern reads from", `const [first] = [(globalThis as any).mine];\nconsole.log(first);`],
  ])("the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});

group("operators that pass a holder to code of the program's own", () => {
  const has = (member: string) => `class Has { static [Symbol.hasInstance](value: any) { return value.${member} !== undefined; } }\n`;

  test.each([
    ["the global object on the left of instanceof", has("HTMLRewriter") + `console.log(globalThis instanceof Has);`, "global HTMLRewriter"],
    ["an alias of the global object on the left of instanceof", has("HTMLRewriter") + `const scope: any = globalThis;\nconsole.log(scope instanceof Has);`, "global HTMLRewriter"],
    ["process on the left of instanceof", has("report") + `console.log(process instanceof Has);`, "process report"],
    ["Bun on the left of instanceof", has("color") + `console.log(Bun instanceof Has);`, "Bun color"],
    ["process compared loosely with a number", `process.valueOf = function (this: any) { return typeof this.report; };\nconsole.log(process == 1);`, "process report"],
    ["process in a template", "process.toString = function (this: any) { return typeof this.report; };\nconsole.log(`${process}`);", "process report"],
  ])("%s", async (_, text, line) => {
    expect(accountsFor(await of(text), line)).toBe(true);
  });

  test.each([
    ["process compared with null and undefined, and strictly", `console.log(process == null, process != undefined, process === 1);`],
    ["addEventListener called on an object", `declare const EventTarget: any;\nnew EventTarget().addEventListener("a", () => {});`],
    ["the type of a member named addEventListener", `declare const input: any;\nconsole.log(typeof input.addEventListener);`],
  ])("the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});

group("Bun's own JavaScript reads members for the program", () => {
  test.each([
    ["a string that is printed", `console.log("a");`],
    ["an object that is printed", `console.log({ a: [1, "b", new Map()] });`],
    ["an error that is printed", `console.error(new Error("a"));`],
    ["a custom inspector", `const custom = Symbol.for("nodejs.util.inspect.custom");\nconsole.log({ [custom]() { return "a"; } });`],
  ])("the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});

group("a member with the name of one that evaluates text or loads code", () => {
  const input = `const input: any = JSON.parse(process.argv[2]);\n`;

  test.each([
    ["eval", `console.log(input.eval("1"));`],
    ["Function", `console.log(new input.Function("return 1"));`],
    ["require", `console.log(input.require("node:fs"));`],
    ["dlopen", `input.dlopen({ exports: {} }, "./addon.node");`],
    ["binding in a pattern", `const { binding } = input;\nconsole.log(binding);`],
    ["Worker", `console.log(new input.Worker("./a.js"));`],
    ["plugin", `input.plugin({});`],
    ["the type of require and a comparison of eval", `console.log(typeof input.require, input.eval === undefined);`],
    ["require of an instance of a class of the program's own", `class Mine { require(name: string) { return name; } }\nconsole.log(new Mine().require("a"));`],
    ["eval in a function that nothing calls", `function never() { return input.eval("1"); }\nconsole.log(1);`],
  ])("an unknown value is no holder, so the report stays closed with %s", async (_, text) => {
    expect(completeness(await of(input + text))).toEqual(closed);
  });

  test("a parameter that is stored to through an assertion is a computed name for require", async () => {
    expect(completeness(await of(`function load(name: string) {\n  (name as any) = process.argv[2];\n  return require(name);\n}\nconsole.log(load("node:path"));`))).toEqual(open(computedModuleName));
  });
});

group("members of performance", () => {
  const members = async (text: string, declarations = `declare const performance: any;\n`) => {
    const use = await of(declarations + text);
    return { ...completeness(use), mark: use.lines.includes("property mark"), every: listsEveryMember(use, "Performance.prototype") };
  };

  test.each([
    ["a call", `performance.mark("a");`],
    ["brackets", `performance["mark"]("a");`],
    ["a pattern", `const { mark } = performance;\nconsole.log(mark);`],
    ["the global object", `(globalThis as any).performance.mark("a");`],
    ["an optional call", `performance?.mark?.("a");`],
    ["an alias", `const timer = performance;\ntimer.mark("a");`],
    ["an alias of the global object", `const everything: any = globalThis;\neverything.performance.mark("a");`],
  ])("a member is named by %s", async (_, text) => {
    expect(await members(text)).toEqual({ ...closed, mark: true, every: false });
  });

  test.each([
    ["another member", `console.log(performance.now());`],
    ["typeof", `console.log(typeof performance);`],
    ["a member of another object", `const mine: any = { mark() {} };\nmine.mark();`],
  ])("a member is not named by %s", async (_, text) => {
    expect(await members(text)).toEqual({ ...closed, mark: false, every: false });
  });

  test("a member is not named by an object of the program's own", async () => {
    expect(await members(`export {};\nconst performance = { mark() {} };\nperformance.mark();`, "")).toEqual({ ...closed, mark: false, every: false });
  });

  test.each([
    ["its prototype is read through an alias", `const timer = performance;\nconsole.log(Reflect.getPrototypeOf(timer));`],
  ])("any member may be used, and the report stays closed, when %s", async (_, text) => {
    expect(await members(text)).toMatchObject({ ...closed, every: true });
  });

  test("node:perf_hooks exports the object, and a call on it is no use of every member", async () => {
    const use = await runtimeUse({ "main.ts": `import { performance as timeline } from "node:perf_hooks";\ntimeline.mark("a", { detail: { deep: 1 } });` });
    expect({ ...completeness(use), every: listsEveryMember(use, "Performance.prototype") }).toEqual({ ...closed, every: false });
  });
});

group("exports of node:module", () => {
  test.each([
    ["a type", `import type { SourceMap } from "node:module";\nlet map: SourceMap | undefined;\nconsole.log(map);`],
    ["an object of the program's own", `const mine = { SourceMap: 1 };\nconsole.log(mine.SourceMap);`],
    ["another module", `import { SourceMap } from "./other";\nconsole.log(SourceMap);`],
  ])("the report stays closed with %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared + text, "other.ts": `export const SourceMap = 1;` });
    expect({ ...completeness(use), listed: use.lines.filter(line => line.startsWith("node:module ")) }).toEqual({ ...closed, listed: [] });
  });
});

group("members of Intl", () => {
  let plainReport: Promise<Use> | undefined;
  const named = (use: Use, names: string[]) => ({ ...completeness(use), global: use.lines.includes("global Intl"), named: names.filter(name => use.lines.includes("Intl " + name)) });

  test.each([
    ["new", `new Intl.Segmenter("en");`, ["Segmenter"]],
    ["a call", `console.log(Intl.getCanonicalLocales("en"));`, ["getCanonicalLocales"]],
    ["brackets", `new Intl["Collator"]();`, ["Collator"]],
    ["a pattern", `const { DateTimeFormat, NumberFormat: Numbers } = Intl;\nnew DateTimeFormat();\nnew Numbers();`, ["DateTimeFormat", "NumberFormat"]],
    ["the global object", `new (globalThis as any).Intl.ListFormat();`, ["ListFormat"]],
    ["a member of a member", `console.log(Intl.DateTimeFormat.supportedLocalesOf("en"));`, ["DateTimeFormat"]],
    ["the type of an optional member", `console.log(typeof Intl?.DisplayNames);`, ["DisplayNames"]],
    ["an alias", `const services = Intl;\nnew services.Segmenter();`, ["Segmenter"]],
    ["an alias of the global object", `const everything: any = globalThis;\nnew everything.Intl.Segmenter();`, ["Segmenter"]],
  ])("a member is named by %s", async (_, text, names) => {
    const use = await of(text);
    expect({ ...named(use, names), every: listsEveryMember(use, "Intl") }).toEqual({ ...closed, global: true, named: names, every: false });
  });

  test("a member is named by instanceof", async () => {
    expect(named(await of(`console.log({} instanceof Intl.Locale);`), ["Locale"])).toEqual({ ...closed, global: true, named: ["Locale"] });
  });

  test.each([
    ["typeof", `console.log(typeof Intl);`],
    ["an object of the program's own", `export {};\nconst Intl = { Segmenter: class {} };\nnew Intl.Segmenter();`],
    ["a member of another object", `const mine: any = { Segmenter: class {} };\nnew mine.Segmenter();`],
    ["a type", `let segmenter: typeof Intl.Segmenter | undefined;\nconsole.log(segmenter);`],
    ["a function that nothing calls", `function never() { return new Intl.Segmenter(); }\nconsole.log(1);`],
  ])("no member is named by %s", async (_, text) => {
    const [plain, use] = await Promise.all([(plainReport ??= of(`console.log(1);`)), of(text)]);
    expect({ ...completeness(use), added: use.lines.filter(line => line.startsWith("Intl ") && !plain.lines.includes(line)) }).toEqual({ ...closed, added: [] });
  });

  test.each([
    ["a key is computed", `new (Intl as any)[process.argv[2]]();`],
  ])("any member may be used, and the report stays closed, when %s", async (_, text) => {
    const use = await of(text);
    expect({ ...completeness(use), every: listsEveryMember(use, "Intl") }).toEqual({ ...closed, every: true });
  });
});

group("Bun.serve", () => {
  const fetch = `fetch() { return new Response("served"); }`;
  const serves = async (files: Record<string, string>) => {
    const use = await runtimeUse(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, declared + `declare const Response: any;\n` + text])));
    return { ...completeness(use), named: use.lines.includes("Bun serve"), retained: retainsFeature(use.lines, "Serve") };
  };
  const bundles = async (text: string) => {
    const use = await runtimeUse({ "main.ts": declared + `declare const Response: any;\n` + text });
    return retainsFeature(use.lines, "Bundler");
  };

  test.each([
    ["a call", `Bun.serve({ port: 0, ${fetch} });`],
    ["a callee with an assertion", `(Bun.serve as any)({ port: 0, ${fetch} });`],
    ["brackets", `Bun["serve"]({ port: 0, ${fetch} });`],
    ["the global object", `(globalThis as any).Bun.serve({ port: 0, ${fetch} });`],
    ["an alias of the global object", `const everything: any = globalThis;\neverything.Bun.serve({ ${fetch} });`],
    ["an import", `import { serve } from "bun";\nserve({ port: 0, ${fetch} });`],
    ["an import under another name", `import { serve as start } from "bun";\nstart({ port: 0, ${fetch} });`],
    ["the default import", `import runtime from "bun";\nruntime.serve({ port: 0, ${fetch} });`],
    ["a pattern", `const { serve } = Bun;\nserve({ port: 0, ${fetch} });`],
    ["a pattern that renames it", `const { serve: start } = Bun;\nstart({ port: 0, ${fetch} });`],
    ["a pattern with a default", `const { serve = console.log } = Bun;\nserve({ ${fetch} });`],
    ["a pattern that is exported", `export const { serve } = Bun;\nserve({ ${fetch} });`],
    ["an alias", `const start = Bun.serve;\nstart({ ${fetch} });`],
    ["call()", `Bun.serve.call(undefined, { ${fetch} });`],
    ["apply()", `Bun.serve.apply(undefined, [{ ${fetch} }]);`],
    ["bind()", `Bun.serve.bind(undefined)({ ${fetch} });`],
    ["new", `new Bun.serve({ ${fetch} });`],
    ["a tag", "Bun.serve`options`;"],
  ])("is listed and retained with %s", async (_, text) => {
    expect(await serves({ "main.ts": text })).toEqual({ ...closed, named: true, retained: true });
  });

  test.each([
    ["typeof and comparisons", `console.log(typeof Bun.serve, Bun.serve === undefined, !Bun.serve);`],
    ["an argument of console.log, which calls nothing", `console.log(Bun.serve);`],
  ])("is not retained where nothing can call it: the name stays without the code, with %s", async (_, text) => {
    expect(await serves({ "main.ts": text })).toMatchObject({ ...closed, retained: false });
  });

  test.each([
    ["no argument", `try { Bun.serve(); } catch {}`],
    ["a parameter", `function start(options: any) { Bun.serve(options); }\nstart({ ${fetch} });`],
    ["the result of a call", `Bun.serve(JSON.parse(process.argv[2]));`],
    ["an instance", `class Options { ${fetch} }\nBun.serve(new Options());`],
    ["spread arguments", `const all = [{ ${fetch} }];\nBun.serve(...all);`],
    ["a computed name", `Bun.serve({ [process.argv[2]]: {}, ${fetch} });`],
    ["a spread of an unknown value", `Bun.serve({ ...JSON.parse(process.argv[2]), ${fetch} });`],
    ["a getter", `Bun.serve({ get port() { return 0; }, ${fetch} });`],
    ["a constant that is passed on", `const options = { ${fetch} };\nconsole.log(options);\nBun.serve(options);`],
    ["a constant that is exported", `export const options = { ${fetch} };\nBun.serve(options);`],
    ["unknown routes", `Bun.serve({ routes: JSON.parse(process.argv[2]), ${fetch} });`],
    ["a route with a directory and a style", `Bun.serve({ routes: { "/*": { dir: ".", style: "nextjs-pages" } } });`],
    ["options that are replaced", `Bun.serve({ ${fetch} }).reload(JSON.parse(process.argv[2]));`],
  ])("its options make no difference: %s", async (_, text) => {
    expect(await serves({ "main.ts": text })).toEqual({ ...closed, named: true, retained: true });
  });

  test.each([
    ["written in the literal", `Bun.serve({ port: 0, app: { framework: "react" } });`],
    ["copied into the literal", `const development = { app: { framework: "react" } };\nBun.serve({ port: 0, ...development });`],
  ])("the option app starts the development server, which runs code that is not in the executable: %s", async (_, text) => {
    expect(await serves({ "main.ts": text })).toMatchObject({ whyOpen: expect.arrayContaining([expect.stringMatching(/^runtime-code: /)]), named: true, retained: true });
    expect(await bundles(text)).toBe(true);
  });

  test.each([
    ["a plain server", `Bun.serve({ port: 0, ${fetch} });`],
    ["a plain server beside evaluated text", `new Function("return 1")();\nBun.serve({ port: 0, ${fetch} });`],
  ])("the bundler is not retained for %s", async (_, text) => {
    expect(await bundles(text)).toBe(false);
  });

  test("is listed where another file exports it again under another name", async () => {
    expect(await serves({ "main.ts": `import { listen } from "./other";\nlisten({ fetch: () => new Response("") });`, "other.ts": `export { serve as listen } from "bun";` })).toEqual({ ...closed, named: true, retained: true });
  });

  test.each([
    ["a function that nothing calls", `function never(options: object) { Bun.serve({ app: {} }); Bun.serve(options); }\nconsole.log(1);`],
    ["an object of the program's own", `const mine = { serve(options: object) { console.log(options); } };\nmine.serve({ app: {}, routes: { "/*": { dir: ".", style: "nextjs-pages" } } });`],
    ["reload of another object", `declare const page: any;\npage.reload(JSON.parse(process.argv[2]));`],
  ])("is not listed with %s", async (_, text) => {
    expect(await serves({ "main.ts": text })).toEqual({ ...closed, named: false, retained: false });
  });
});

group("other names for Bun and process", () => {
  const used = async (files: Record<string, string>) => {
    const use = await runtimeUse(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, declared + text])));
    return { ...completeness(use), color: use.lines.includes("Bun color"), report: use.lines.includes("process report"), mayPaint: accountsFor(use, "Bun color"), mayReport: accountsFor(use, "process report") };
  };
  const paints = `console.log(B.color("red", "hex"));`;

  test.each([
    ["an alias", `const B = Bun;\n${paints}`],
    ["a pattern", `const { color } = Bun;\nconsole.log(color("red", "hex"));`],
    ["the default export", `import B from "bun";\n${paints}`],
    ["the default export, imported by name", `import { default as B } from "bun";\n${paints}`],
    ["the namespace", `import * as B from "bun";\n${paints}`],
    ["a named import", `import { color } from "bun";\nconsole.log(color("red", "hex"));`],
    ["require", `console.log(require("bun").color("red", "hex"));`],
    ["process.getBuiltinModule", `console.log(process.getBuiltinModule("bun").color("red", "hex"));`],
    ["process.getBuiltinModule in a constant", `const B = process.getBuiltinModule("bun");\nconsole.log(B ? B.color("red", "hex") : "none");`],
    ["import name = require", `import B = require("bun");\n${paints}`],
  ])("a member of Bun is listed through %s", async (_, text) => {
    expect(await used({ "main.ts": text })).toEqual({ ...closed, color: true, report: false, mayPaint: true, mayReport: false });
  });

  test("a member of Bun is listed where another file exports it again under another name", async () => {
    expect(await used({ "main.ts": `import { paintIt } from "./other";\nconsole.log(paintIt("red", "hex"));`, "other.ts": `export { color as paintIt } from "bun";` })).toEqual({ ...closed, color: true, report: false, mayPaint: true, mayReport: false });
  });

  test.each([
    ["the default export, imported by name", `import { default as p } from "node:process";\nconsole.log(typeof p.report.getReport);`],
    ["default of the namespace", `import * as p from "node:process";\nconsole.log(typeof p.default.report.getReport);`],
    ["process.getBuiltinModule", `console.log(typeof process.getBuiltinModule("node:process").report.getReport);`],
    ["process.getBuiltinModule of the short name", `console.log(typeof process.getBuiltinModule("process").report.getReport);`],
    ["import name = require", `import p = require("node:process");\nconsole.log(typeof p.report.getReport);`],
  ])("a member of process is listed through %s", async (_, text) => {
    expect(await used({ "main.ts": text })).toEqual({ ...closed, color: false, report: true, mayPaint: false, mayReport: true });
  });

  eachRow([
    ["its default export is exported again", `export { default } from "bun";`, `import B from "./other";\n${paints}`],
    ["its default export is exported again under a name", `export { default as B } from "bun";`, `import { B } from "./other";\n${paints}`],
    ["its namespace is exported", `export * as B from "bun";`, `import { B } from "./other";\n${paints}`],
    ["an import of it is exported", `import B from "bun";\nexport { B };`, `import { B } from "./other";\n${paints}`],
    ["an import of its namespace is exported under another name", `import * as all from "bun";\nexport { all as B };`, `import { B } from "./other";\n${paints}`],
    ["an import of its default export by name is exported", `import { default as all } from "bun";\nexport { all as B };`, `import { B } from "./other";\n${paints}`],
    ["an import of it is the default export", `import B from "bun";\nexport default B;`, `import B from "./other";\n${paints}`],
  ])("what is called on Bun is accounted for when %s", async (_, other, main) => {
    expect(await used({ "main.ts": main, "other.ts": other })).toMatchObject({ mayPaint: true });
  });

  eachRow([
    ["an import of it is an argument", `import { default as B } from "bun";\nfunction paint(b: any) { return b.color("red", "hex"); }\nconsole.log(paint(B));`],
    ["await import() is destructured", `const { color } = await import("bun");\nconsole.log(color("red", "hex"));\nexport {};`],
    ["await import() is in a constant", `const B = await import("bun");\n${paints}\nexport {};`],
    ["await import() is read at once", `console.log((await import("bun")).color("red", "hex"));\nexport {};`],
    ["await import() is in a function", `async function paint() { const { color } = await import("bun"); return color("red", "hex"); }\nconsole.log(await paint());\nexport {};`],
    ["the promise of import() is asked for it", `import("bun").then((B: any) => console.log(B.color("red", "hex")));`],
    ["the promise of import() is in a constant", `const promise = import("bun");\nconsole.log((await promise).color("red", "hex"));\nexport {};`],
    ["the promise of import() is passed on", `const [B] = await Promise.all([import("bun")]);\n${paints}\nexport {};`],
    ["it is the default of a parameter", `function paint(b: any = Bun) { return b.color("red", "hex"); }\nconsole.log(paint());`],
    ["it is the default of a parameter that is also a property of the class", `class Painter { constructor(public b: any = Bun) {} }\nconsole.log(new Painter().b.color("red", "hex"));`],
    ["module.require loads it", `console.log(module.require("bun").color("red", "hex"));`],
    ["a require that the program creates loads it", `import { createRequire } from "node:module";\nconst load = createRequire((import.meta as any).url);\nconsole.log(load("bun").color("red", "hex"));`],
  ])("what is called on Bun is accounted for when %s", async (_, text) => {
    expect(await used({ "main.ts": text })).toMatchObject({ mayPaint: true });
  });

  test("what is read from process is accounted for with await import() of node:process", async () => {
    expect(await used({ "main.ts": `console.log(typeof (await import("node:process")).report.getReport);\nexport {};` })).toMatchObject({ mayReport: true });
  });

  test("the report is open with an import of getBuiltinModule that is called with a computed name", async () => {
    expect(await used({ "main.ts": `import { getBuiltinModule } from "node:process";\nconsole.log(getBuiltinModule(process.argv[2]));` })).toMatchObject(open(computedModuleName));
  });

  test.each([
    ["an import of mainModule", `import { mainModule } from "node:process";\nconsole.log(mainModule);`],
    ["process of self", `declare const self: any;\nconsole.log(self.process.pid);`],
  ])("nothing is loaded, so the report stays closed with %s", async (_, text) => {
    expect(await used({ "main.ts": text })).toMatchObject(closed);
  });

  test.each([
    ["a parameter with the name of an import", `import B from "bun";\nfunction mine(B: any) { return B.color; }\nconsole.log(mine({ color: 1 }), typeof B);`],
    ["a function of the program's own that is called with the name of the module", `function load(name: string) { return { color: name }; }\nconsole.log(load("bun").color);`],
    ["getBuiltinModule of another module", `console.log(process.getBuiltinModule("node:path").color);`],
    ["default of another module", `import * as other from "./other";\nconsole.log((other as any).default.color);`],
    ["default of the namespace, which has none", `import * as B from "bun";\nconsole.log(B.default.color("red", "hex"));`],
    ["default of the namespace in brackets, which has none", `import * as B from "bun";\nconsole.log((B as any)["default"].color("red", "hex"));`],
    ["default in a pattern on the namespace, which has none", `import * as all from "bun";\nconst { default: B } = all as any;\n${paints}`],
    ["an import for its types alone", `import type B from "bun";\nlet alias: typeof B | undefined;\nconsole.log((alias as any)?.nothing);`],
    ["an export of another import", `import { join } from "node:path";\nexport { join as color };`],
    ["await import() of another module", `console.log(((await import("node:path")) as any).color);\nexport {};`],
    ["import name = require of another module", `import path = require("node:path");\nconsole.log((path as any).color);`],
  ])("a member of Bun is not listed through %s", async (_, text) => {
    expect(await used({ "main.ts": text, "other.ts": `export default { color: 1 };` })).toEqual({ ...closed, color: false, report: false, mayPaint: false, mayReport: false });
  });
});

// Each title says what was once taken for granted of the program. The compiler follows the value all the way instead: nothing blocks --trim, and neither the global object nor process nor Bun
// counts as handed to code that nobody sees. What such a program uses is what it names.
group("what the compiler follows, so that it is no longer so:", () => {
  test.each([
    ["any member may be used, and the report stays closed, when a member is defined", "declare const performance: any;\nObject.defineProperty(performance, \"own\", { value(this: any) { return this; } });"],
    ["any member may be used, and the report stays closed, when it is printed", "console.log(Intl);"],
    ["any member may be used, and the report stays closed, when it is an element of an array", "const list = [Intl];\nnew list[0].Segmenter();"],
    ["any member may be used, and the report stays closed, when it is returned", "function services() { return Intl; }\nnew (services().Segmenter)();"],
    ["the report is open with a symbol on the global object", "const key: string = process.argv[2];\nconst root: any = globalThis;\nconst mine = Symbol(\"mine\");\n(globalThis as any)[mine] = 1;\nconsole.log(String((globalThis as any)[mine]));"],
    ["the report is open with a registered symbol whose member is a tag on the global object", "const key: string = process.argv[2];\nconst root: any = globalThis;\n(globalThis as any)[Symbol.for(\"k\")] = () => 1;\nconsole.log((globalThis as any)[Symbol.for(\"k\")]`a`);"],
    ["the report is open with delete on the global object", "const key: string = process.argv[2];\nconst root: any = globalThis;\ndelete root[key];"],
    ["the report says what can be reached with the global object, to a function that defines a getter on it", "function define(scope: any) { Object.defineProperty(scope, \"mine\", { get() { return this; } }); }\ndefine(globalThis);"],
    ["the report says what can be reached with the prototype of the global object", "console.log(Object.getPrototypeOf(globalThis));"],
    ["the report says what can be reached with the prototype of Bun", "console.log(Object.getPrototypeOf(Bun));"],
    ["the report says what can be reached with a number defined on an alias of process", "const same = process;\nObject.defineProperty(same, \"me\", { value: 1 });"],
    ["the report says what can be reached with a function defined on an alias of process", "const same = process;\nObject.defineProperty(same, \"me\", { value: function (this: any) { return this; } });"],
    ["the report says what can be reached with a descriptor with a getter, defined on process", "Object.defineProperty(process, \"mine\", { get value() { return 1; } });"],
    ["the report says what can be reached with an accessor defined on Bun", "Object.defineProperty(Bun, \"me\", { get() { return this; } });\nconsole.log(Bun.me);"],
    ["the report says what can be reached with the prototype of process", "console.log(Object.getPrototypeOf(process));"],
    ["the report says what can be reached with Bun, to a variable with a function that is stored to", "let read = (input: any) => typeof input;\n(read as any) = (input: any) => input;\nconsole.log(read(Bun));"],
    ["what on() returns is process: the result of setMaxListeners()", "console.log(typeof process.setMaxListeners(20).report);"],
    ["the holder is this of what is called on it, so the report is open with a parameter, stored on process", "function store(input: any) { process.mine = input; }\nstore(1);\nconsole.log(process.mine());"],
    ["the holder is this of what is called on it, so the report is open with a function on process that does not mention this", "process.mine = function () { return 1; };\nconsole.log(process.mine());"],
    ["the holder is this of what is called on it, so the report is open with a function on Bun, as a tag", "Bun.mine = function (this: any) { return this; };\nconsole.log(Bun.mine`a`);"],
    ["the holder is this of what is called on it, so the report is open with a function on Bun", "Bun.mine = function (this: any) { return this; };\nconsole.log(Bun.mine());"],
    ["the holder is this of what is called on it, so the report is open with an arrow function on the global object", "(globalThis as any).mine = () => 1;\nconsole.log((globalThis as any).mine());"],
    ["the holder is this of what is called on it, so the report is open with a constant with a function, stored on Bun", "const seen = function (this: any) { return this; };\nBun.mine = seen;\nconsole.log(Bun.mine());"],
    ["the holder is this of what is called on it, so the report is open with one of two functions on Bun", "Bun.mine = process.argv[2] ? () => 1 : function (this: any) { return this; };\nconsole.log(Bun.mine());"],
    ["the holder is this of what is called on it, so the report is open with a declared function, stored on Bun", "function mine(this: any) { return this; }\nBun.mine = mine;\nconsole.log(Bun.mine());"],
    ["the holder is this of what is called on it, so the report is open with a constant with a function that does not mention this, stored on Bun", "const mine = function () { return 1; };\nBun.mine = mine;\nconsole.log(Bun.mine());"],
    ["the holder is this of what is called on it, so the report is open with a pattern that stores on Bun", "const seen = function (this: any) { return this; };\n[Bun.mine] = [seen];\nconsole.log(Bun.mine());"],
    ["the holder is this of what is called on it, so the report is open with a function on Bun that returns an arrow function", "Bun.mine = function (this: any) { return () => this; };\nconsole.log(Bun.mine());"],
    ["the holder is this of what is called on it, so the report is open with an unknown value on Bun", "Bun.mine = JSON.parse(process.argv[2]);\nconsole.log(Bun.mine());"],
    ["Bun in a sum", "Bun.valueOf = function (this: any) { return typeof this.color; };\nconsole.log(Bun + 1);"],
    ["Bun compared loosely with a string", "Bun.toString = function (this: any) { return typeof this.color; };\nconsole.log(Bun != \"a\");"],
    ["any member may be used, and the report stays closed, when it is an element of an array", "declare const performance: any;\nconst list = [performance];\nlist[0].mark(\"a\");"],
    ["any member may be used, and the report stays closed, when a variable that is not a constant has it", "declare const performance: any;\nlet timer = performance;\ntimer.now();"],
    ["any member may be used, and the report stays closed, when a function of the program's own is called on it", "declare const performance: any;\nperformance.own = function (this: any) { return this; };\nperformance.own();"],
    ["any member may be used, and the report stays closed, when it is an argument", "declare const performance: any;\nconsole.log(JSON.stringify(performance));"],
    ["any member may be used, and the report stays closed, when its prototype is read", "declare const performance: any;\nconsole.log(Object.getPrototypeOf(performance).mark);"],
    ["every one of them opens the report, and it is listed: the default export", "import all from \"node:module\";\nconsole.log(all[\"findSourceMap\"]);"],
    ["any member may be used, and the report stays closed, when it is printed", "declare const performance: any;\nconsole.log(performance);"],
    ["every one of them opens the report, and it is listed: a named import under another name", "import { findSourceMap as find } from \"module\";\nconsole.log(find);"],
    ["any member may be used, and the report stays closed, when a function is stored under a computed name and called there", "declare const performance: any;\nperformance[process.argv[2]] = function (this: any) { return this; };\nperformance[process.argv[2]]();"],
    ["any member may be used, and the report stays closed, when a key is computed", "declare const performance: any;\nperformance[process.argv[2]](\"a\");"],
    ["every one of them opens the report, and it is listed: a named import", "import { SourceMap } from \"node:module\";\nconsole.log(SourceMap);"],
    ["every one of them opens the report, and it is listed: an export that loads nothing", "import { isBuiltin } from \"node:module\";\nconsole.log(isBuiltin(\"fs\"));"],
    ["every one of them opens the report, and it is listed: require", "console.log(require(\"node:module\").SourceMap);"],
    ["every one of them opens the report, and it is listed: the namespace", "import * as all from \"node:module\";\nconsole.log(all.SourceMap);"],
    ["every one of them opens the report, and it is listed: require and a pattern", "const { SourceMap, findSourceMap } = require(\"node:module\");\nconsole.log(SourceMap, findSourceMap);"],
    ["any member may be used, and the report stays closed, when it is printed", "console.log(Intl);"],
    ["any member may be used, and the report stays closed, when it is an element of an array", "const list = [Intl];\nnew list[0].Segmenter();"],
    ["any member may be used, and the report stays closed, when it is spread", "console.log({ ...Intl });"],
    ["any member may be used, and the report stays closed, when it is tested and passed on", "console.log(Intl && Intl);"],
    ["any member may be used, and the report stays closed, when a pattern takes the rest of it", "const { Segmenter, ...others } = Intl;\nconsole.log(typeof Segmenter, others);"],
    ["any member may be used, and the report stays closed, when its keys are listed", "console.log(Reflect.ownKeys(Intl));"],
    ["any member may be used, and the report stays closed, when a pattern has a default for a class of it", "const { Collator = null } = Intl;\nconsole.log(typeof Collator);"],
    ["any member may be used, and the report stays closed, when a class of it is passed on", "console.log(Intl.DisplayNames);"],
    ["any member may be used, and the report stays closed, when its names are listed", "console.log(Object.getOwnPropertyNames(Intl));"],
    ["any member may be used, and the report stays closed, when a class of it is the base of a class", "class Mine extends Intl.PluralRules {}\nnew Mine();"],
    ["what is called on Bun is accounted for when the name of import name = require is exported", "import B = require(\"bun\");\nexport { B };"],
    ["what is called on Bun is accounted for when import name = require is exported", "export import B = require(\"bun\");"],
    ["what is called on Bun is accounted for when a variable with it is added to, which converts it", "let alias: any = Bun;\nalias += 1;\nconsole.log(alias);"],
    ["what is called on Bun is accounted for when the result of await import() is passed on", "console.log(await import(\"bun\"));\nexport {};"],
  ])("%s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});

/** The groups are dealt out in turn to the files runtime-use-hosts-<part>.test.ts: each test is a run of the compiler, and a file has five minutes. */
export function runtimeUseOfHostsTests(part: number, parts: number) {
  groups.forEach(([name, body], index) => {
    if (index % parts === part - 1) describe.concurrent(name, body);
  });
}
