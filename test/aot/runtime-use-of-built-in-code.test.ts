// What a program is said to use although it names nothing: the names in the built-in JavaScript that is compiled into every executable.
import { describe, expect } from "bun:test";
import { builtinModules } from "node:module";
import { closed, completeness, computedModuleName, notYet, open, type Use } from "./runtime-use-expectations";
import { of } from "./runtime-use-harness";
import { eachRow, gap, test } from "./supported";

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

  // TODO: node:os, four internal modules and three native functions are not listed.
  test.todo("a program that requires node:util lists all of it", async () => {
    const use = await closedReport(`console.log(require("node:util").format("%s", 1));`);
    expect(onlyWithNodeUtil.filter(line => !lists(use, line))).toEqual([]);
  });

  // TODO: internal/fixed_queue is not listed.
  test.todo("a program that requires node:events lists its queue", async () => {
    const use = await closedReport(`console.log(require("node:events").on);`);
    expect(use.lines).toContain("module internal/fixed_queue");
  });

  // TODO: node:tty, node:fs and internal/fs/streams are not listed.
  test.todo(
    "node:events brings the modules of process.stderr, which the warning about too many listeners is written to",
    async () => {
      const standardStream = ["module node:tty", "module node:fs", "module internal/fs/streams"];
      const [withEvents, without] = await Promise.all([
        closedReport(`console.log(require("node:events").on);`),
        closedReport(`console.log("hello");`),
      ]);
      expect(standardStream.filter(line => !withEvents.lines.includes(line))).toEqual([]);
      expect(["module node:events", ...standardStream].filter(line => without.lines.includes(line))).toEqual([]);
    },
  );

  // TODO: the global object counts as escaped in the server.
  test.todo(
    "the worker of node:cluster refers to process: a server does not reach it, and a program that reads the worker holds all of process",
    async () => {
      const server = await closedReport(
        `require("node:http").createServer((request: any, response: any) => response.end("x")).listen(0);`,
      );
      expect(server.lines).toContain("module internal/cluster/child");
      expect(
        server.lines.filter(
          line => line === "process (escapes, so any member may be used)" || line === "module node:module",
        ),
      ).toEqual([]);
      const [worker, everyExport] = await Promise.all([
        of(`console.log(require("node:cluster").worker);`),
        of(`console.log(Object.values(require("node:cluster")));`),
      ]);
      expect({ worker: completeness(worker), everyExport: completeness(everyExport) }).toEqual({
        worker: open(computedModuleName),
        everyExport: open(computedModuleName),
      });
    },
  );

  const emitter = `const { EventEmitter } = require("node:events");`;
  eachRow([
    gap(notYet.globalObject, [
      "node:events",
      `${emitter} new EventEmitter().on("constructor", () => {}).emit("constructor");`,
    ]),
    ["node:fs", `console.log(require("node:fs").readFileSync("x", "utf8").length);`],
    ["node:util", `console.log(require("node:util").format("%s", 1));`],
    gap(notYet.globalObject, [
      "node:http",
      `require("node:http").createServer((request: any, response: any) => response.end("x")).listen(0);`,
    ]),
    gap(notYet.globalObject, ["process.stdout", `process.stdout.write("x");`]),
  ])("the computed keys in what %s brings leave the report closed", async (_, text) => {
    await closedReport(text);
  });

  const hostClasses = `declare const URL: any, performance: any;\n`;
  // TODO: one value that nobody knows is in the program, and every member of the language's built-in objects counts as used.
  const printedNotYet = [
    ["a URL, which has an inspector of its own", `console.log(new URL("http://x/"));`],
    [
      "a mark, whose inspector prints an object of the program",
      `console.log(performance.mark("m", { detail: { a: 1 } }));`,
    ],
  ];
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
  test.todo.each(printedNotYet)("printing %s uses no member that the program does not name", (_, text) =>
    usesNoMemberThatIsNotNamed([text]),
  );

  // TODO: the global object counts as escaped.
  test.todo("printing entire built-in modules leaves the report closed", async () => {
    await closedReport(
      `console.log(require("node:http"), require("node:child_process"), require("node:readline/promises"), require("node:util"));`,
    );
  });

  const requiringLeavesItClosed = async (name: string) => {
    await closedReport(`console.log(typeof require("${name}"));`);
  };
  // TODO: the global object counts as escaped, and with it every global, as soon as one of these is required.
  const letTheGlobalObjectEscape = [
    "_http_agent",
    "_http_client",
    "_http_common",
    "_http_incoming",
    "_http_outgoing",
    "_http_server",
    "_stream_duplex",
    "_stream_passthrough",
    "_stream_readable",
    "_stream_transform",
    "_stream_wrap",
    "_stream_writable",
    "_tls_common",
    "_tls_wrap",
    "assert",
    "assert/strict",
    "child_process",
    "cluster",
    "crypto",
    "fs/promises",
    "http",
    "http2",
    "https",
    "inspector",
    "inspector/promises",
    "net",
    "readline",
    "readline/promises",
    "repl",
    "stream",
    "stream/promises",
    "tls",
    "tty",
    "undici",
    "worker_threads",
    "ws",
    "zlib",
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
  test.todo.each(letTheGlobalObjectEscape)(
    "only a call opens the report: requiring %s leaves it closed",
    requiringLeavesItClosed,
  );
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
