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

const usesEveryMember = (use: Use) => use.lines.includes("property toTemporalInstant");

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
  eachRow([
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
    gap(notYet.everyBuiltin, ["a URL, which has an inspector of its own", `console.log(new URL("http://x/"));`]),
    gap(notYet.everyBuiltin, [
      "a mark, whose inspector prints an object of the program",
      `console.log(performance.mark("m", { detail: { a: 1 } }));`,
    ]),
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
  ])("printing %s uses no member that the program does not name", async (_, text) => {
    const use = await closedReport(hostClasses + text);
    expect(
      ["property toTemporalInstant", "property toLocaleString", "property localeCompare"].filter(line =>
        use.lines.includes(line),
      ),
    ).toEqual([]);
  });

  const inspector = `(depth: any, options: any, inspect: any) { return inspect({}, JSON.parse(process.argv[2])); }`;
  eachRow([
    ["calls util.inspect", `console.log(require("node:util").inspect({}, JSON.parse(process.argv[2])));`],
    [
      "calls util.formatWithOptions",
      `console.log(require("node:util").formatWithOptions(JSON.parse(process.argv[2]), "%o", {}));`,
    ],
    gap(notYet.globalObject, [
      "constructs a Console",
      `new console.Console(process.stdout).dir({}, JSON.parse(process.argv[2]));`,
    ]),
    [
      "has an inspector of its own in a class",
      `class Own { [Symbol.for("nodejs.util.inspect.custom")]${inspector} } console.log(new Own());`,
    ],
    [
      "has an inspector of its own under a constant",
      `const custom = Symbol.for("nodejs.util.inspect.custom"); console.log({ [custom]${inspector} });`,
    ],
    [
      "asks for a registered symbol by an unknown string",
      `console.log({ [Symbol.for(process.argv[3])]${inspector} });`,
    ],
    gap(notYet.globalObject, [
      "fails an assertion, whose message is formatted with getters",
      `require("node:assert").deepStrictEqual(Object.getPrototypeOf(JSON.parse(process.argv[2])), {});`,
    ]),
    [
      "requires node:util under its other name",
      `console.log(require("sys").inspect({}, JSON.parse(process.argv[2])));`,
    ],
    [
      "imports node:util at run time",
      `import("node:util").then((util: any) => console.log(util.inspect({}, JSON.parse(process.argv[2]))));`,
    ],
    gap(notYet.globalObject, [
      "imports Console",
      `const { Console } = require("node:console"); new Console(process.stdout).dir({}, JSON.parse(process.argv[2]));`,
    ]),
    gap(notYet.globalObject, [
      "constructs a Console of an alias of console",
      `const output = console; new output.Console(process.stdout).dir({}, JSON.parse(process.argv[2]));`,
    ]),
    [
      "defines properties by unknown descriptors",
      `console.log(Object.defineProperties({}, JSON.parse(process.argv[2])));`,
    ],
    [
      "has a built-in module install its inspector under the symbol that Bun.inspect holds",
      `const own = function ${inspector}; console.log(require("node:querystring").decode("a=b", null, null, { decodeURIComponent: (text: string) => (text === "a" ? Bun.inspect.custom : own) }));`,
    ],
  ])("util.inspect may read any member where the program %s", async (_, text) => {
    expect(usesEveryMember(await closedReport(text))).toBe(true);
  });

  const replacing = `(depth: any, options: any, inspect: any) { inspect.styles = function () {};`;
  const called = `("return 42", "constructor")();`;
  eachRow([
    [
      "replaces the styles in an inspector of its own and takes stylize by its position",
      `const custom = Symbol.for("nodejs.util.inspect.custom"); console.log({ [custom]${replacing} return (Object.values(options) as any[])[0]${called} } });`,
    ],
    [
      "stores on inspect under an unknown key",
      `const custom = Symbol.for("nodejs.util.inspect.custom"); console.log({ [custom](depth: any, options: any, inspect: any) { inspect[process.argv[2]] = function () {}; return options.stylize${called} } });`,
    ],
    [
      "takes the symbol from Bun.inspect",
      `console.log({ [Bun.inspect.custom]${replacing} return options.stylize${called} } });`,
    ],
    [
      "takes the symbol from Bun.inspect by its position",
      `const custom: symbol = (Object.values(Bun.inspect) as any[])[0]; const holder: any = {}; holder[custom] = function ${replacing} return options.stylize${called} }; console.log(holder);`,
    ],
    [
      "installs such a symbol through Object.fromEntries",
      `const custom: symbol = (Object.values(Bun.inspect) as any[])[0]; console.log(Object.fromEntries([[custom, function ${replacing} return options.stylize${called} }]]));`,
    ],
    [
      "takes inspect, the symbol and the table of node:util by their positions",
      `const inspect: any = (Object.values(require("node:util")) as any[])[Number(process.argv[2])]; const custom: any = (Object.values(inspect) as any[])[0]; console.log({ [custom](depth: any, options: any) { Object.setPrototypeOf((Object.values(inspect) as any[])[2], function () {}); return options.stylize${called} } });`,
    ],
    [
      "takes the table by its position and the setter of prototypes out of a table of its own",
      `const custom = Symbol.for("nodejs.util.inspect.custom"); const own: any = { a: 1 }; console.log({ [custom](depth: any, options: any, inspect: any) { own[process.argv[2]].call({}, process.argv[3]).call((Object.values(inspect) as any[])[2], function () {}); return options.stylize${called} } });`,
    ],
    [
      "reaches Symbol without its name and concatenates the string",
      `const unnamed: any = Symbol("a").constructor; console.log({ [unnamed.for("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`,
    ],
    [
      "stores the inspector under a variable that holds such a symbol",
      `const unnamed: any = Symbol("a").constructor; const custom = unnamed.for("nodejs.util.inspect." + process.argv[2]); const holder: any = {}; holder[custom] = function ${replacing} return options.stylize${called} }; console.log(holder);`,
    ],
    [
      "asks the constructor of a wrapped symbol",
      `console.log({ [Object(Symbol.iterator).constructor.for("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`,
    ],
    [
      "asks the constructor on the prototype of a symbol",
      `console.log({ [Object.getPrototypeOf(Symbol.iterator).constructor.for("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`,
    ],
    [
      "asks what a function of its own found",
      `const found = (value: any) => value.constructor; console.log({ [found(Symbol.iterator).for("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`,
    ],
    [
      "takes Symbol.for by Reflect.get",
      `const unnamed: any = Object(Symbol.iterator).constructor; console.log({ [Reflect.get(unnamed, "for")("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`,
    ],
    [
      "takes Symbol.for out of the constructor of a well-known symbol",
      `const { for: register } = Symbol.iterator.constructor as any; console.log({ [register("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`,
    ],
    [
      "has an emitter write the key for it: a listener under the name, the table by its position",
      `const emitter = new (require("node:events"))(); emitter.on("styles", Reflect.getPrototypeOf(function () {})); console.log({ [Symbol.for("nodejs.util.inspect.custom")](depth: any, options: any, inspect: any) { Object.assign(inspect, Object.values(emitter)[0]); return options.stylize${called} } });`,
    ],
    [
      "lists the symbols of a URL",
      `console.log({ [Object.getOwnPropertySymbols(Object.getPrototypeOf(new URL("http://x/")))[0]]${replacing} return options.stylize${called} } });`,
    ],
    [
      "lists the keys of a URL",
      `console.log({ [Reflect.ownKeys(Object.getPrototypeOf(new URL("http://x/")))[0]]${replacing} return options.stylize${called} } });`,
    ],
    [
      "answers for the symbol with a Proxy in the prototype chain",
      `console.log(Object.create(new Proxy({}, { get() { return function ${replacing} return options.stylize${called} }; } })));`,
    ],
  ])("util.inspect may read any member where the program can have an inspector of its own: it %s", async (_, text) => {
    // Each of them comes by the Function constructor in the end, and where the compiler sees that, the report is open.
    expect(usesEveryMember(await of(hostClasses + text))).toBe(true);
  });

  // TODO: the global object counts as escaped.
  test.todo(
    "util.inspect may read any member where the program loads node:dgram, whose errors are printed with getters",
    async () => {
      expect(usesEveryMember(await closedReport(`console.log(require("node:dgram").createSocket("udp4"));`))).toBe(
        true,
      );
    },
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
  test.each(builtinModules.filter(name => !letTheGlobalObjectEscape.includes(name)))(
    "only a call opens the report: requiring %s leaves it closed",
    requiringLeavesItClosed,
  );
  test.todo.each(letTheGlobalObjectEscape)(
    "only a call opens the report: requiring %s leaves it closed",
    requiringLeavesItClosed,
  );
});

// Each title says what was once taken for granted of the program. The compiler follows the value all the way instead: nothing blocks --trim, and neither the global object nor process nor Bun
// counts as handed to code that nobody sees. What such a program uses is what it names.
describe.concurrent("what the compiler follows, so that it is no longer so:", () => {
  test.each([
    [
      "util.inspect may read any member where the program defines a property under an unknown key",
      "console.log(Object.defineProperty({}, process.argv[2], { value: 1 }));",
    ],
    ["util.inspect may read any member where the program calls Bun.inspect", "console.log(Bun.inspect({ a: 1 }));"],
  ])("%s", async (_, text) => {
    expect(completeness(await of(text))).toEqual(closed);
  });
});
