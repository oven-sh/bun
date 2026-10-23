import assert from "assert";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir, withoutAggressiveGC } from "harness";
import { Console } from "node:console";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import util from "util";
import constructorNameRows from "./constructor-name-fixture.cjs";

const { constructorNames, builtinNames, differsFromNode, getterRuns, builtinName } = constructorNameRows;

test("no assertion failures", () => {
  // Errors in accessors are not triggered
  const obj = new Proxy(
    { x: 5 },
    {
      get() {
        throw new Error("Error message");
      },
    },
  );
  assert.strictEqual(util.format(obj), "{ x: 5 }");

  assert.strictEqual(util.formatWithOptions({ numericSeparator: true }, "%d", 4000), "4_000");

  const a = {};
  a.b = a;
  assert.strictEqual(util.inspect(a, { compact: false }), "<ref *1> {\n  b: [Circular *1]\n}");
  assert.strictEqual(util.inspect(a, { compact: true }), "<ref *1> { b: [Circular *1] }");

  const cause = new Error("cause");
  const e2 = new Error("wrapper", { cause });
  assert.match(util.inspect(e2), /\[cause\]: Error: cause\n/);
});

test("boxed BigInt/Symbol with no prototype are still formatted as boxed primitives", () => {
  assert.strictEqual(util.inspect(Object.setPrototypeOf(Object(55n), null)), "[BigInt (null prototype): 55n]");
  assert.strictEqual(
    util.inspect(Object.setPrototypeOf(Object(Symbol("x")), null)),
    "[Symbol (null prototype): Symbol(x)]",
  );
});

// Arrays and typed arrays collect their non-index keys through the native
// getOwnNonIndexProperties (UtilInspect.cpp). These pin down what it has to
// report: string and symbol keys in ownKeys order, non-enumerable keys only
// with showHidden, and numeric-looking keys that are not array indices.
test("util.inspect reports the non-index keys of an array", () => {
  const array = [1, 2];
  array[Symbol("sym")] = "s";
  array.str = "v";
  Object.defineProperty(array, "hiddenStr", { value: 1, enumerable: false });
  Object.defineProperty(array, Symbol("hiddenSym"), { value: 2, enumerable: false });
  array["4294967295"] = "not an index";
  array["01"] = "not canonical";

  expect(util.inspect(array)).toBe(
    "[\n" +
      "  1,\n" +
      "  2,\n" +
      "  str: 'v',\n" +
      "  '4294967295': 'not an index',\n" +
      "  '01': 'not canonical',\n" +
      "  Symbol(sym): 's'\n" +
      "]",
  );
  expect(util.inspect(array, { showHidden: true })).toBe(
    "[\n" +
      "  1,\n" +
      "  2,\n" +
      "  [length]: 2,\n" +
      "  str: 'v',\n" +
      "  [hiddenStr]: 1,\n" +
      "  '4294967295': 'not an index',\n" +
      "  '01': 'not canonical',\n" +
      "  Symbol(sym): 's',\n" +
      "  [Symbol(hiddenSym)]: 2\n" +
      "]",
  );

  class Sub extends Array {}
  const sub = Sub.from([1]);
  sub.extra = 1;
  expect(util.inspect(sub)).toBe("Sub(1) [ 1, extra: 1 ]");

  const sparse = [];
  sparse[3] = 1;
  sparse.extra = 1;
  expect(util.inspect(sparse, { showHidden: true })).toBe("[ <3 empty items>, 1, [length]: 4, extra: 1 ]");
});

test("util.inspect reports the non-index keys of a typed array", () => {
  const u8 = new Uint8Array([1, 2]);
  u8[Symbol("sym")] = "s";
  u8.str = "v";
  Object.defineProperty(u8, "hiddenStr", { value: 1, enumerable: false });
  Object.defineProperty(u8, Symbol("hiddenSym"), { value: 2, enumerable: false });

  expect(util.inspect(u8)).toBe("Uint8Array(2) [ 1, 2, str: 'v', Symbol(sym): 's' ]");
  expect(util.inspect(u8, { showHidden: true })).toBe(
    "Uint8Array(2) [\n" +
      "  1,\n" +
      "  2,\n" +
      "  [BYTES_PER_ELEMENT]: 1,\n" +
      "  [length]: 2,\n" +
      "  [byteLength]: 2,\n" +
      "  [byteOffset]: 0,\n" +
      "  [buffer]: ArrayBuffer { [byteLength]: 2 },\n" +
      "  str: 'v',\n" +
      "  [hiddenStr]: 1,\n" +
      "  Symbol(sym): 's',\n" +
      "  [Symbol(hiddenSym)]: 2\n" +
      "]",
  );
});

// The rows and what they test are in the fixture.
test.each(constructorNames)("util.inspect names a value from data properties: %s", (_, print, expected, runs = []) => {
  getterRuns.length = 0;
  expect({ printed: print(), getterRuns }).toEqual({ printed: expected, getterRuns: runs });
});

test.each(builtinNames)("util.inspect names a built-in value by its type: %s", (_, make, name) => {
  expect(builtinName(make)).toEqual({ value: name, prototype: name });
});

test.each(differsFromNode)("util.inspect does not name %s as Node.js does", (_, print, printed) => {
  expect(print()).toBe(printed);
});

// The expected strings are those of the Node.js version that Bun reports. Another version can print other names.
const node = nodeExe();
async function nodeVersion() {
  if (!node) return undefined;
  await using proc = Bun.spawn({ cmd: [node, "-p", "process.versions.node"], env: bunEnv, stderr: "ignore" });
  return (await proc.stdout.text()).trim();
}

test.skipIf((await nodeVersion()) !== process.versions.node)(
  "Node.js prints the names that the rows expect",
  async () => {
    await using proc = Bun.spawn({
      cmd: [node, "--experimental-shadow-realm", join(import.meta.dir, "constructor-name-fixture.cjs")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ printed: JSON.parse(stdout.trim() || "null"), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      printed: {
        constructorNames: constructorNames.map(([label, , printed, getterRuns = []]) => ({
          label,
          printed,
          getterRuns,
        })),
        builtinNames: builtinNames.map(([label, , name, value = name]) => ({ label, value, prototype: name })),
        differsFromNode: differsFromNode.map(([label, , , printed]) => ({ label, printed })),
      },
      stderr: "",
      exitCode: 0,
    });
  },
);

test("util.inspect does not take the name of a module namespace from an export named constructor", async () => {
  // Each key of a JSON file is an export. The namespace object of Bun has a prototype, so the lookup names it.
  using dir = tempDir("inspect-namespace", { "data.json": '{"constructor":{"name":{"toString":1}}}' });
  const namespace = await import(pathToFileURL(join(String(dir), "data.json")).href);
  expect({ value: util.inspect(namespace), pastDepth: util.inspect({ a: namespace }, { depth: 0 }) }).toEqual({
    value:
      "Module <[Object: null prototype] {}> [Module] {\n" +
      "  constructor: { name: { toString: 1 } },\n" +
      "  default: { constructor: { name: [Object] } }\n" +
      "}",
    pastDepth: "{ a: [Module <Complex prototype> [Module]] }",
  });
});

test("util.inspect does not read the prototype that import.meta hides", () => {
  // import.meta reports no prototype. The object in its structure has the tag ImportMeta.
  expect(util.inspect(Object.create(import.meta))).toStartWith("Object <[Object: null prototype]");
});

test("util.inspect calls no Proxy trap to name a value", () => {
  const traps = [];
  const handler = new Proxy(
    {},
    {
      get(_, trap) {
        return (target, key, ...rest) => {
          traps.push(typeof key === "symbol" ? `${trap} ${key.description}` : `${trap} ${key}`);
          return Reflect[trap](target, key, ...rest);
        };
      },
    },
  );
  // Both the Proxy and the child of the Proxy get a name from the lookup.
  const printed = util.inspect(Object.create(new Proxy(Object.create({ __proto__: null }), handler)));
  expect({
    printed,
    // formatRaw reads the tag of the printed value once, through the Proxy.
    gets: traps.filter(trap => trap === "get constructor" || trap === "get Symbol.toStringTag"),
  }).toEqual({
    printed: "Object <Object <[Object: null prototype] {}>> {}",
    gets: ["get Symbol.toStringTag"],
  });
});

// `Console` of node:console prints with util.inspect. The global console has its own printer.
test("every way into util.inspect prints a value whose constructor getter throws", () => {
  let runs = 0;
  const make = () =>
    Object.create({
      __proto__: null,
      get constructor() {
        runs++;
        throw new Error("the constructor getter ran");
      },
    });
  const printed = "Object <[Object: null prototype]> {}";
  const written = [];
  const sink = new Writable({
    write(chunk, encoding, callback) {
      written.push(String(chunk));
      callback();
    },
  });
  const logger = new Console(sink);
  logger.log(make());
  logger.dir(make());
  let assertionError;
  try {
    assert.strictEqual(make(), 1);
  } catch (error) {
    assertionError = error;
  }

  expect({
    inspect: util.inspect(make()),
    format: util.format(make()),
    formatS: util.format("%s", make()),
    formatO: util.format("%O", make()),
    formatWithOptions: util.formatWithOptions({ colors: false }, "%o", make()),
    inArray: util.inspect([make()]),
    customInspectArgument: util.inspect({ [util.inspect.custom]: (depth, options, inspect) => inspect(make()) }),
    console: written,
    assertionError: [assertionError?.code, assertionError?.message.includes(printed)],
    runs,
  }).toEqual({
    inspect: printed,
    format: printed,
    formatS: printed,
    formatO: printed,
    formatWithOptions: printed,
    inArray: `[ ${printed} ]`,
    customInspectArgument: printed,
    console: [`${printed}\n`, `${printed}\n`],
    assertionError: ["ERR_ASSERTION", true],
    runs: 0,
  });
});

test("a replaced Object.prototype.toString or RegExp.prototype[Symbol.match] does not change a name", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let calls = 0;
        Object.prototype.toString = function () {
          calls++;
          return "[object Replaced]";
        };
        const match = RegExp.prototype[Symbol.match];
        RegExp.prototype[Symbol.match] = function (string) {
          calls++;
          return match.call(this, string);
        };
        // Loaded after the replacements.
        const { inspect } = require("node:util");
        const printed = [inspect(Object.create(Object.create(null))), inspect({ a: Object.create(null) }, { depth: 0 })];
        console.log(JSON.stringify({ printed, calls }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim() || "null"), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
    out: {
      printed: ["Object <[Object: null prototype] {}> {}", "{ a: [Object: null prototype] {} }"],
      calls: 0,
    },
    stderr: "",
    exitCode: 0,
  });
});

function fastestOf(runs, fn) {
  let fastest = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

test.each([
  [
    "Array",
    length => Object.assign(new Array(length).fill(7), { extra: true }),
    length => `[ 7, 7, 7, ... ${length - 3} more items, [length]: ${length}, extra: true ]`,
  ],
  [
    "Uint8Array",
    length => Object.assign(new Uint8Array(length), { extra: true }),
    length =>
      `Uint8Array(${length}) [\n` +
      "  0,\n" +
      "  0,\n" +
      "  0,\n" +
      `  ... ${length - 3} more items,\n` +
      "  [BYTES_PER_ELEMENT]: 1,\n" +
      `  [length]: ${length},\n` +
      `  [byteLength]: ${length},\n` +
      "  [byteOffset]: 0,\n" +
      `  [buffer]: ArrayBuffer { [byteLength]: ${length} },\n` +
      "  extra: true\n" +
      "]",
  ],
])("util.inspect of a large %s does not visit every element", (_, create, expected) => {
  const options = { maxArrayLength: 3, showHidden: true };
  const small = create(1_000);
  const large = create(1_000_000);
  expect(util.inspect(small, options)).toBe(expected(1_000));
  expect(util.inspect(large, options)).toBe(expected(1_000_000));

  withoutAggressiveGC(() => {
    const smallMs = fastestOf(5, () => util.inspect(small, options));
    const largeMs = fastestOf(5, () => util.inspect(large, options));
    // With the keys collected through Object.getOwnPropertyDescriptors() this
    // scaled with the length: about 1s for the large one in a release build.
    expect(largeMs).toBeLessThan(smallMs * 20 + 50);
  });
});

//! non-standard property, should this be kept?
test.skip("util.stylizeWithHTML", () => {
  assert.strictEqual(
    util.inspect(
      {
        a: 1,
        b: "<p>\xA0\u{1F4A9}</p>",
        "&lt;": NaN,
        [Symbol("<br>")]: false,
        buf: new Uint8Array([1, 2, 3, 4]),
      },
      {
        compact: false,
        stylize: util.stylizeWithHTML,
      },
    ),
    "{\n" +
      '  a: <span style="color:yellow;">1</span>,\n' +
      '  b: <span style="color:green;">&apos;&lt;p&gt;&nbsp;\u{1F4A9}&lt;&#47;p&gt;&apos;</span>,\n' +
      '  <span style="color:green;">&apos;&amp;lt&#59;&apos;</span>: <span style="color:yellow;">NaN</span>,\n' +
      "  buf: Uint8Array(4) [\n" +
      '    <span style="color:yellow;">1</span>,\n' +
      '    <span style="color:yellow;">2</span>,\n' +
      '    <span style="color:yellow;">3</span>,\n' +
      '    <span style="color:yellow;">4</span>\n' +
      "  ],\n" +
      '  [<span style="color:green;">Symbol&#40;&lt;br&gt;&#41;</span>]: <span style="color:yellow;">false</span>\n' +
      "}",
  );
});
