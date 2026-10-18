// What a program is said to name although it names nothing: the names in the built-in JavaScript that is compiled into every executable.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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
  const openedByTheTableOfListeners = "open constructor, or a name that is computed, read from what may be a function";
  test.each([
    ["node:events", `${emitter} new EventEmitter().on("constructor", () => {}).emit("constructor");`],
    ["node:fs", `console.log(require("node:fs").readFileSync("x", "utf8").length);`],
    ["node:util", `console.log(require("node:util").format("%s", 1));`],
    ["node:http", `require("node:http").createServer((request: any, response: any) => response.end("x")).listen(0);`],
    ["process.stdout", `process.stdout.write("x");`],
  ])("the reads by key of what %s brings do not open the world", async (_, text) => {
    await factsOf(text);
  });

  test.each([
    ["an object literal", `${emitter} console.log(EventEmitter.prototype.listeners.call({ _events: function () {} }, "constructor"));`],
    ["a store", `${emitter} const made = new EventEmitter(); made._events = function () {}; console.log(made.listeners("constructor"));`],
    ["a class field", `${emitter} class Odd extends EventEmitter { _events = function () {}; } console.log(new Odd().listeners("constructor"));`],
    ["a key that is not seen", `${emitter} const made = new EventEmitter(); made[process.argv[2]] = function () {}; console.log(made.listeners("constructor"));`],
    ["another prototype for the module's own table", `${emitter} const made = new EventEmitter(); Object.setPrototypeOf(Object.values(made)[0], function () {}); console.log(made.listeners("constructor"));`],
    ["a Proxy", `${emitter} declare const Proxy: any; console.log(EventEmitter.prototype.listeners.call(new Proxy({}, {}), "constructor"));`],
  ])("the world is open where the program can put another table of listeners there: %s", async (_, text) => {
    await factsOf(text, openedByTheTableOfListeners);
  });

  test("the world is open where the program gives node:http an agent whose constructor it calls", async () => {
    await factsOf(`require("node:http").request({ agent: false, _defaultAgent: function () {} });`, openedByTheTableOfListeners);
  });
});
