// What a program is said to use although it names nothing: the names in the built-in JavaScript that is compiled into every executable.
import { expect } from "bun:test";
import { describe } from "./harness/declare";
import { builtinModules } from "node:module";
import { closed, completeness, type Use } from "./runtime-use-expectations";
import { of } from "./runtime-use-harness";
import { eachRow, test } from "./supported";

async function closedReport(text: string) {
  const use = await of(text);
  expect({ ...completeness(use), exitCode: use.exitCode }).toEqual({ ...closed, exitCode: 0 });
  return use;
}

/** `line`: as the report prints it, but a native binding without the macro of src/js that binds it: `native <file>:<symbol>`. */
function lists(use: Use, line: string): boolean {
  if (!line.startsWith("native ")) return use.lines.includes(line);
  const binding = ":" + line.slice("native ".length);
  return use.lines.some(each => each.startsWith("native ") && each.endsWith(binding));
}

const onlyWithNodeUtil = [
  "module node:util",
  "module node:os",
  "module internal/promisify",
  "module internal/streams/state",
  "module internal/streams/utils",
  "module internal/tty",
  "module internal/util/colors",
  "module internal/util/comparisons",
  "module internal/util/deprecate",
  "module internal/util/mime",
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
    const use = await closedReport(`console.log("hello");`);
    expect(onlyWithNodeUtil.filter(line => lists(use, line))).toEqual([]);
    expect(use.lines.includes("module internal/fixed_queue")).toBe(false);
  });

  const emitter = `const { EventEmitter } = require("node:events");`;
  eachRow([
    ["node:events", `${emitter} new EventEmitter().on("constructor", () => {}).emit("constructor");`],
    ["node:fs", `console.log(require("node:fs").readFileSync("x", "utf8").length);`],
    ["node:util", `console.log(require("node:util").format("%s", 1));`],
  ])("the computed keys in what %s brings leave the report closed", async (_, text) => {
    await closedReport(text);
  });

  const hostClasses = `declare const URL: any, performance: any;\n`;
  const printed = [
    ["an object literal", `console.log({ a: 1 });`],
    ["an array", `console.log([1, 2]);`],
    ["a Map", `console.log(new Map());`],
    ["an Error", `console.log(new Error("x"));`],
    ["an element of an array", `const list: string[] = ["p", "q"]; console.log(list[0]);`],
    ["the result of JSON.parse", `console.log(JSON.parse(process.argv[2]));`],
    [
      "dates, typed arrays, sets, regular expressions, symbols and functions",
      `console.log(new Date(0), 5n, new Uint8Array(2), new Set([1]), /x/, Symbol("s"), () => 1);`,
    ],
    ["an object with a tag", `class Tagged { get [Symbol.toStringTag]() { return "T"; } } console.log(new Tagged());`],
    ["a class with a static name", `class Named { static name = "other"; } console.log(Named, new Named());`],
    [
      "an object with symbols of the program's own as keys",
      `console.log({ [Symbol.for("mine")]: 1, [Symbol.iterator]: 2 });`,
    ],
    [
      "an object filled under concatenated keys",
      `const counts: Record<string, number> = {}; for (let at = 0; at < 3; at++) counts["k" + at] = at; console.log(counts);`,
    ],
    [
      "an object filled under unknown keys",
      `const holder: any = {}; holder[process.argv[2]] = 1; console.log(holder, { [process.argv[3]]: 1 });`,
    ],
    ["the result of Object.values", `console.log(Object.values({ a: 1 }));`],
    [
      "objects filled under keys that are strings",
      `function fill(holder: Record<string, number>, key: string) { holder[key] = 1; return { [key]: 2, [\`x\${key}\`]: 3 }; } console.log(fill({}, "a"), fill({}, process.argv[2]));`,
    ],
  ];
  async function usesNoMemberThatIsNotNamed(texts: string[]) {
    const use = await closedReport(hostClasses + texts.map(text => `{ ${text} }`).join("\n"));
    expect(
      ["property toTemporalInstant", "property toLocaleString", "property localeCompare"].filter(line =>
        use.lines.includes(line),
      ),
    ).toEqual([]);
  }
  test(`printing uses no member that the program does not name: ${printed.map(([what]) => what).join(", ")}`, () =>
    usesNoMemberThatIsNotNamed(printed.map(([, text]) => text)));

  const requiringLeavesItClosed = async (name: string) => {
    await closedReport(`console.log(typeof require("${name}"));`);
  };
  // TODO: the global object counts as escaped, and with it every global, as soon as one of these is required.
  const letTheGlobalObjectEscape = [
    "_http_agent",
    "_http_client",
    "child_process",
    "cluster",
    "crypto",
    "http",
    "https",
    "inspector",
    "inspector/promises",
    "readline",
    "worker_threads",
    "ws",
  ];
  // TODO: beside another module the global object counts as escaped.
  const closedOnlyAlone = ["dgram", "events", "module", "os", "perf_hooks", "trace_events", "v8"];
  // The rows above and runtime-use-of-util-inspect.test.ts call a function of these and find the report closed.
  const calledElsewhere = ["sys", "util"];
  test("only a call opens the report: requiring the other built-in modules leaves it closed", async () => {
    const names = builtinModules.filter(
      name => ![...letTheGlobalObjectEscape, ...closedOnlyAlone, ...calledElsewhere].includes(name),
    );
    expect(names.length).toBeGreaterThanOrEqual(30);
    await closedReport(names.map(name => `console.log(typeof require("${name}"));`).join("\n"));
  });
  test.each(closedOnlyAlone)("only a call opens the report: requiring %s leaves it closed", requiringLeavesItClosed);
});

// Each title says what was once taken for granted of the program. The compiler follows the value all the way instead: nothing blocks --trim, and neither the global object nor process nor Bun
// counts as handed to code that nobody sees. What such a program uses is what it names.
describe.concurrent("what the compiler follows, so that it is no longer so:", () => {
  test("util.inspect may read any member where the program defines a property under an unknown key or calls Bun.inspect", async () => {
    expect(
      completeness(
        await of(
          "console.log(Object.defineProperty({}, process.argv[2], { value: 1 }));\nconsole.log(Bun.inspect({ a: 1 }));",
        ),
      ),
    ).toEqual(closed);
  });
});
