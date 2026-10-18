// What a program is said to name although it names nothing: the names in the built-in JavaScript that is compiled into every executable.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { builtinModules } from "node:module";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: [] },
});

async function factsOf(text: string, world = "closed") {
  using dir = tempDir("aot-runtime-use-of-built-in-code", { "tsconfig.json": tsconfig, "main.ts": `declare const console: any, process: any, require: any;\n${text}` });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--aot-explain=runtime-use", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const prefix = "aot: runtime use: ";
  const lines = stderr.split("\n").filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length));
  expect({ exitCode, world: lines[0].split(" in /")[0] }).toEqual({ exitCode: 0, world });
  return new Set(lines);
}

const onlyWithNodeUtil = [
  "module node:util",
  "module node:os",
  "module internal:promisify",
  "module internal:streams/state",
  "module internal:streams/utils",
  "module internal:tty",
  "module internal:util/colors",
  "module internal:util/comparisons",
  "module internal:util/deprecate",
  "module internal:util/mime",
  "native JSMIMEParams.cpp:createJSMIMEBinding",
  "native node_os.bind.ts:cpus",
  "native node_os.bind.ts:networkInterfaces",
  "native parse_args.rs:parseArgs",
  "native node_util_binding.rs:internalErrorEntries",
  "global AbortSignal",
  "global FinalizationRegistry",
  "global TextEncoder",
  "global navigator",
];

describe.concurrent("the built-in code that is part of every program", () => {
  test("does not bring node:util and what it requires", async () => {
    const facts = await factsOf(`console.log("hello");`);
    expect(onlyWithNodeUtil.filter(fact => facts.has(fact))).toEqual([]);
    expect(facts.has("module internal:fixed_queue")).toBe(false);
  });

  test("a program that requires node:util names all of it", async () => {
    const facts = await factsOf(`console.log(require("node:util").format("%s", 1));`);
    expect(onlyWithNodeUtil.filter(fact => !facts.has(fact))).toEqual([]);
  });

  test("a program that requires node:events names its queue", async () => {
    const facts = await factsOf(`console.log(require("node:events").on);`);
    expect(facts.has("module internal:fixed_queue")).toBe(true);
  });

  test("whoever holds node:events holds what process.stderr is made of, which the warning printer then writes through", async () => {
    const standardStream = ["module node:tty", "module node:fs", "module internal:fs/streams"];
    const withEvents = await factsOf(`console.log(require("node:events").on);`);
    expect(standardStream.filter(fact => !withEvents.has(fact))).toEqual([]);
    const without = await factsOf(`console.log("hello");`);
    expect(["module node:events", ...standardStream].filter(fact => without.has(fact))).toEqual([]);
  });

  const emitter = `const { EventEmitter } = require("node:events");`;
  test.each([
    ["node:events", `${emitter} new EventEmitter().on("constructor", () => {}).emit("constructor");`],
    ["node:fs", `console.log(require("node:fs").readFileSync("x", "utf8").length);`],
    ["node:util", `console.log(require("node:util").format("%s", 1));`],
    ["node:http", `require("node:http").createServer((request: any, response: any) => response.end("x")).listen(0);`],
    ["process.stdout", `process.stdout.write("x");`],
  ])("the reads by key of what %s brings do not open the world", async (_, text) => {
    await factsOf(text);
  });

  const declared = `declare const URL: any, performance: any, Proxy: any, Bun: any;`;
  test.each([
    ["an object literal", `console.log({ a: 1 });`],
    ["an array", `console.log([1, 2]);`],
    ["a Map", `console.log(new Map());`],
    ["an Error", `console.log(new Error("x"));`],
    ["an element of an array", `const list: string[] = ["p", "q"]; console.log(list[0]);`],
    ["what came out of data", `console.log(JSON.parse(process.argv[2]));`],
    ["dates, typed arrays, sets, regular expressions, symbols and functions", `console.log(new Date(0), 5n, new Uint8Array(2), new Set([1]), /x/, Symbol("s"), () => 1);`],
    ["a URL, which has an inspector of its own", `console.log(new URL("http://x/"));`],
    ["a mark, whose inspector prints an object of the program", `console.log(performance.mark("m", { detail: { a: 1 } }));`],
    ["an object with a tag", `class Tagged { get [Symbol.toStringTag]() { return "T"; } } console.log(new Tagged());`],
    ["a class with a static name", `class Named { static name = "other"; } console.log(Named, new Named());`],
    ["an object with keys that are symbols of the program's own", `console.log({ [Symbol.for("mine")]: 1, [Symbol.iterator]: 2 });`],
    ["an object filled under keys that are put together", `const made: Record<string, number> = {}; for (let at = 0; at < 3; at++) made["k" + at] = at; console.log(made);`],
    ["an object filled under keys that are not seen", `const holder: any = {}; holder[process.argv[2]] = 1; console.log(holder, { [process.argv[3]]: 1 });`],
    ["what Object.values gave", `console.log(Object.values({ a: 1 }));`],
    ["objects filled under keys that are strings", `function fill(holder: Record<string, number>, key: string) { holder[key] = 1; return { [key]: 2, [\`x\${key}\`]: 3 }; } console.log(fill({}, "a"), fill({}, process.argv[2]));`],
  ])("to print %s reads no property that is not named", async (_, text) => {
    const facts = await factsOf(`${declared} ${text}`);
    expect(["prints object", "module internal:util/inspect"].filter(fact => !facts.has(fact))).toEqual([]);
    expect(["property *", "property toLocaleString", "property localeCompare"].filter(fact => facts.has(fact))).toEqual([]);
  });

  test.each([
    ["what join answers", `const list: string[] = ["p", "q"]; const text: string = list.join("-"); console.log(text);`],
    ["a parameter that is a string", `function show(text: string) { console.log(text); } show("x"); show(process.argv[2]);`],
    ["numbers, booleans, bigints, null and undefined", `function show(n: number, flag: boolean, big: bigint, nothing: null, text: string | undefined) { console.log(n, flag, big, nothing, text); } show(1, true, 1n, null, undefined);`],
    ["numbers under a format", `function show(n: number) { console.log("%o %O %j", n, n, n); } show(1);`],
    ["what a Map of strings holds", `const map = new Map<string, string>(); map.set("a", "b"); console.log(map.get("a"), map.size, map.has("a"));`],
    ["what the methods of a string answer", `function show(text: string) { console.error(text.slice(1), text.toUpperCase(), text.length, text.indexOf("a"), text.trim(), text.charCodeAt(0), text.includes("a")); } show("abc");`],
    ["what parseInt, Math.max and Date.now answer", `function show(text: string) { console.warn(parseInt(text, 10), Math.max(1, 2), Date.now()); } show("1");`],
    ["a member of an enum and one of two literals", `enum Kind { One, Two } function show(kind: Kind, word: "a" | "b") { console.info(kind, word); } show(Kind.One, "a");`],
    ["what a promise of a string resolves to", `async function text(): Promise<string> { return "x"; } async function main() { const got: string = await text(); console.log(got); } main();`],
    ["a constant that is checked where it is made", `const text: string = JSON.parse(process.argv[2]); console.log(text);`],
    ["what a function is declared to return, which is checked", `function text(): string { return JSON.parse(process.argv[2]); } console.log(text());`],
  ])("to print %s, which the compiled code holds to be no object, brings no inspector", async (_, text) => {
    const facts = await factsOf(text);
    expect(["prints object", "module internal:util/inspect"].filter(fact => facts.has(fact))).toEqual([]);
  });

  const shape = `interface Shape { text: string }`;
  test.each([
    ["an element of an array of strings", `const list: string[] = JSON.parse(process.argv[2]); console.log(list[0]);`],
    ["a member of what JSON.parse gave", `${shape} const given: Shape = JSON.parse(process.argv[2]); console.log(given.text);`],
    ["such a member held by a constant of that type", `${shape} const given: Shape = JSON.parse(process.argv[2]); const text: string = given.text; console.log(text);`],
    ["a cast", `const text = JSON.parse(process.argv[2]) as string; console.log(text);`],
    ["what was caught, cast", `try { throw JSON.parse(process.argv[2]); } catch (error) { console.log(error as string); }`],
    ["a rest parameter", `function show(...list: string[]) { console.log(list[0]); } (show as any)({});`],
    ["a box of anything taken for a box of strings", `class Box<T> { constructor(public held: T) {} } const box: Box<string> = new Box<any>({}); console.log(box.held);`],
    ["a member changed through any", `${shape} const made: Shape = { text: "a" }; (made as any).text = JSON.parse(process.argv[2]); console.log(made.text);`],
    ["unknown", `function show(value: unknown) { console.log(value); } show(1);`],
    ["a type parameter", `function show<T>(value: T) { console.log(value); } show("a");`],
    ["a string or an array", `function show(value: string | string[]) { console.log(value); } show("a");`],
    ["a function beside a string", `function show(text: string, call: () => void) { console.log(text, call); } show("a", () => {});`],
    ["strings that are spread", `function show(...list: string[]) { console.log(...list); } show("a");`],
    ["a string through console.log.call", `function show(text: string) { console.log.call(console, text); } show("a");`],
    ["a string through a constant that holds console.log", `function show(text: string) { const log = console.log; log(text); } show("a");`],
  ])("the inspector stays where a type is only declared or may hold an object: %s", async (_, text) => {
    const facts = await factsOf(text);
    expect(["prints object", "module internal:util/inspect"].filter(fact => !facts.has(fact))).toEqual([]);
  });

  const inspector = `(depth: any, options: any, inspect: any) { return inspect({}, JSON.parse(process.argv[2])); }`;
  test.each([
    ["calls util.inspect", `console.log(require("node:util").inspect({}, JSON.parse(process.argv[2])));`],
    ["calls util.formatWithOptions", `console.log(require("node:util").formatWithOptions(JSON.parse(process.argv[2]), "%o", {}));`],
    ["makes a Console", `new console.Console(process.stdout).dir({}, JSON.parse(process.argv[2]));`],
    ["has an inspector of its own in a class", `class Own { [Symbol.for("nodejs.util.inspect.custom")]${inspector} } console.log(new Own());`],
    ["has an inspector of its own under a constant", `const custom = Symbol.for("nodejs.util.inspect.custom"); console.log({ [custom]${inspector} });`],
    ["asks for a registered symbol by a text that is not seen", `console.log({ [Symbol.for(process.argv[3])]${inspector} });`],
    ["fails an assertion, whose message is made with getters", `require("node:assert").deepStrictEqual(Object.getPrototypeOf(JSON.parse(process.argv[2])), {});`],
    ["takes node:util under its other name", `console.log(require("sys").inspect({}, JSON.parse(process.argv[2])));`],
    ["imports node:util when it runs", `import("node:util").then((util: any) => console.log(util.inspect({}, JSON.parse(process.argv[2]))));`],
    ["imports Console", `const { Console } = require("node:console"); new Console(process.stdout).dir({}, JSON.parse(process.argv[2]));`],
    ["makes a Console of console under another name", `const output = console; new output.Console(process.stdout).dir({}, JSON.parse(process.argv[2]));`],
    ["defines properties by descriptors that are not seen", `console.log(Object.defineProperties({}, JSON.parse(process.argv[2])));`],
    ["defines a property under a key that is not seen", `console.log(Object.defineProperty({}, process.argv[2], { value: 1 }));`],
    ["calls Bun.inspect", `console.log(Bun.inspect({ a: 1 }));`],
    ["has a built-in module install its inspector under the symbol that Bun.inspect holds", `const own = function ${inspector}; console.log(require("node:querystring").decode("a=b", null, null, { decodeURIComponent: (text: string) => (text === "a" ? Bun.inspect.custom : own) }));`],
  ])("any property may be read by util.inspect where the program %s", async (_, text) => {
    const facts = await factsOf(`${declared} ${text}`);
    expect(["property *", "escapes property /$bun/js/internal/util/inspect.ts"].filter(fact => !facts.has(fact))).toEqual([]);
  });

  const replacing = `(depth: any, options: any, inspect: any) { inspect.styles = function () {};`;
  const called = `("return 42", "constructor")();`;
  test.each([
    ["replaces the styles in an inspector of its own and takes stylize by its position", `const custom = Symbol.for("nodejs.util.inspect.custom"); console.log({ [custom]${replacing} return (Object.values(options) as any[])[0]${called} } });`],
    ["stores on inspect under a key that is not seen", `const custom = Symbol.for("nodejs.util.inspect.custom"); console.log({ [custom](depth: any, options: any, inspect: any) { inspect[process.argv[2]] = function () {}; return options.stylize${called} } });`],
    ["takes the symbol from Bun.inspect", `console.log({ [Bun.inspect.custom]${replacing} return options.stylize${called} } });`],
    ["takes the symbol from Bun.inspect by its position", `const custom: symbol = (Object.values(Bun.inspect) as any[])[0]; const holder: any = {}; holder[custom] = function ${replacing} return options.stylize${called} }; console.log(holder);`],
    ["installs such a symbol through Object.fromEntries", `const custom: symbol = (Object.values(Bun.inspect) as any[])[0]; console.log(Object.fromEntries([[custom, function ${replacing} return options.stylize${called} }]]));`],
    ["takes inspect, the symbol and the table of node:util by their positions", `const inspect: any = (Object.values(require("node:util")) as any[])[Number(process.argv[2])]; const custom: any = (Object.values(inspect) as any[])[0]; console.log({ [custom](depth: any, options: any) { Object.setPrototypeOf((Object.values(inspect) as any[])[2], function () {}); return options.stylize${called} } });`],
    ["takes the table by its position and the setter of prototypes out of a table of its own", `const custom = Symbol.for("nodejs.util.inspect.custom"); const own: any = { a: 1 }; console.log({ [custom](depth: any, options: any, inspect: any) { own[process.argv[2]].call({}, process.argv[3]).call((Object.values(inspect) as any[])[2], function () {}); return options.stylize${called} } });`],
    ["comes by Symbol without its name and puts the text together", `const unnamed: any = Symbol("a").constructor; console.log({ [unnamed.for("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`],
    ["stores such a symbol's inspector under a variable", `const unnamed: any = Symbol("a").constructor; const custom = unnamed.for("nodejs.util.inspect." + process.argv[2]); const holder: any = {}; holder[custom] = function ${replacing} return options.stylize${called} }; console.log(holder);`],
    ["asks the constructor of a wrapped symbol", `console.log({ [Object(Symbol.iterator).constructor.for("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`],
    ["asks the constructor that the prototype of a symbol holds", `console.log({ [Object.getPrototypeOf(Symbol.iterator).constructor.for("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`],
    ["asks what a function of its own found", `const found = (value: any) => value.constructor; console.log({ [found(Symbol.iterator).for("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`],
    ["takes the registry's function by Reflect.get", `const unnamed: any = Object(Symbol.iterator).constructor; console.log({ [Reflect.get(unnamed, "for")("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`],
    ["takes Symbol.for out of the constructor of a well-known symbol", `const { for: make } = Symbol.iterator.constructor as any; console.log({ [make("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`],
    ["has an emitter write the key for it: a listener under the name, the table by its position", `const emitter = new (require("node:events"))(); emitter.on("styles", Reflect.getPrototypeOf(function () {})); console.log({ [Symbol.for("nodejs.util.inspect.custom")](depth: any, options: any, inspect: any) { Object.assign(inspect, Object.values(emitter)[0]); return options.stylize${called} } });`],
    ["lists the symbols of a URL", `console.log({ [Object.getOwnPropertySymbols(Object.getPrototypeOf(new URL("http://x/")))[0]]${replacing} return options.stylize${called} } });`],
    ["lists the keys of a URL", `console.log({ [Reflect.ownKeys(Object.getPrototypeOf(new URL("http://x/")))[0]]${replacing} return options.stylize${called} } });`],
    ["answers for the symbol with a Proxy among the ancestors", `console.log(Object.create(new Proxy({}, { get() { return function ${replacing} return options.stylize${called} }; } })));`],
  ])("any property may be read by util.inspect where the program can have an inspector of its own: it %s", async (_, text) => {
    const facts = await factsOf(`${declared} ${text}`);
    expect(["property *", "escapes property /$bun/js/internal/util/inspect.ts"].filter(fact => !facts.has(fact))).toEqual([]);
  });

  test("built-in code that only defines an inspector brings none: the table behind require.cache", async () => {
    const facts = await factsOf(`declare const module: any; module.exports = { value: 1 }; console.log("x");`);
    expect(facts.has("global module")).toBe(true);
    expect(["module internal:util/inspect", "symbol nodejs.util.inspect.custom"].filter(fact => facts.has(fact))).toEqual([]);
    const printing = await factsOf(`declare const module: any; module.exports = { value: 1 }; console.log(module.exports);`);
    expect(printing.has("module internal:util/inspect")).toBe(true);
  });

  test("util.inspect copies a regular expression that exists: it asks for no table of Unicode properties", async () => {
    expect((await factsOf(`console.log({ a: 1 }, /x/);`)).has("regexp computed")).toBe(false);
    expect((await factsOf(`console.log(new RegExp(process.argv[2]));`)).has("regexp computed")).toBe(true);
  });

  test.each([
    ["its own literal", `const own = { a: 1 }; console.log(require("node:util").format("%s", 1), Object.values(own), Object.entries(own), { ...own });`],
    ["an array", `const list = [1, 2]; console.log(require("node:util").format("%s", 1), Object.values(list), Object.entries(list));`],
    ["an instance of its own class", `class Own { a = 1; } console.log(require("node:util").format("%s", 1), Object.values(new Own()));`],
    ["a map, a list and form data by their own methods", `const given: any = JSON.parse(process.argv[2]); console.log([...given.values()].length, [...given.entries()].length, "" + new Map([[1, 2]]).values().next().value);`],
  ])("to take the members of %s by position takes nothing of the runtime", async (_, text) => {
    expect((await factsOf(text)).has("program-member *")).toBe(false);
  });

  test("any property may be read by util.inspect where the program loads node:dgram, whose errors are printed with getters", async () => {
    expect((await factsOf(`console.log(require("node:dgram").createSocket("udp4"));`)).has("escapes property /$bun/js/internal/util/inspect.ts")).toBe(true);
  });

  test("node:module's wrapper, a Proxy that stores for its caller, does not open the world", async () => {
    await factsOf(`console.log(require("node:http"), require("node:child_process"), require("node:readline/promises"), require("node:util"));`);
  });

  const openTheWorldThemselves = ["bun:ffi", "bun:jsc", "inspector", "inspector/promises", "module", "repl", "vm", "worker_threads"];
  test.each(builtinModules.filter(name => !openTheWorldThemselves.includes(name)))("to require %s does not open the world", async name => {
    await factsOf(`console.log(typeof require("${name}"));`);
  });
});
