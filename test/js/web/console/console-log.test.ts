import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

it("should log to console correctly", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), join(import.meta.dir, "console-log.js")],
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await exited;
  const err = (await stderr.text()).replaceAll("\r\n", "\n");
  const out = (await stdout.text()).replaceAll("\r\n", "\n");
  const expected = (await new Response(file(join(import.meta.dir, "console-log.expected.txt"))).text()).replaceAll(
    "\r\n",
    "\n",
  );

  const errMatch = err === "uh oh\n";
  const outmatch = out === expected;

  if (errMatch && outmatch && exitCode === 0) {
    expect().pass();
    return;
  }

  console.error(err);
  console.log("Length of output:", out.length);
  console.log("Length of expected:", expected.length);
  console.log("Exit code:", exitCode);

  expect(out).toBe(expected);
  expect(err).toBe("uh oh\n");
  expect(exitCode).toBe(0);
});

it("long arrays get cutoff", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(Array(1000).fill(0))).toEqual(
    "[\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  ... 900 more items\n" +
      "]",
  );
});

it("long arrays get cutoff at a nested indent", () => {
  const row = "          4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,\n";
  expect(Bun.inspect([[[[Array(1000).fill(4)]]]], { depth: 5 })).toEqual(
    "[\n  [\n    [\n      [\n        [\n" +
      row +
      row +
      row +
      row +
      "          4, 4, 4, 4,\n" +
      "          ... 900 more items\n" +
      "        ]\n      ]\n    ]\n  ]\n]",
  );
});

it("console.group", async () => {
  const filepath = join(import.meta.dir, "console-group.fixture.js").replaceAll("\\", "/");
  const proc = Bun.spawnSync({
    cmd: [bunExe(), filepath],
    env: { ...bunEnv, "BUN_JSC_showPrivateScriptsInStackTraces": "0" },
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(proc.exitCode).toBe(0);
  let stdout = proc.stdout
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .trim()
    .replaceAll(filepath, "<file>");
  let stderr = proc.stderr
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .trim()
    .replaceAll(filepath, "<file>")
    // Normalize line numbers for consistency between debug and release builds
    .replace(/\(\d+:\d+\)/g, "(N:NN)")
    .replace(/<file>:\d+:\d+/g, "<file>:NN:NN");
  expect(stdout).toMatchInlineSnapshot(`
"Basic group
  Inside basic group
Outer group
  Inside outer group
  Inner group
    Inside inner group
  Back to outer group
Level 1
  Level 2
    Level 3
      Deep inside
undefined
Empty nested
Test extra end
  Inside
Different logs
  Regular log
  Info log
  Debug log
Complex types
  {
    a: 1,
    b: 2,
  }
  [ 1, 2, 3 ]
null
  undefined
    0
      false
        
          Inside falsy groups
🎉 Unicode!
  Inside unicode group
  Tab\tNewline
Quote"Backslash
    Special chars"
`);
  expect(stderr).toMatchInlineSnapshot(`
"Warning log
  warn: console.warn an error
      at <file>:NN:NN

  52 | console.group("Different logs");
53 | console.log("Regular log");
54 | console.info("Info log");
55 | console.warn("Warning log");
56 | console.warn(new Error("console.warn an error"));
57 | console.error(new Error("console.error an error"));
                       ^
error: console.error an error
      at <file>:NN:NN

  53 | console.log("Regular log");
54 | console.info("Info log");
55 | console.warn("Warning log");
56 | console.warn(new Error("console.warn an error"));
57 | console.error(new Error("console.error an error"));
58 | console.error(new NamedError("console.error a named error"));
                   ^
NamedError: console.error a named error
      at <file>:NN:NN

  NamedError: console.warn a named error
      at <file>:NN:NN

  Error log"
`);
});

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

describe("console.dir with customInspect: false", () => {
  // `K` has a hook. `G` has its hook behind an accessor, so a read of the hook counts too.
  // `report()` runs each row and prints one "name: calls=N gets=N" line to stderr.
  const prelude = /* js */ `
    const custom = Symbol.for("nodejs.util.inspect.custom");
    let calls = 0;
    let gets = 0;
    const hook = () => (calls++, "HOOK");
    class K {
      [custom]() {
        return hook();
      }
    }
    class G {
      get [custom]() {
        gets++;
        return hook;
      }
    }
    const jsx = (type, props) => ({ $$typeof: Symbol.for("react.element"), type, key: null, ref: null, props });
    // The global of another context: the same kind of value as globalThis, with a short listing.
    const vmGlobal = require("node:vm").runInNewContext("globalThis");
    vmGlobal[custom] = hook;
    const off = { customInspect: false };
    function report(rows) {
      for (const [name, row] of Object.entries(rows)) {
        calls = gets = 0;
        row();
        console.error(name + ": calls=" + calls + " gets=" + gets);
      }
    }
  `;

  async function run(script: string) {
    await using proc = spawn({
      cmd: [bunExe(), "-e", prelude + script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const lines = (...rows: string[]) => rows.join("\n") + "\n";

  it.concurrent("runs no hook anywhere in the value", async () => {
    const { stderr, exitCode } = await run(/* js */ `
      // The first read says "no hook", the second read returns the hook.
      let reads = 0;
      const flipping = Object.defineProperty(jsx("b", {}), custom, {
        get() {
          gets++;
          return reads++ === 0 ? undefined : hook;
        },
      });

      report({
        "top level": () => console.dir(new K(), off),
        "accessor hook": () => console.dir(new G(), off),
        "nested property": () => console.dir({ a: { b: new K() } }, off),
        "array element": () => console.dir([1, new K()], off),
        "Map key and value": () => console.dir(new Map([[new K(), new G()]]), off),
        "Set entry": () => console.dir(new Set([new K()]), off),
        "Map iterator": () => console.dir(new Map([[1, new K()]]).entries(), off),
        "Set iterator": () => console.dir(new Set([new K()]).values(), off),
        "Proxy target": () => console.dir(new Proxy(new G(), {}), off),
        "Proxy target in an array": () => console.dir([new Proxy(new K(), {})], off),
        "toJSON() result": () => console.dir(Object.assign(new URLSearchParams("a=1"), { toJSON: () => new G() }), off),
        "JSX children": () => console.dir(jsx("div", { children: new G() }), off),
        "JSX child that is classified twice": () => console.dir(jsx("div", { children: flipping }), off),
        "error property, then a sibling": () => console.dir([Object.assign(new Error("boom"), { k: new K() }), new G()], off),
        "global object": () => console.dir(vmGlobal, off),
        "Proxy of a global object": () => console.dir(new Proxy(vmGlobal, {}), off),
      });
    `);

    expect({ stderr, exitCode }).toEqual({
      stderr: lines(
        "top level: calls=0 gets=0",
        "accessor hook: calls=0 gets=0",
        "nested property: calls=0 gets=0",
        "array element: calls=0 gets=0",
        "Map key and value: calls=0 gets=0",
        "Set entry: calls=0 gets=0",
        "Map iterator: calls=0 gets=0",
        "Set iterator: calls=0 gets=0",
        "Proxy target: calls=0 gets=0",
        "Proxy target in an array: calls=0 gets=0",
        "toJSON() result: calls=0 gets=0",
        "JSX children: calls=0 gets=0",
        "JSX child that is classified twice: calls=0 gets=0",
        "error property, then a sibling: calls=0 gets=0",
        "global object: calls=0 gets=0",
        "Proxy of a global object: calls=0 gets=0",
      ),
      exitCode: 0,
    });
  });

  it.concurrent("reads the option like depth and colors", async () => {
    const { stderr, exitCode } = await run(/* js */ `
      const dir = options => () => console.dir(new K(), options);

      report({
        "false": dir({ customInspect: false }),
        "null": dir({ customInspect: null }),
        "zero": dir({ customInspect: 0 }),
        "empty string": dir({ customInspect: "" }),
        "NaN": dir({ customInspect: NaN }),
        "0n": dir({ customInspect: 0n }),
        "inherited": dir(Object.create({ customInspect: false })),
        "on a function": dir(Object.assign(() => {}, { customInspect: false })),
        // This row counts the reads of the option in "gets".
        "getter": dir({
          get customInspect() {
            gets++;
            return false;
          },
        }),

        "no options": () => console.dir(new K()),
        "empty options": dir({}),
        "undefined": dir({ customInspect: undefined }),
        "true": dir({ customInspect: true }),
        "one": dir({ customInspect: 1 }),
        "the string 'false'": dir({ customInspect: "false" }),
        "options is not an object": dir(false),
        "third argument": () => console.dir(new K(), {}, off),
        "on Object.prototype": () => {
          Object.prototype.customInspect = false;
          try {
            console.dir(new K(), {});
          } finally {
            delete Object.prototype.customInspect;
          }
        },
      });
    `);

    expect({ stderr, exitCode }).toEqual({
      stderr: lines(
        "false: calls=0 gets=0",
        "null: calls=0 gets=0",
        "zero: calls=0 gets=0",
        "empty string: calls=0 gets=0",
        "NaN: calls=0 gets=0",
        "0n: calls=0 gets=0",
        "inherited: calls=0 gets=0",
        "on a function: calls=0 gets=0",
        "getter: calls=0 gets=1",

        "no options: calls=1 gets=0",
        "empty options: calls=1 gets=0",
        "undefined: calls=1 gets=0",
        "true: calls=1 gets=0",
        "one: calls=1 gets=0",
        "the string 'false': calls=1 gets=0",
        "options is not an object: calls=1 gets=0",
        "third argument: calls=1 gets=0",
        "on Object.prototype: calls=1 gets=0",
      ),
      exitCode: 0,
    });
  });

  it.concurrent("throws what the option's getter throws and prints nothing", async () => {
    const result = await run(/* js */ `
      try {
        console.dir(new K(), {
          get customInspect() {
            throw new Error("getter threw");
          },
        });
      } catch (error) {
        console.log("caught:", error.message, calls);
      }
    `);

    expect(result).toEqual({ stdout: "caught: getter threw 0\n", stderr: "", exitCode: 0 });
  });

  it.concurrent("applies to that call only", async () => {
    const { stderr, exitCode } = await run(/* js */ `
      class SizeLogs extends Map {
        get size() {
          console.log(new K());
          return 0;
        }
      }
      const dirFromHook = {
        [custom]() {
          console.dir(new K(), off);
          return "OUTER";
        },
      };

      report({
        "console.dir(off), console.log, console.dir": () => {
          console.dir(new K(), off);
          console.log(new K());
          console.dir(new K());
        },
        "console.log from a getter that console.dir(off) reads": () => console.dir(new SizeLogs(), off),
        "console.dir(off) from a hook that console.log calls": () => console.log([dirFromHook, new K()]),
        "console.log": () => console.log(new K(), off),
        "console.dirxml": () => console.dirxml(new K(), off),
        "%o": () => console.log("%o", new K(), off),
        "console.table": () => console.table([{ k: new K() }]),
        "Bun.inspect": () => Bun.inspect(new K()),
      });
    `);

    expect({ stderr, exitCode }).toEqual({
      stderr: lines(
        "console.dir(off), console.log, console.dir: calls=2 gets=0",
        "console.log from a getter that console.dir(off) reads: calls=1 gets=0",
        "console.dir(off) from a hook that console.log calls: calls=1 gets=0",
        "console.log: calls=1 gets=0",
        "console.dirxml: calls=1 gets=0",
        "%o: calls=1 gets=0",
        "console.table: calls=1 gets=0",
        "Bun.inspect: calls=1 gets=0",
      ),
      exitCode: 0,
    });
  });

  // The native formatter lists prototype members (https://github.com/oven-sh/bun/issues/1713),
  // so with the hooks off a class prints its hook as one of them.
  it("prints the value without its hook", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      const values = [
        new K(),
        new URL("http://example.com/a"),
        new ReadableStream(),
        Buffer.from("hi"),
        vmGlobal,
        new Proxy(vmGlobal, {}),
      ];
      for (const value of values) {
        console.dir(value);
        console.dir(value, off);
      }
    `);

    expect(stdout).toMatchInlineSnapshot(`
      "HOOK
      K {
        [Symbol(nodejs.util.inspect.custom)]: [Function],
      }
      URL {
        href: 'http://example.com/a',
        origin: 'http://example.com',
        protocol: 'http:',
        username: '',
        password: '',
        host: 'example.com',
        hostname: 'example.com',
        port: '',
        pathname: '/a',
        search: '',
        searchParams: URLSearchParams {},
        hash: ''
      }
      URL {
        href: "http://example.com/a",
        origin: "http://example.com",
        protocol: "http:",
        username: "",
        password: "",
        host: "example.com",
        hostname: "example.com",
        port: "",
        pathname: "/a",
        hash: "",
        search: "",
        searchParams: URLSearchParams {},
        toJSON: [Function: toJSON],
        toString: [Function: toString],
        [Symbol(nodejs.util.inspect.custom)]: [Function: anonymous],
      }
      ReadableStream { locked: false, state: 'readable', supportsBYOB: false }
      ReadableStream {
        locked: false,
        cancel: [Function: cancel],
        getReader: [Function: getReader],
        pipeThrough: [Function: pipeThrough],
        pipeTo: [Function: pipeTo],
        tee: [Function: tee],
        values: [Function: values],
        blob: [Function: blob],
        bytes: [Function: bytes],
        json: [Function: json],
        text: [Function: text],
        [Symbol(Symbol.asyncIterator)]: [Function: values],
        [Symbol(nodejs.stream.readable)]: true,
        [Symbol(nodejs.stream.errored)]: false,
        [Symbol(nodejs.stream.disturbed)]: false,
        [Symbol(nodejs.util.inspect.custom)]: [Function: anonymous],
      }
      <Buffer 68 69>
      Buffer(2) [ 104, 105 ]
      HOOK
      JSGlobalProxy {}
      HOOK
      JSGlobalProxy {}
      "
    `);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });
});
