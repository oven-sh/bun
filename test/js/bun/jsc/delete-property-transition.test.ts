import { describe as describeCell } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// JavaScriptCore keeps, in the Structure that an object has, the Structure that the delete of a property moves it
// to. The next object that loses the same property gets that Structure again. The lookup never found what was
// stored for a property that is non-enumerable, read-only or an accessor. So each such delete made a Structure of
// its own, each property added after it made one more, and no inline cache ever took such a delete.

function structureOf(value: object): string {
  const description = describeCell(value);
  const id = /StructureID: (\d+)/.exec(description)?.[1];
  if (id === undefined) throw new Error("no StructureID in: " + description);
  return id;
}

/** All the objects stay alive while they are counted: a Structure that nothing uses is collected and its id is used again. */
function structuresOf(make: (i: number) => object, count = 100): number {
  const made = Array.from({ length: count }, (_, i) => make(i));
  return new Set(made.map(structureOf)).size;
}

const define = (object: object, key: PropertyKey, descriptor: PropertyDescriptor): any =>
  Object.defineProperty(object, key, { configurable: true, ...descriptor });

const symbol = Symbol("a");

// This file is a module, so the function is strict and `length` is an own, non-enumerable property from the start.
function argumentsOf(_a?: unknown, _b?: unknown): any {
  return arguments;
}

class Reported extends Error {
  // The statements of the constructor of SQL.PostgresError.
  constructor(message: string, options: Record<string, string>) {
    super(message);
    delete (this as any).line;
    delete (this as any).column;
    this.name = "Reported";
    for (const key of ["code", "detail", "line", "column"]) {
      if (options[key] !== undefined) (this as any)[key] = options[key];
    }
  }
}

// Each one deletes a property whose attributes are not 0. The number is how many Structures 100 objects end on.
const shapes: [name: string, structures: number, make: (i: number) => object][] = [
  [
    "a non-enumerable property, then an add",
    1,
    () => {
      const o = define({}, "a", { value: 1, writable: true });
      delete o.a;
      o.b = 1;
      return o;
    },
  ],
  [
    "a read-only property",
    1,
    () => {
      const o = define({}, "a", { value: 1, enumerable: true });
      delete o.a;
      return o;
    },
  ],
  [
    "a getter",
    1,
    () => {
      const o: any = {
        get a() {
          return 1;
        },
      };
      delete o.a;
      return o;
    },
  ],
  [
    "a symbol",
    1,
    () => {
      const o = define({}, symbol, { value: 1 });
      delete o[symbol];
      return o;
    },
  ],
  [
    "Reflect.deleteProperty",
    1,
    () => {
      const o = define({}, "a", { value: 1 });
      Reflect.deleteProperty(o, "a");
      return o;
    },
  ],
  [
    "a Proxy without a trap",
    1,
    () => {
      const target = define({}, "a", { value: 1 });
      delete new Proxy(target, {}).a;
      return target;
    },
  ],
  [
    "a property that became non-enumerable later",
    1,
    () => {
      const o: any = { a: 1 };
      define(o, "a", { enumerable: false });
      delete o.a;
      return o;
    },
  ],
  [
    "a property that is added again",
    1,
    () => {
      const o = define({}, "a", { value: 1 });
      delete o.a;
      o.a = 1;
      return o;
    },
  ],
  [
    "two properties",
    1,
    () => {
      const o = define(define({}, "a", { value: 1 }), "b", { value: 2 });
      delete o.a;
      delete o.b;
      return o;
    },
  ],
  [
    "one of two properties",
    2,
    i => {
      const o = define(define({}, "a", { value: 1 }), "b", { value: 2 });
      if (i & 1) delete o.a;
      else delete o.b;
      return o;
    },
  ],
  [
    "the stack of an Error",
    1,
    () => {
      const error = new Error("message");
      delete error.stack;
      return error;
    },
  ],
  [
    "the name of a function",
    1,
    () => {
      const f: any = function () {};
      delete f.name;
      return f;
    },
  ],
  [
    "the length of arguments",
    1,
    () => {
      const args = argumentsOf(1, 2);
      delete args.length;
      return args;
    },
  ],
  [
    "a second Error.captureStackTrace",
    1,
    () => {
      const error = new Error("message");
      Error.captureStackTrace(error);
      Error.captureStackTrace(error);
      return error;
    },
  ],
  ["a class that deletes the line and column of its Error", 1, () => new Reported("message", { code: "C" })],
  [
    "that class with the fields of two kinds of error",
    2,
    i => new Reported("message", i & 1 ? { code: "C", line: "12", column: "c" } : { code: "C", detail: "d" }),
  ],
];

describe("objects that lose the same property get the same Structure", () => {
  test.each(shapes)("%s", (_, structures, make) => {
    expect(structuresOf(make)).toBe(structures);
  });
});

// The cases below need a delete site that the compilers have. One child runs them all. The compilers run on its main
// thread, so the same number of calls gets a site to the same compiler each time.
const hotSites = `
  const vm = require("node:vm");
  const { noInline, setTimeZone } = require("bun:jsc");
  const results = {};

  {
    const descriptors = [
      { value: 1, writable: true, configurable: true },
      { value: 1, enumerable: true, configurable: true },
      { get() { return 1; }, set(value) {}, enumerable: true, configurable: true },
      { value: 1, configurable: true },
    ];
    function deleteA(o) { return delete o.a; }
    function deleteKey(o, key) { return delete o[key]; }
    noInline(deleteA);
    noInline(deleteKey);

    const wrong = new Set();
    for (let i = 0; i < 3000; i++) {
      const kind = i & 3;
      const o = Object.defineProperty({ x: 1 }, "a", descriptors[kind]);
      o.y = 2;
      const result = i & 4 ? deleteA(o) : deleteKey(o, "a");
      if (result !== true || "a" in o || o.x !== 1 || o.y !== 2) wrong.add("kind " + kind);
      o.a = i;
      if (o.a !== i) wrong.add("add after kind " + kind);
    }

    // A property that is not configurable is still refused at these sites: false, or a TypeError in strict code.
    const fixed = Object.defineProperty({ x: 1 }, "a", { value: 1 });
    const refused = [o => deleteA(o), o => deleteKey(o, "a")].map(site => {
      try {
        return site(fixed) === false;
      } catch (error) {
        return error instanceof TypeError;
      }
    });
    results.attributes = { wrong: [...wrong], refused, value: fixed.a };
  }

  {
    const { strictArguments, sloppyArguments, deleteCallee, deleteLength, deleteCalleeAfterLength } = new Function(
      "function strict() { 'use strict'; return arguments; }" +
        "function target(a, b) { return inner(); }" +
        "function inner() { return target.arguments; }" +
        "return {" +
        "  strictArguments: () => strict(1, 2)," +
        "  sloppyArguments: () => target(1, 2)," +
        "  deleteCallee(o) { return delete o.callee; }," +
        "  deleteLength(o) { return delete o.length; }," +
        "  deleteCalleeAfterLength(o) { return delete o.callee; }," +
        "};",
    )();
    noInline(deleteCallee);
    noInline(deleteLength);
    noInline(deleteCalleeAfterLength);

    const wrong = { strict: 0, strictAfterLength: 0, sloppy: 0, sloppyAfterLength: 0 };
    for (let i = 0; i < 1500; i++) {
      if (deleteCallee(strictArguments()) !== false) wrong.strict++;
      const args = strictArguments();
      deleteLength(args);
      if (deleteCalleeAfterLength(args) !== false) wrong.strictAfterLength++;
    }
    for (let i = 0; i < 100; i++) {
      let args = sloppyArguments();
      if (deleteCallee(args) !== true || "callee" in args) wrong.sloppy++;
      args = sloppyArguments();
      deleteLength(args);
      if (deleteCalleeAfterLength(args) !== true || "callee" in args || args[0] !== 1) wrong.sloppyAfterLength++;
    }
    results.functionArguments = wrong;
  }

  {
    const deleteGlobal = new Function("return delete declaredLater;");
    noInline(deleteGlobal);
    let missing = 0;
    for (let i = 0; i < 1500; i++) missing += deleteGlobal() === true;
    vm.runInThisContext('var declaredLater = {"a": 1};');
    results.globalVar = { missing, result: deleteGlobal(), value: declaredLater.a };
  }

  {
    function deleteTZ() { return delete process.env.TZ; }
    noInline(deleteTZ);
    deleteTZ();
    const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zoneOfTheHost = zone();
    for (let i = 0; i < 300; i++) deleteTZ();
    setTimeZone("Asia/Tokyo");
    const hourInTokyo = new Date(0).getHours();
    const result = deleteTZ();
    results.timeZone = { result, hourInTokyo, resetToTheZoneOfTheHost: zone() === zoneOfTheHost };
  }

  console.log(JSON.stringify(results));
`;

let child: Promise<Record<string, unknown>> | undefined;
async function runHotSites() {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", hotSites],
    env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(stdout);
}

describe("a delete site that is hot", () => {
  test("does for such a property what the first delete did", async () => {
    const { attributes } = await (child ??= runHotSites());
    expect(attributes).toEqual({ wrong: [], refused: [true, true], value: 1 });
  });

  test("does not answer for function.arguments after it saw the arguments of strict functions", async () => {
    // `callee` is made when it is asked for: an accessor that is not configurable for the arguments of a strict
    // function, an ordinary property for function.arguments of a sloppy one. Both kinds have one Structure until then,
    // also after a delete of `length`. The sites are sloppy: a strict delete of the accessor throws and is never cached.
    const { functionArguments } = await (child ??= runHotSites());
    expect(functionArguments).toEqual({ strict: 0, strictAfterLength: 0, sloppy: 0, sloppyAfterLength: 0 });
  });

  test("refuses a global var that a script declared after the site was hot", async () => {
    // A script that is only `var name = <JSON>` declares the variable and leaves the Structure of the global object
    // as it is. The global object answers for its variables from a table of its own.
    const { globalVar } = await (child ??= runHotSites());
    expect(globalVar).toEqual({ missing: 1500, result: false, value: 1 });
  });

  test("still resets the time zone for process.env.TZ", async () => {
    // The delete of TZ also drops the time zone that is in use. The object that process.env is has that in its own
    // delete, which a cached delete does not call.
    const { timeZone } = await (child ??= runHotSites());
    expect(timeZone).toEqual({ result: true, hourInTokyo: 9, resetToTheZoneOfTheHost: true });
  });
});
