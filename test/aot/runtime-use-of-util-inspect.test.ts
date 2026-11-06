// Where a program can make util.inspect read any member of a value, every member counts as used.
import { describe, expect } from "bun:test";
import { closed, completeness, notYet, type Use } from "./runtime-use-expectations";
import { of } from "./runtime-use-harness";
import { eachRow, gap, test } from "./supported";

async function closedReport(text: string) {
  const use = await of(text);
  expect({ ...completeness(use), exitCode: use.exitCode }).toEqual({ ...closed, exitCode: 0 });
  return use;
}

const usesEveryMember = (use: Use) => use.lines.includes("property toTemporalInstant");
const hostClasses = `declare const URL: any, performance: any;\n`;

describe.concurrent("the built-in code that is part of every program", () => {
  const inspector = `(depth: any, options: any, inspect: any) { return inspect({}, JSON.parse(process.argv[2])); }`;
  eachRow([
    ["calls util.inspect", `console.log(require("node:util").inspect({}, JSON.parse(process.argv[2])));`],
    gap(notYet.globalObject, [
      "constructs a Console",
      `new console.Console(process.stdout).dir({}, JSON.parse(process.argv[2]));`,
    ]),
    [
      "has an inspector of its own in a class",
      `class Own { [Symbol.for("nodejs.util.inspect.custom")]${inspector} } console.log(new Own());`,
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
      "takes the symbol from Bun.inspect by its position",
      `const custom: symbol = (Object.values(Bun.inspect) as any[])[0]; const holder: any = {}; holder[custom] = function ${replacing} return options.stylize${called} }; console.log(holder);`,
    ],
    [
      "reaches Symbol without its name and concatenates the string",
      `const unnamed: any = Symbol("a").constructor; console.log({ [unnamed.for("nodejs.util.inspect." + process.argv[2])]${replacing} return options.stylize${called} } });`,
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
});
