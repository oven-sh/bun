import { jscInternals } from "bun:internal-for-testing";
import { describe, expect, it, jest } from "bun:test";
import {
  bunEnv,
  bunExe,
  isASAN,
  isWindows,
  normalizeBunSnapshot,
  tempDir,
  tmpdirSync,
  withoutAggressiveGC,
} from "harness";
import { join } from "path";
import util from "util";
import vm from "vm";
it("prototype", () => {
  const prototypes = [
    Request.prototype,
    Response.prototype,
    Blob.prototype,
    Headers.prototype,
    URL.prototype,
    URLSearchParams.prototype,
    ReadableStream.prototype,
    WritableStream.prototype,
    TransformStream.prototype,
    MessageEvent.prototype,
    CloseEvent.prototype,
    WebSocket.prototype,
  ];

  for (let prototype of prototypes) {
    for (let i = 0; i < 10; i++) expect(Bun.inspect(prototype).length > 0).toBeTrue();
  }
  Bun.gc(true);
});

it("getters", () => {
  const obj = {
    get foo() {
      return 42;
    },
  };

  expect(Bun.inspect(obj)).toBe("{\n" + "  foo: [Getter]," + "\n" + "}");
  var called = false;
  const objWithThrowingGetter = {
    get foo() {
      called = true;
      throw new Error("Test failed!");
    },
    set foo(v) {
      called = true;
      throw new Error("Test failed!");
    },
  };

  expect(Bun.inspect(objWithThrowingGetter)).toBe("{\n" + "  foo: [Getter/Setter]," + "\n" + "}");
  expect(called).toBe(false);
});

it("setters", () => {
  const obj = {
    set foo(x) {},
  };

  expect(Bun.inspect(obj)).toBe("{\n" + "  foo: [Setter]," + "\n" + "}");
  var called = false;
  const objWithThrowingGetter = {
    get foo() {
      called = true;
      throw new Error("Test failed!");
    },
    set foo(v) {
      called = true;
      throw new Error("Test failed!");
    },
  };

  expect(Bun.inspect(objWithThrowingGetter)).toBe("{\n" + "  foo: [Getter/Setter]," + "\n" + "}");
  expect(called).toBe(false);
});

it("getter/setters", () => {
  const obj = {
    get foo() {
      return 42;
    },

    set foo(x) {},
  };

  expect(Bun.inspect(obj)).toBe("{\n" + "  foo: [Getter/Setter]," + "\n" + "}");
});

it("Timeout", () => {
  const id = setTimeout(() => {}, 0);
  expect(Bun.inspect(id)).toBe(`Timeout (#${+id})`);

  const id2 = setInterval(() => {}, 1);
  id2.unref();
  expect(Bun.inspect(id2)).toBe(`Timeout (#${+id2}, repeats)`);
});

it("when prototype defines the same property, don't print the same property twice", () => {
  var base = {
    foo: "123",
  };
  var obj = Object.create(base);
  obj.foo = "456";
  expect(Bun.inspect(obj).trim()).toBe('{\n  foo: "456",\n}'.trim());
});

it("every reference back to a native object is circular", () => {
  const glob = new Bun.Glob("a");
  Object.assign(glob, { a: glob, b: glob });
  expect(Bun.inspect(glob, { depth: Infinity })).toStartWith("Glob {\n  a: [Circular],\n  b: [Circular],\n");
});

it("Blob inspect", () => {
  expect(Bun.inspect(new Blob(["123"]))).toBe(`Blob (3 bytes)`);
  expect(Bun.inspect(new Blob(["123".repeat(900)]))).toBe(`Blob (2.70 KB)`);
  const tmpFile = join(tmpdirSync(), "file.txt");
  expect(Bun.inspect(Bun.file(tmpFile))).toBe(`FileRef ("${tmpFile}") {
  type: "text/plain;charset=utf-8"
}`);
  expect(Bun.inspect(Bun.file(123))).toBe(`FileRef (fd: 123) {
  type: "application/octet-stream"
}`);
  expect(Bun.inspect(new Response(new Blob()))).toBe(`Response (0 KB) {
  ok: true,
  url: "",
  status: 200,
  statusText: "",
  headers: Headers {},
  redirected: false,
  bodyUsed: false,
  Blob (0 KB)
}`);
  expect(Bun.inspect(new Response("Hello"))).toBe(`Response (5 bytes) {
  ok: true,
  url: "",
  status: 200,
  statusText: "",
  headers: Headers {},
  redirected: false,
  bodyUsed: false,
  Blob (5 bytes)
}`);
});

it("Response and Request print no size for a Bun.file() body whose size is unknown", () => {
  using dir = tempDir("inspect-unknown-size", {});
  const firstLines = file => [
    Bun.inspect(new Response(file)).split("\n")[0],
    Bun.inspect(new Request("http://example.com/", { method: "POST", body: file })).split("\n")[0],
  ];
  expect({
    missing: firstLines(Bun.file(join(String(dir), "missing.txt"))),
    directory: firstLines(Bun.file(String(dir))),
  }).toEqual({
    missing: ["Response {", "Request {"],
    directory: ["Response {", "Request {"],
  });
});

it("printing a Response over a Bun.file() that does not exist yet leaves its body as it is", async () => {
  using dir = tempDir("inspect-missing-then-created", {});
  const path = join(String(dir), "later.txt");
  const response = new Response(Bun.file(path));
  const before = Bun.inspect(response).split("\n")[0];
  await Bun.write(path, "created");
  expect({ before, after: Bun.inspect(response).split("\n")[0], text: await response.text() }).toEqual({
    before: "Response {",
    after: "Response (7 bytes) {",
    text: "created",
  });
});

it("utf16 property name", () => {
  var { Database } = require("bun:sqlite");
  const db = Database.open(":memory:");
  expect("笑".codePointAt(0)).toBe(31505);

  // latin1 escaping identifier issue
  expect(Object.keys({ 笑: "hey" })[0].codePointAt(0)).toBe(31505);

  const output = Bun.inspect(
    [
      {
        笑: "😀",
      },
    ],
    2,
  );
  expect(Bun.inspect(db.prepare("select '😀' as 笑").all())).toBe(output);
});

it("latin1", () => {
  expect(Bun.inspect("English")).toBe('"English"');
  expect(Bun.inspect("Français")).toBe('"Français"');
  expect(Bun.inspect("Ελληνική")).toBe('"Ελληνική"');
  expect(Bun.inspect("日本語")).toBe('"日本語"');
  expect(Bun.inspect("Emoji😎")).toBe('"Emoji😎"');
  expect(Bun.inspect("Français / Ελληνική")).toBe('"Français / Ελληνική"');
});

it("Request object", () => {
  expect(Bun.inspect(new Request({ url: "https://example.com" })).trim()).toBe(
    `
Request (0 KB) {
  method: "GET",
  url: "https://example.com/",
  headers: Headers {}
}`.trim(),
  );
});

it("MessageEvent", () => {
  expect(Bun.inspect(new MessageEvent("message", { data: 123 }))).toBe(
    `MessageEvent {
  type: "message",
  data: 123,
}`,
  );
});

it("MessageEvent with no data set", () => {
  expect(Bun.inspect(new MessageEvent("message"))).toBe(
    `MessageEvent {
  type: "message",
  data: null,
}`,
  );
});

it("MessageEvent with deleted data", () => {
  const event = new MessageEvent("message");
  Object.defineProperty(event, "data", {
    value: 123,
    writable: true,
    configurable: true,
  });
  delete event.data;
  expect(Bun.inspect(event)).toBe(
    `MessageEvent {
  type: "message",
  data: null,
}`,
  );
});

// https://github.com/oven-sh/bun/issues/561
it("TypedArray prints", () => {
  for (let TypedArray of [
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Uint8ClampedArray,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
  ]) {
    const buffer = new TypedArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const input = Bun.inspect(buffer);

    expect(input).toBe(`${TypedArray.name}(${buffer.length}) [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]`);
    for (let i = 1; i < buffer.length + 1; i++) {
      expect(Bun.inspect(buffer.subarray(i))).toBe(
        buffer.length - i === 0
          ? `${TypedArray.name}(${buffer.length - i}) []`
          : `${TypedArray.name}(${buffer.length - i}) [ ` + [...buffer.subarray(i)].join(", ") + " ]",
      );
    }
  }
});

it("BigIntArray", () => {
  for (let TypedArray of [BigInt64Array, BigUint64Array]) {
    const buffer = new TypedArray([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n]);
    const input = Bun.inspect(buffer);

    expect(input).toBe(`${TypedArray.name}(${buffer.length}) [ 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n ]`);
    for (let i = 1; i < buffer.length + 1; i++) {
      expect(Bun.inspect(buffer.subarray(i))).toBe(
        buffer.length - i === 0
          ? `${TypedArray.name}(${buffer.length - i}) []`
          : `${TypedArray.name}(${buffer.length - i}) [ ` +
              [...buffer.subarray(i)].map(a => a.toString(10) + "n").join(", ") +
              " ]",
      );
    }
  }
});

it.concurrent("TypedArray over an ArrayBuffer at an odd address prints", async () => {
  const types = [
    ["Int16Array", "getInt16", ""],
    ["Uint16Array", "getUint16", ""],
    ["Int32Array", "getInt32", ""],
    ["Uint32Array", "getUint32", ""],
    ["Float16Array", "getFloat16", ""],
    ["Float32Array", "getFloat32", ""],
    ["Float64Array", "getFloat64", ""],
    ["BigInt64Array", "getBigInt64", "n"],
    ["BigUint64Array", "getBigUint64", "n"],
  ];
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { ptr, toArrayBuffer } from "bun:ffi";
        const bytes = new Uint8Array(32).map((_, i) => i + 1);
        // Moves the bytes of a small typed array, so it comes before ptr().
        bytes.buffer;
        const address = ptr(bytes) + 1;
        for (const name of ${JSON.stringify(types.map(([name]) => name))}) {
          console.log(new globalThis[name](toArrayBuffer(address, 0, 16)));
        }
        console.log(address % 2, bytes[0]);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const view = new DataView(new Uint8Array(32).map((_, i) => i + 1).buffer, 1, 16);
  const expected = types.map(([name, get, suffix]) => {
    const size = globalThis[name].BYTES_PER_ELEMENT;
    const elements = Array.from({ length: 16 / size }, (_, i) => view[get](i * size, true) + suffix);
    return `${name}(${elements.length}) [ ${elements.join(", ")} ]`;
  });
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual([...expected, "1 1"]);
  expect(exitCode).toBe(0);
});

for (let TypedArray of [Float32Array, Float64Array]) {
  it(TypedArray.name + " " + Math.fround(42.68), () => {
    const buffer = new TypedArray([Math.fround(42.68)]);
    const input = Bun.inspect(buffer);

    expect(input).toBe(`${TypedArray.name}(${buffer.length}) [ ${[Math.fround(42.68)].join(", ")} ]`);
    for (let i = 1; i < buffer.length + 1; i++) {
      expect(Bun.inspect(buffer.subarray(i))).toBe(
        buffer.length - i === 0
          ? `${TypedArray.name}(${buffer.length - i}) []`
          : `${TypedArray.name}(${buffer.length - i}) [ ` + [...buffer.subarray(i)].join(", ") + " ]",
      );
    }
  });

  it(TypedArray.name + " " + 42.68, () => {
    const buffer = new TypedArray([42.68]);
    const input = Bun.inspect(buffer);

    expect(input).toBe(
      `${TypedArray.name}(${buffer.length}) [ ${[TypedArray === Float32Array ? Math.fround(42.68) : 42.68].join(", ")} ]`,
    );
    for (let i = 1; i < buffer.length + 1; i++) {
      expect(Bun.inspect(buffer.subarray(i))).toBe(
        buffer.length - i === 0
          ? `${TypedArray.name}(${buffer.length - i}) []`
          : `${TypedArray.name}(${buffer.length - i}) [ ` + [...buffer.subarray(i)].join(", ") + " ]",
      );
    }
  });
}

it("jsx with two elements", () => {
  const input = Bun.inspect(
    <div hello="quoted">
      <input type="text" value={"123"} />
      string inside child
    </div>,
  );

  const output = `<div hello="quoted">
  <input type="text" value="123" />
  string inside child
</div>`;

  expect(input).toBe(output);
});

const Foo = () => <div hello="quoted">foo</div>;

it("jsx with anon component", () => {
  const input = Bun.inspect(<Foo />);

  const output = `<NoName />`;

  expect(input).toBe(output);
});

it("jsx with fragment", () => {
  const input = Bun.inspect(<>foo bar</>);

  const output = `<>foo bar</>`;

  expect(input).toBe(output);
});

it("inspect", () => {
  expect(Bun.inspect(new TypeError("what")).includes("TypeError: what")).toBe(true);
  expect(Bun.inspect("hi")).toBe('"hi"');
  expect(Bun.inspect(1)).toBe("1");
  expect(Bun.inspect(NaN)).toBe("NaN");
  expect(Bun.inspect(Infinity)).toBe("Infinity");
  expect(Bun.inspect(-Infinity)).toBe("-Infinity");
  expect(Bun.inspect([])).toBe("[]");
  expect(Bun.inspect({})).toBe("{}");
  expect(Bun.inspect({ hello: 1 })).toBe("{\n  hello: 1,\n}");
  expect(Bun.inspect({ hello: 1, there: 2 })).toBe("{\n  hello: 1,\n  there: 2,\n}");
  expect(Bun.inspect({ hello: "1", there: 2 })).toBe('{\n  hello: "1",\n  there: 2,\n}');
  expect(Bun.inspect({ 'hello-"there': "1", there: 2 })).toBe('{\n  "hello-\\"there": "1",\n  there: 2,\n}');
  var str = "123";
  while (str.length < 4096) {
    str += "123";
  }
  expect(Bun.inspect(str)).toBe('"' + str + '"');
  // expect(Bun.inspect(new Headers())).toBe("Headers (0 KB) {}");
  expect(Bun.inspect(new Response()).length > 0).toBe(true);
  // expect(
  //   JSON.stringify(
  //     new Headers({
  //       hi: "ok",
  //     })
  //   )
  // ).toBe('{"hi":"ok"}');
  expect(Bun.inspect(new Set())).toBe("Set {}");
  expect(Bun.inspect(new Map())).toBe("Map {}");
  expect(Bun.inspect(new Map([["foo", "bar"]]))).toBe('Map(1) {\n  "foo": "bar",\n}');
  expect(Bun.inspect(new Set(["bar"]))).toBe('Set(1) {\n  "bar",\n}');

  // Regression test: Set/Map with overridden size property should not panic
  const setWithOverriddenSize = new Set();
  Object.defineProperty(setWithOverriddenSize, "size", {
    writable: true,
    enumerable: true,
    value: Set,
  });
  expect(Bun.inspect(setWithOverriddenSize)).toBe("Set {}");

  const mapWithOverriddenSize = new Map();
  Object.defineProperty(mapWithOverriddenSize, "size", {
    writable: true,
    enumerable: true,
    value: "not a number",
  });
  expect(Bun.inspect(mapWithOverriddenSize)).toBe("Map {}");
  expect(Bun.inspect(<div>foo</div>)).toBe("<div>foo</div>");
  expect(Bun.inspect(<div hello>foo</div>)).toBe("<div hello=true>foo</div>");
  expect(Bun.inspect(<div hello={1}>foo</div>)).toBe("<div hello=1>foo</div>");
  expect(Bun.inspect(<div hello={123}>hi</div>)).toBe("<div hello=123>hi</div>");
  expect(Bun.inspect(<div hello="quoted">quoted</div>)).toBe('<div hello="quoted">quoted</div>');
  expect(
    Bun.inspect(
      <div hello="quoted">
        <input type="text" value={"123"} />
      </div>,
    ),
  ).toBe(
    `
<div hello="quoted">
  <input type="text" value="123" />
</div>`.trim(),
  );
  expect(Bun.inspect(BigInt(32))).toBe("32n");
  expect(Bun.inspect({ call: 1, not_call: 2, prototype: 4 })).toBe(
    `
{
  call: 1,
  not_call: 2,
  prototype: 4,
}
    `.trim(),
  );
});

describe("latin1 supplemental", () => {
  const fixture = [
    [["äbc"], '[ "äbc" ]'],
    [["cbä"], '[ "cbä" ]'],
    [["cäb"], '[ "cäb" ]'],
    [["äbc äbc"], '[ "äbc äbc" ]'],
    [["cbä cbä"], '[ "cbä cbä" ]'],
    [["cäb cäb"], '[ "cäb cäb" ]'],
  ];

  for (let [input, output] of fixture) {
    it(`latin1 (input) \"${input}\" ${output}`, () => {
      expect(Bun.inspect(input)).toBe(output);
    });
  }
  // this test is failing:
  it(`latin1 (property key)`, () => {
    expect(
      Object.keys({
        ä: 1,
      })[0].codePointAt(0),
    ).toBe(228);
  });
});

const tmpdir = tmpdirSync();
const fixture = [
  () => globalThis,
  () => Bun.file(join(tmpdir, "log.txt")).stream(),
  () => Bun.file(join(tmpdir, "log.1.txt")).stream().getReader(),
  () => Bun.file(join(tmpdir, "log.2.txt")).writer(),
  () =>
    new WritableStream({
      write(chunk) {},
    }),
  () => require("events"),
  () => {
    return new (import.meta.require("events").EventEmitter)();
  },
  async () => await import("node:assert"),
  async () => await import("../../empty.js.js"),
  () => import.meta.require("./empty.js"),
  () => new Proxy({ yolo: 1 }, {}),
  () =>
    new Proxy(
      { yolo: 1 },
      {
        get(target, prop) {
          return prop + "!";
        },
        has(target, prop) {
          return true;
        },
        ownKeys() {
          return ["foo"];
        },
      },
    ),
];

describe("crash testing", () => {
  for (let input of fixture) {
    it(`inspecting "${input.toString().slice(0, 20).replaceAll("\n", "\\n")}" doesn't crash`, async () => {
      try {
        console.log("asked" + input.toString().slice(0, 20).replaceAll("\n", "\\n"));
        Bun.inspect(await input());
        console.log("who");
      } catch (e) {
        // this can throw its fine
      }
    });
  }
});

it("possibly formatted emojis log", () => {
  expect(Bun.inspect("✔")).toBe('"✔"');
});

it("new Date(..)", () => {
  let s = Bun.inspect(new Date(1679911059000 - new Date().getTimezoneOffset()));
  expect(s).toContain("2023-03-27T");
  expect(s).toHaveLength(24);
  let offset = new Date().getTimezoneOffset() / 60;
  let hour = (9 - offset).toString();
  if (hour.length === 1) {
    hour = "0" + hour;
  }
  expect(Bun.inspect(new Date("March 27, 2023 " + hour + ":54:00"))).toBe("2023-03-27T09:54:00.000Z");
  expect(Bun.inspect(new Date("2023-03-27T" + hour + ":54:00"))).toBe("2023-03-27T09:54:00.000Z");
  expect(Bun.inspect(new Date(2023, 2, 27, -offset))).toBe("2023-03-27T00:00:00.000Z");
  expect(Bun.inspect(new Date(2023, 2, 27, 9 - offset, 54, 0))).toBe("2023-03-27T09:54:00.000Z");

  expect(Bun.inspect(new Date("1679911059000"))).toBe("Invalid Date");
  expect(Bun.inspect(new Date("hello world"))).toBe("Invalid Date");
  expect(Bun.inspect(new Date("Invalid Date"))).toBe("Invalid Date");
});

it("Bun.inspect.custom exists", () => {
  expect(Bun.inspect.custom).toBe(util.inspect.custom);
});

// JSC passes its own scope object as `this` when a native function is called through a captured variable.
// These functions return a `this` of the wrong class unchanged, which would leak that scope object to JS.
it("a built-in's [Bun.inspect.custom] called without a receiver never returns an object", () => {
  const returned = {};
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    const inspectCustom = globalThis[name]?.prototype?.[Bun.inspect.custom];
    if (typeof inspectCustom !== "function") continue;
    returned[name] = [[], [-1], [2, {}]].map(args => {
      try {
        return (() => inspectCustom(...args))();
      } catch (error) {
        return error.name;
      }
    });
  }
  expect(Object.keys(returned)).toContainValues([
    "ReadableStream",
    "WritableStream",
    "URL",
    "URLSearchParams",
    "CryptoKey",
  ]);
  expect(Object.entries(returned).filter(([, results]) => results.some(result => typeof result === "object"))).toEqual(
    [],
  );
});

it("native inspect.custom functions return undefined when called without a receiver", () => {
  const classes = [
    ByteLengthQueuingStrategy,
    CountQueuingStrategy,
    CryptoKey,
    PerformanceEntry,
    ReadableByteStreamController,
    ReadableStream,
    ReadableStreamBYOBReader,
    ReadableStreamBYOBRequest,
    ReadableStreamDefaultController,
    ReadableStreamDefaultReader,
    TransformStream,
    TransformStreamDefaultController,
    URL,
    URLSearchParams,
    WritableStream,
    WritableStreamDefaultController,
    WritableStreamDefaultWriter,
  ];
  const results = classes.map(klass => {
    const inspectCustom = klass.prototype[util.inspect.custom];
    // When a closed-over binding is called bare, JSC passes the scope object as `this`.
    const bare = () => inspectCustom(-1, {});
    // util.inspect falls back to its default formatting when inspect.custom returns its receiver unchanged.
    const ordinaryReceiver = {};
    const roundTripped = inspectCustom.call(ordinaryReceiver, -1, {}) === ordinaryReceiver;
    return [klass.name, typeof inspectCustom, bare(), roundTripped];
  });
  expect(results).toEqual(classes.map(klass => [klass.name, "function", undefined, true]));
});

describe("Functions with names", () => {
  const closures = [
    () => function f() {},
    () => {
      var f = function () {};
      return f;
    },
    () => {
      const f = function () {};
      // workaround transpiler inlining losing the display name
      // TODO: preserve the name on functions being inlined
      f.length;
      return f;
    },
    () => {
      let f = function () {};
      // workaround transpiler inlining losing the display name
      // TODO: preserve the name on functions being inlined
      f.length;
      return f;
    },
    () => {
      var f = function f() {};
      return f;
    },
    () => {
      var foo = function f() {};
      return foo;
    },
    () => {
      function f() {}
      var foo = f;
      return foo;
    },
  ];

  for (let closure of closures) {
    it(JSON.stringify(closure.toString()), () => {
      expect(Bun.inspect(closure())).toBe("[Function: f]");
    });
  }
});

it("Bun.inspect array with non-indexed properties", () => {
  const a = [1, 2, 3];
  a.length = 42;
  a[18] = 24;
  a.potato = "hello";
  console.log(a);
  expect(Bun.inspect(a)).toBe(`[
  1, 2, 3, 15 x empty items, 24, 23 x empty items, potato: "hello"
]`);
});

// Printing a sparse array must never iterate index-by-index over the holes:
// `length` can be up to 2^32 - 1 with no elements in the array at all.
// Run it in a child so a regression times this test out instead of hanging the runner.
it("Bun.inspect huge sparse array summarizes holes without iterating them", async () => {
  const code = `
    const a = new Array(4_294_967_294);
    console.log(Bun.inspect(a));
    const b = [];
    b[4_294_967_292] = "x";
    console.log(Bun.inspect(b));
    const c = [1, 2, 3];
    c.length = 4_294_967_294;
    console.log(c);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout:
      "[\n  4294967294 x empty items\n]\n" +
      '[\n  4294967292 x empty items, "x"\n]\n' +
      "[\n  1, 2, 3, 4294967291 x empty items\n]\n",
    stderr: "",
    exitCode: 0,
  });
});

// A property lookup that throws while an object is being formatted (a Proxy trap in the
// prototype chain, a lazily initialized property whose initializer throws, a module namespace
// export that is still in its temporal dead zone) used to leave the exception pending: the
// lookups of the following properties failed and were dropped from the output or the formatter
// rethrew the exception from the next property, debug builds asserted, and moving on to the
// next prototype dereferenced the empty value returned by the throwing getPrototype. Each case
// runs in a child so a regression fails the test instead of taking down the runner.
describe.concurrent("Bun.inspect when a property lookup throws", () => {
  async function runChild(args, cwd) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const inspectInChild = code => runChild(["-e", code]);

  it("skips a prototype property whose Proxy get trap throws and keeps the rest", async () => {
    const result = await inspectInChild(`
      const proto = new Proxy({ a: 1, b: 2, c: 3 }, {
        get(target, key, receiver) {
          if (key === "b") throw new Error("get trap");
          return Reflect.get(target, key, receiver);
        },
      });
      const obj = Object.create(proto);
      obj.own = 0;
      console.log(Bun.inspect(obj));
    `);
    expect(result).toEqual({ stdout: "{\n  own: 0,\n  a: 1,\n  c: 3,\n}\n", stderr: "", exitCode: 0 });
  });

  it("skips a prototype getter that throws behind a Proxy and keeps the rest", async () => {
    const result = await inspectInChild(`
      const proto = new Proxy({ a: 1, get b() { throw new Error("getter"); }, c: 3 }, {});
      console.log(Bun.inspect(Object.create(proto)));
    `);
    expect(result).toEqual({ stdout: "{\n  a: 1,\n  c: 3,\n}\n", stderr: "", exitCode: 0 });
  });

  it("propagates a Proxy getPrototypeOf trap that throws while walking the prototype chain", async () => {
    // Matches util.inspect: a throwing getPrototypeOf trap is an error, not a display nicety.
    const result = await inspectInChild(`
      const proto = new Proxy({ a: 1 }, {
        getPrototypeOf() {
          throw new Error("getPrototypeOf trap");
        },
      });
      const obj = Object.create(proto);
      obj.own = 0;
      try {
        Bun.inspect(obj);
        console.log("no throw");
      } catch (e) {
        console.log("threw: " + e.message);
      }
    `);
    expect(result).toEqual({ stdout: "threw: getPrototypeOf trap\n", stderr: "", exitCode: 0 });
  });

  it("propagates an error thrown by toJSON while formatting", () => {
    const toJSON = () => {
      throw new Error("from toJSON");
    };
    const params = new URLSearchParams("a=1");
    params.toJSON = toJSON;
    expect(() => Bun.inspect(params)).toThrow("from toJSON");
    const headers = new Headers({ a: "1" });
    headers.toJSON = toJSON;
    expect(() => Bun.inspect(headers)).toThrow("from toJSON");
    const form = new FormData();
    form.append("a", "1");
    Object.defineProperty(form, "toJSON", { value: toJSON });
    expect(() => Bun.inspect(form)).toThrow("from toJSON");
  });

  it("skips a lazily initialized Bun property whose initializer throws and keeps the rest", async () => {
    // Bun.$ is the first property of the Bun object and is built by a builtin that calls
    // Symbol(), as are Bun.sql and Bun.SQL further down, so breaking Symbol makes those
    // initializers throw while Bun is formatted. Custom inspect functions (Bun.env has one on
    // Windows) load node:util the first time one runs, which also needs Symbol, so load it first.
    const result = await inspectInChild(`
      Bun.inspect({ [Bun.inspect.custom]() { return ""; } });
      globalThis.Symbol = 0;
      const out = Bun.inspect(Bun);
      console.log(JSON.stringify(["$", "Archive", "version"].map(key => out.includes("\\n  " + key + ": "))));
    `);
    expect(result).toEqual({ stdout: "[false,true,true]\n", stderr: "", exitCode: 0 });
  });

  it("skips a module namespace export that is in its temporal dead zone and keeps the rest", async () => {
    // b.mjs runs while a.mjs is still evaluating, so reading `later` off the namespace throws a
    // ReferenceError. console.log used to rethrow it; util.inspect prints such an export as
    // `<uninitialized>`, this formatter leaves it out.
    using dir = tempDir("inspect-tdz-namespace", {
      "a.mjs": `
        import "./b.mjs";
        export const later = 1;
        export function hoisted() {}
      `,
      "b.mjs": `
        import * as a from "./a.mjs";
        console.log(a);
      `,
    });
    const result = await runChild(["a.mjs"], String(dir));
    expect(result).toEqual({ stdout: "Module {\n  hoisted: [Function: hoisted],\n}\n", stderr: "", exitCode: 0 });
  });
});

describe("console.logging function displays async and generator names", async () => {
  const cases = [
    function () {},
    function a() {},
    async function b() {},
    function* c() {},
    async function* d() {},
    async function* () {},
  ];

  const expected_logs = [
    "[Function]",
    "[Function: a]",
    "[AsyncFunction: b]",
    "[GeneratorFunction: c]",
    "[AsyncGeneratorFunction: d]",
    "[AsyncGeneratorFunction]",
  ];

  for (let i = 0; i < cases.length; i++) {
    it(expected_logs[i], () => {
      expect(Bun.inspect(cases[i])).toBe(expected_logs[i]);
    });
  }
});
describe("console.logging class displays names and extends", async () => {
  class A {}
  const cases = [A, class B extends A {}, class extends A {}, class {}];

  const expected_logs = ["[class A]", "[class B extends A]", "[class (anonymous) extends A]", "[class (anonymous)]"];

  for (let i = 0; i < cases.length; i++) {
    it(expected_logs[i], () => {
      expect(Bun.inspect(cases[i])).toBe(expected_logs[i]);
    });
  }
});

it("console.log on a Blob shows name", () => {
  const blob = new Blob(["foo"], { type: "text/plain" });
  expect(Bun.inspect(blob)).toBe('Blob (3 bytes) {\n  type: "text/plain"\n}');
  blob.name = "bar";
  expect(Bun.inspect(blob)).toBe('Blob (3 bytes) {\n  name: "bar",\n  type: "text/plain"\n}');
  blob.name = "foobar";
  expect(Bun.inspect(blob)).toBe('Blob (3 bytes) {\n  name: "foobar",\n  type: "text/plain"\n}');

  const file = new File(["foo"], "bar.txt", { type: "text/plain" });
  expect(Bun.inspect(file)).toBe(
    `File (3 bytes) {\n  name: "bar.txt",\n  type: "text/plain",\n  lastModified: ${file.lastModified}\n}`,
  );
  file.name = "foobar";
  expect(Bun.inspect(file)).toBe(
    `File (3 bytes) {\n  name: "foobar",\n  type: "text/plain",\n  lastModified: ${file.lastModified}\n}`,
  );
  file.name = "";
  expect(Bun.inspect(file)).toBe(
    `File (3 bytes) {\n  name: "",\n  type: "text/plain",\n  lastModified: ${file.lastModified}\n}`,
  );
});

// https://github.com/oven-sh/bun/issues/29637
// An empty `new Blob([])` or `new File([])` has `store == null` internally,
// but that's identical to the state after the blob was transferred away. The
// inspect output used to call both "detached" — the empty case should render
// as a normal zero-byte blob/file instead.
it("empty Blob and File inspect as zero-byte, not detached", () => {
  expect(Bun.inspect(new Blob([]))).toBe("Blob (0 KB)");
  expect(Bun.inspect(new Blob())).toBe("Blob (0 KB)");

  const emptyFile = new File([], "empty.txt");
  expect(Bun.inspect(emptyFile)).toBe(
    `File (0 KB) {\n  name: "empty.txt",\n  lastModified: ${emptyFile.lastModified}\n}`,
  );

  // structuredClone round-trips through serialization that leaves the store
  // null when contents are empty — make sure the cloned form also renders
  // cleanly.
  const clonedBlob = structuredClone(new Blob([]));
  expect(Bun.inspect(clonedBlob)).toBe("Blob (0 KB)");

  const cloned = structuredClone({
    file: new File([], "example.txt"),
    blob: new Blob([]),
  });
  expect(Bun.inspect(cloned.blob)).toBe("Blob (0 KB)");
  expect(cloned.file).toBeInstanceOf(File);
  expect(cloned.file.name).toBe("example.txt");
  expect(cloned.file.size).toBe(0);
  // Make sure nothing in the combined output is flagged as detached.
  expect(Bun.inspect(cloned)).not.toContain("detached");
});

it("console.log on a arguments shows list", () => {
  function fn() {
    expect(Bun.inspect(arguments)).toBe(`[ 1, [ 1 ], [Function: fn] ]`);
  }
  fn(1, [1], fn);
});

it("console.log on null prototype", () => {
  expect(Bun.inspect(Object.create(null))).toBe("[Object: null prototype] {}");
});

it("Symbol", () => {
  expect(Bun.inspect(Symbol())).toBe("Symbol()");
  expect(Bun.inspect(Symbol(""))).toBe("Symbol()");
});

it("CloseEvent", () => {
  const closeEvent = new CloseEvent("close", {
    code: 1000,
    reason: "Normal",
  });
  expect(Bun.inspect(closeEvent).replace(/timeStamp: [\d.]+/, "timeStamp: 0")).toMatchInlineSnapshot(`
    "CloseEvent {
      isTrusted: false,
      wasClean: false,
      code: 1000,
      reason: "Normal",
      type: "close",
      target: null,
      currentTarget: null,
      eventPhase: 0,
      cancelBubble: false,
      bubbles: false,
      cancelable: false,
      defaultPrevented: false,
      composed: false,
      timeStamp: 0,
      srcElement: null,
      returnValue: true,
      composedPath: [Function: composedPath],
      stopPropagation: [Function: stopPropagation],
      stopImmediatePropagation: [Function: stopImmediatePropagation],
      preventDefault: [Function: preventDefault],
      initEvent: [Function: initEvent],
      NONE: 0,
      CAPTURING_PHASE: 1,
      AT_TARGET: 2,
      BUBBLING_PHASE: 3,
    }"
  `);
});

it("ErrorEvent", () => {
  const errorEvent = new ErrorEvent("error", {
    message: "Something went wrong",
    filename: "script.js",
    lineno: 42,
    colno: 10,
    error: new Error("Test error"),
  });
  expect(normalizeBunSnapshot(Bun.inspect(errorEvent)).replace(/\d+ \| /gim, "NNN |")).toMatchInlineSnapshot(`
    "ErrorEvent {
      type: "error",
      message: "Something went wrong",
      error: NNN |  const errorEvent = new ErrorEvent("error", {
    NNN |    message: "Something went wrong",
    NNN |    filename: "script.js",
    NNN |    lineno: 42,
    NNN |    colno: 10,
    NNN |    error: new Error("Test error"),
                         ^
    error: Test error
        at <anonymous> (file:NN:NN)
    ,
    }"
  `);
});

it("MessageEvent", () => {
  const messageEvent = new MessageEvent("message", {
    data: "Hello, world!",
    origin: "https://example.com",
    lastEventId: "123",
    source: null,
    ports: [],
  });
  expect(Bun.inspect(messageEvent)).toMatchInlineSnapshot(`
    "MessageEvent {
      type: "message",
      data: "Hello, world!",
    }"
  `);
});

it("CustomEvent", () => {
  const customEvent = new CustomEvent("custom", {
    detail: { value: 42, name: "test" },
    bubbles: true,
    cancelable: true,
  });
  expect(Bun.inspect(customEvent).replace(/timeStamp: [\d.]+/, "timeStamp: 0")).toMatchInlineSnapshot(`
    "CustomEvent {
      isTrusted: false,
      detail: {
        value: 42,
        name: "test",
      },
      initCustomEvent: [Function: initCustomEvent],
      type: "custom",
      target: null,
      currentTarget: null,
      eventPhase: 0,
      cancelBubble: false,
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      composed: false,
      timeStamp: 0,
      srcElement: null,
      returnValue: true,
      composedPath: [Function: composedPath],
      stopPropagation: [Function: stopPropagation],
      stopImmediatePropagation: [Function: stopImmediatePropagation],
      preventDefault: [Function: preventDefault],
      initEvent: [Function: initEvent],
      NONE: 0,
      CAPTURING_PHASE: 1,
      AT_TARGET: 2,
      BUBBLING_PHASE: 3,
    }"
  `);
});

describe.skipIf(!isASAN)("object mutated while being formatted", () => {
  it("does not read freed property tables", async () => {
    const fixture = `
      function makeParent() {
        const p = {};
        for (let i = 0; i < 8; i++) p["k" + i] = i;
        return p;
      }
      // Enough added properties to cross several PropertyTable capacity
      // doublings; each rehash frees the previous index vector.
      const addMany = o => { for (let i = 0; i < 256; i++) o["n" + i] = i; };
      const custom = Symbol.for("nodejs.util.inspect.custom");

      {
        // inspect.custom on a nested value adds properties to the parent mid-walk.
        const p = makeParent();
        let fired = 0;
        p.a = { [custom]() { if (!fired++) addMany(p); return "a"; } };
        p.z = 1;
        const s = Bun.inspect(p);
        console.log("custom add:", s.includes("z: 1"));
      }
      {
        // Same mutation through console.log instead of Bun.inspect.
        const p = makeParent();
        let fired = 0;
        p.a = { [custom]() { if (!fired++) addMany(p); return "a"; } };
        p.z = 1;
        console.log(p);
      }
      {
        // Deleting parent properties mid-walk.
        const p = makeParent();
        let fired = 0;
        p.a = { [custom]() { if (!fired++) { for (let i = 0; i < 8; i++) delete p["k" + i]; } return "a"; } };
        p.z = 1;
        const s = Bun.inspect(p);
        console.log("custom delete:", s.includes("z: 1"));
      }
      {
        // A getter on a built-in subclass (Map.size) is another way the
        // formatter runs user code for a nested value.
        const p = makeParent();
        let fired = 0;
        class M extends Map { get size() { if (!fired++) addMany(p); return super.size; } }
        p.a = new M([[1, 2]]);
        p.z = 1;
        const s = Bun.inspect(p);
        console.log("map size getter:", s.includes("z: 1"), fired > 0);
      }
      {
        // An object with no own properties is formatted by fast-walking its
        // prototype's structure; mutating the prototype mid-walk rehashes it.
        const proto = makeParent();
        let fired = 0;
        proto.a = { [custom]() { if (!fired++) addMany(proto); return "a"; } };
        proto.z = 1;
        const s = Bun.inspect(Object.create(proto));
        console.log("prototype walk:", s.includes("z: 1"), fired > 0);
      }
      {
        // Allocation churn + GC inside the hook, with object-valued siblings
        // formatted afterwards: catches a snapshot that is invisible to GC.
        const p = makeParent();
        let fired = 0;
        p.a = { [custom]() {
          if (!fired++) {
            addMany(p);
            const junk = [];
            for (let i = 0; i < 200; i++) { const o = {}; for (let j = 0; j < 20; j++) o["q" + j] = j; junk.push(o); }
            Bun.gc(true);
          }
          return "a";
        } };
        for (let i = 0; i < 30; i++) p["s" + i] = { v: i };
        p.z = 1;
        const s = Bun.inspect(p);
        console.log("gc churn:", s.includes("z: 1") && s.includes("v: 29"));
      }
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        ...(isWindows ? {} : { Malloc: "1" }),
        // Skip symbolizing a failure report; symbolization of the debug
        // binary takes longer than the test timeout.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe(
      [
        "custom add: true",
        // console.log dump of the mutated parent: properties added by the
        // inspect.custom hook mid-format are not shown (the walk snapshots
        // the properties up front, like Node).
        "{",
        "  k0: 0,",
        "  k1: 1,",
        "  k2: 2,",
        "  k3: 3,",
        "  k4: 4,",
        "  k5: 5,",
        "  k6: 6,",
        "  k7: 7,",
        "  a: a,",
        "  z: 1,",
        "}",
        "custom delete: true",
        "map size getter: true true",
        "prototype walk: true true",
        "gc churn: true",
        "",
      ].join("\n"),
    );
    expect(stderr).not.toContain("AddressSanitizer");
    expect(exitCode).toBe(0);
  });
});

describe("a quoted string prints the same in 8-bit and 16-bit storage", () => {
  // The same characters in 16-bit storage. A string that is used as a property key can be swapped
  // for an equal atom of the other width, so each test asserts the widths that it depends on.
  const wide = s => Buffer.from(s, "utf16le").toString("utf16le");
  const fill = (n, character) => Buffer.alloc(n, character, "latin1").toString("latin1");
  const repeated = (n, text) => Buffer.alloc(n * Buffer.byteLength(text), text).toString();
  // The strings of a list that are in the other storage. One matcher call for a list: with the collector
  // that CI runs at each matcher call, a call for each string takes seconds.
  const notLatin1 = strings => strings.filter(s => !jscInternals.isLatin1String(s));
  const notUTF16 = strings => strings.filter(s => !jscInternals.isUTF16String(s));

  // What a character up to U+00FF prints as inside the quotes.
  const short = { 8: "\\b", 9: "\\t", 10: "\\n", 12: "\\f", 13: "\\r", 34: '\\"', 92: "\\\\" };
  const escapeOf = code =>
    short[code] ?? (code < 0x20 ? "\\u" + code.toString(16).toUpperCase().padStart(4, "0") : String.fromCharCode(code));
  // The whole string. A character above U+00FF prints as it is, half a surrogate pair as a `\u` escape in
  // lower case.
  const quoted = s =>
    '"' +
    s.replace(/[\x00-\x1f"\\]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, character => {
      const code = character.charCodeAt(0);
      return code > 0xff ? "\\u" + code.toString(16) : escapeOf(code);
    }) +
    '"';

  it.each([
    ["x", 0x78],
    ["é", 0xe9],
  ])("a list of two strings of %s breaks at the same length", (_, code) => {
    const narrow = Array.from({ length: 61 }, (_, i) => fill(30 + i, code));
    const twins = narrow.map(wide);
    const expected = narrow.map(s => (s.length < 76 ? `[ "${s}", "o" ]` : `[ "${s}",\n  "o"\n]`));
    expect(narrow.map(s => Bun.inspect([s, "o"]))).toEqual(expected);
    expect(twins.map(s => Bun.inspect([s, "o"]))).toEqual(expected);
    expect(notLatin1(narrow)).toEqual([]);
    expect(notUTF16(twins)).toEqual([]);
  });

  it("a list breaks by the columns of its strings", () => {
    const x40 = fill(40, "x");
    expect(Bun.inspect(JSON.parse(JSON.stringify(["中", x40, "o"])))).toBe(`[ "中", "${x40}", "o" ]`);
    expect(Bun.inspect(["中", wide(x40), "o"])).toBe(`[ "中", "${x40}", "o" ]`);

    const cjk = repeated(20, "中");
    expect(Bun.inspect([cjk, cjk, cjk, "o"])).toBe(`[ "${cjk}", "${cjk}",\n  "${cjk}", "o"\n]`);

    // A list breaks where the list of ASCII strings of the same columns does. The second number is the
    // columns of the character. Each is one unit, but 😀 is two.
    const rows = list =>
      Bun.inspect(list)
        .split("\n")
        .map(line => Bun.stringWidth(line));
    const printed = {};
    const expected = {};
    for (const [character, columns] of [
      ["中", 2],
      ["あ", 2],
      ["한", 2],
      ["Ａ", 2],
      ["、", 2],
      ["￥", 2],
      ["⭐", 2],
      ["😀", 2],
      ["ж", 1],
      ["ω", 1],
      ["→", 1],
      ["…", 1],
      ["€", 1],
    ]) {
      for (const [count, length] of [
        [4, 20],
        [12, 10],
        [30, 3],
      ]) {
        const name = `${count} strings of ${length} ${character}`;
        printed[name] = rows(Array.from({ length: count }, () => repeated(length, character)));
        expected[name] = rows(Array.from({ length: count }, () => fill(length * columns, "x")));
      }
    }
    expect(printed).toEqual(expected);

    // A wide character counts wherever it is in the string.
    const breaks = s => Bun.inspect([s, "o"]).includes("\n");
    const counts = Array.from({ length: 11 }, (_, i) => 15 + i);
    expect(counts.map(n => breaks(fill(33, "x") + repeated(n, "、")))).toEqual(
      counts.map(n => breaks(fill(33 + 2 * n, "x"))),
    );
  });

  it("every character up to U+00FF has the same escape", () => {
    const codes = Array.from({ length: 256 }, (_, code) => code);
    const narrow = codes.map(code => "a" + String.fromCharCode(code) + "b");
    const expected = codes.map(code => `"a${escapeOf(code)}b"`);
    expect(narrow.map(s => Bun.inspect(s))).toEqual(expected);
    const twins = narrow.map(wide);
    expect(twins.map(s => Bun.inspect(s))).toEqual(expected);
    expect(notLatin1(narrow)).toEqual([]);
    expect(notUTF16(twins)).toEqual([]);
    // With half a surrogate pair in it, a string is written one unit at a time.
    expect(codes.map(code => Bun.inspect("\ud800" + String.fromCharCode(code)))).toEqual(
      codes.map(code => `"\\ud800${escapeOf(code)}"`),
    );
  });

  describe("as a value", () => {
    const narrow = '\x1b[31m \x00\x0b\x0e\x1f "q" \\ \n é \x7f';
    const twin = wide(narrow);
    const text = '"\\u001B[31m \\u0000\\u000B\\u000E\\u001F \\"q\\" \\\\ \\n é \x7f"';

    it.each([
      ["at the top level", s => Bun.inspect(s), text],
      ["in an array", s => Bun.inspect([s]), `[ ${text} ]`],
      [
        "in an array that breaks",
        s => Bun.inspect([s, s, s, s, s]),
        `[ ${text}, ${text}, ${text}, ${text},\n  ${text}\n]`,
      ],
      ["as the value of a property", s => Bun.inspect({ k: s }), `{\n  k: ${text},\n}`],
      [
        "in a nested array",
        s => Bun.inspect({ a: [{ b: [s] }] }),
        `{\n  a: [\n    {\n      b: [ ${text} ],\n    }\n  ],\n}`,
      ],
      ["as a String object", s => Bun.inspect(new String(s)), text],
      ["in a Map", s => Bun.inspect(new Map([[s, s]])), `Map(1) {\n  ${text}: ${text},\n}`],
      ["in a Set", s => Bun.inspect(new Set([s])), `Set(1) {\n  ${text},\n}`],
      ["with colors", s => Bun.inspect([s], { colors: true }), `[ \x1b[0m\x1b[32m${text}\x1b[0m\x1b[0m ]`],
      [
        "as a property of an error",
        s =>
          Bun.inspect(Object.assign(new Error("message"), { detail: s }))
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("detail:")),
        [`detail: ${text},`],
      ],
      ["in a cell of a table", s => Bun.inspect.table([{ k: [s] }]).split("\n")[3], `│ 0 │ [ ${text} ] │`],
    ])("%s", (_, print, expected) => {
      expect(print(narrow)).toEqual(expected);
      expect(print(twin)).toEqual(expected);
      // Nothing above swapped the 16-bit string for the 8-bit one.
      expect(narrow).toBeLatin1String();
      expect(twin).toBeUTF16String();
    });

    it("in the message of a failed matcher", () => {
      const message = value => {
        try {
          expect(value).toBe(0);
        } catch (error) {
          return Bun.stripANSI(error.message);
        }
      };
      const expected = `expect(received).toBe(expected)\n\nExpected: 0\nReceived: [ ${text} ]\n`;
      expect(message([narrow])).toBe(expected);
      expect(message([twin])).toBe(expected);
    });

    it.concurrent("with console.log", async () => {
      const source = `
        const narrow = ${JSON.stringify(narrow)};
        for (const s of [narrow, Buffer.from(narrow, "utf16le").toString("utf16le")]) {
          console.log([s]);
          console.log(new String(s));
          console.log("%o", [s]);
          console.log({ k: s });
        }
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", source],
        env: bunEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const lines = `[ ${text} ]\n[String: ${text}]\n[ ${text} ]\n{\n  k: ${text},\n}\n`;
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: lines + lines, stderr: "", exitCode: 0 });
    });
  });

  it("text that only 16-bit storage can hold", () => {
    expect(Bun.inspect("\x1b é 日本 😎 \u{10334}")).toBe('"\\u001B é 日本 😎 \u{10334}"');
    expect(Bun.inspect(["a\u2028b\u2029c\ufeffd"])).toBe('[ "a\u2028b\u2029c\ufeffd" ]');
    expect(Bun.inspect(["\ud800", "\udc00x", "x\ud800"])).toBe('[ "\\ud800", "\\udc00x", "x\\ud800" ]');
    // Half a surrogate pair is escaped, a whole pair is one character.
    expect(Bun.inspect("\ud83d\ude0e\ude0e\ud83d\ud83d\ude0e")).toBe('"😎\\ude0e\\ud83d😎"');
  });

  it("a long string prints whole", () => {
    // The printer takes the string 256 units at a time, and hands the writer 32 KB at a time.
    const a = n => fill(n, "a");
    const strings = [];
    for (const n of [0, 1, 2, 14, 15, 16, 17, 254, 255, 256, 257, 510, 511, 512, 513]) {
      strings.push(
        wide(a(n + 2)),
        a(n) + "😀" + a(300),
        a(n) + "\ud83d" + a(300),
        a(n) + "\ude00" + a(300),
        a(n) + "中\ud83d",
        a(n) + "\ud83d\ud83d\ude00\ude00" + a(300),
        a(n) + '中\n"' + a(300),
        wide(a(n) + "\x1b" + a(300)),
        wide(a(n) + "é\\" + a(300)),
      );
    }
    for (const n of [32764, 32765, 32766, 32767, 32768, 32769]) {
      strings.push(wide(a(n + 2)), a(n) + "😀\n" + a(3), a(n) + "\ud83d" + a(3));
    }
    expect(notUTF16(strings).length).toBe(0);
    // A failure names the strings that print wrong, and does not show them all.
    expect(
      strings.flatMap((s, index) => (Bun.inspect(s) === quoted(s) ? [] : [`string ${index} of ${s.length} units`])),
    ).toEqual([]);

    for (const [s, printed] of [
      [wide(fill(40000, "\n")), repeated(40000, "\\n")],
      [wide(fill(40000, '"')), repeated(40000, '\\"')],
      [wide(fill(40000, "\x1f")), repeated(40000, "\\u001F")],
      [wide(fill(40000, "é")), repeated(40000, "é")],
      [Buffer.alloc(12000 * 2, "\ud800", "utf16le").toString("utf16le"), repeated(12000, "\\ud800")],
      [Buffer.alloc(12000 * 2, "\udc00", "utf16le").toString("utf16le"), repeated(12000, "\\udc00")],
      [repeated(40000, "中"), repeated(40000, "中")],
      [repeated(20000, "😀"), repeated(20000, "😀")],
      [repeated(20000, "😀\n"), repeated(20000, "😀\\n")],
    ]) {
      expect(s).toBeUTF16String();
      expect(Bun.inspect(s)).toBe(`"${printed}"`);
    }
  });

  it("a long string prints whole where the writer takes text", () => {
    // `Headers` and the message of a matcher print into text. Such a writer takes each buffer of the printer
    // as text of its own, so no buffer can end inside a character.
    const accents = fill(22, "a") + fill(22000, 'é"');
    const headers = `Headers {\n  "x-a": "${fill(22, "a")}${repeated(11000, 'é\\"')}",\n}`;
    expect(Bun.inspect(new Headers({ "x-a": accents }))).toBe(headers);
    expect(Bun.inspect(new Headers({ "x-a": wide(accents) }))).toBe(headers);

    const message = value => {
      try {
        expect(value).toBeNull();
      } catch (error) {
        return Bun.stripANSI(error.message);
      }
    };
    for (const [s, text] of [
      [repeated(6000, '中"a'), repeated(6000, '中\\"a')],
      [repeated(60, "a\n" + repeated(254, "中")), repeated(60, "a\\n" + repeated(254, "中"))],
    ]) {
      expect(s).toBeUTF16String();
      expect(message(s)).toBe(`expect(received).toBeNull()\n\nReceived: "${text}"\n`);
    }
  });

  it.concurrent("console.log of a long string writes all of it", async () => {
    const source = `
      console.log([Buffer.from(Buffer.alloc(40000, "a").toString(), "utf16le").toString("utf16le")]);
      console.log([Buffer.alloc(20000 * 3, "中").toString()]);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`[ "${fill(40000, "a")}" ]\n[ "${Buffer.alloc(20000 * 3, "中")}" ]\n`);
    expect(exitCode).toBe(0);
  });

  it("does not call toJSON of a String object", () => {
    const toJSON = jest.fn(() => "from toJSON");
    class Tagged extends String {
      toJSON() {
        return toJSON();
      }
    }
    const own = new String("😎");
    own.toJSON = toJSON;
    String.prototype.toJSON = toJSON;
    try {
      expect(Bun.inspect([new String("😎"), new String("x"), own, new Tagged("😎"), new Tagged("x")])).toBe(
        '[ "😎", "x", "😎", "😎", "x" ]',
      );
    } finally {
      delete String.prototype.toJSON;
    }
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("converts a String object to a string once", () => {
    const counted = new String("😎");
    counted.toString = jest.fn(() => "😎 once");
    expect(Bun.inspect([counted])).toBe('[ "😎 once" ]');
    expect(counted.toString).toHaveBeenCalledTimes(1);
  });

  it("the code of an error", () => {
    // The lines of the message, of the properties and of the code.
    const lines = error =>
      Bun.inspect(error)
        .split("\n")
        .map(line => line.trim())
        .filter(line => /^(detail|code|other): |message$/.test(line));
    const own = (code, message) => Object.assign(new Error(message), { detail: 1, code, other: 2 });
    // A code that is no enumerable property of the error itself.
    const hidden = code => Object.defineProperty(new Error("message"), "code", { value: code });
    const inherited = code => {
      class Coded extends Error {}
      Coded.prototype.code = code;
      return new Coded("message");
    };
    const printed = code => ({
      own: lines(own(code, "message")),
      named: lines(own(code, code + ": message")),
      hidden: lines(hidden(code)),
      inherited: lines(inherited(code)),
    });
    const ascii = ["ERR", "WITH", "A", "LONG", "NAME"].join("_");
    const accented = ["ERR", "CAFÉ", "\\"].join("_");
    const twins = [wide(ascii), wide(accented)];
    for (const code of [ascii, twins[0]]) {
      expect(printed(code)).toEqual({
        own: ["error: message", "detail: 1,", "other: 2,", 'code: "ERR_WITH_A_LONG_NAME"'],
        named: ["ERR_WITH_A_LONG_NAME: message", "detail: 1,", "other: 2,", 'code: "ERR_WITH_A_LONG_NAME"'],
        hidden: ["error: message", 'code: "ERR_WITH_A_LONG_NAME"'],
        inherited: ["error: message", 'code: "ERR_WITH_A_LONG_NAME"'],
      });
    }
    for (const code of [accented, twins[1]]) {
      expect(printed(code)).toEqual({
        own: ["error: message", "detail: 1,", "other: 2,", 'code: "ERR_CAFÉ_\\\\"'],
        named: ["error: ERR_CAFÉ_\\: message", "detail: 1,", "other: 2,", 'code: "ERR_CAFÉ_\\\\"'],
        hidden: ["error: message", 'code: "ERR_CAFÉ_\\\\"'],
        inherited: ["error: message", 'code: "ERR_CAFÉ_\\\\"'],
      });
    }
    expect(printed("ERR_日本")).toEqual({
      own: ["error: message", "detail: 1,", "other: 2,", 'code: "ERR_日本"'],
      named: ["error: ERR_日本: message", "detail: 1,", "other: 2,", 'code: "ERR_日本"'],
      hidden: ["error: message", 'code: "ERR_日本"'],
      inherited: ["error: message", 'code: "ERR_日本"'],
    });
    expect(notLatin1([ascii, accented])).toEqual([]);
    expect(notUTF16(twins)).toEqual([]);
  });

  it.concurrent.each([
    ["8-bit", ""],
    ["16-bit", `detail = Buffer.from(detail, "utf16le").toString("utf16le");`],
  ])("a property of an uncaught error, %s", async (_, widen) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `let detail = ["\\x1b[31m", '"q"', "\\\\", "é"].join(" "); ${widen} throw Object.assign(new Error("message"), { detail });`,
      ],
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      stdout,
      detail: stderr
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.startsWith("detail:")),
      exitCode,
    }).toEqual({ stdout: "", detail: ['detail: "\\u001B[31m \\"q\\" \\\\ é",'], exitCode: 1 });
  });

  describe("a quoted key", () => {
    // Built from parts: a string literal of the whole key leaves an equal 8-bit atom behind.
    const parts = ["key", '"', "\x1b", "\n", "\\", "é"];
    const text = '"key \\" \\u001B \\n \\\\ é"';

    it("that is a 16-bit string of characters up to U+00FF", () => {
      const key = wide(parts.join(" "));
      expect(key).toBeUTF16String();
      expect(Bun.inspect({ [key]: 1 })).toBe(`{\n  ${text}: 1,\n}`);
      // Still 16-bit, so the 16-bit string was printed.
      expect(key).toBeUTF16String();
    });

    it("whose equal 8-bit string was a key first", () => {
      const narrow = parts.join(", ");
      expect(Bun.inspect({ [narrow]: 1 })).toBe('{\n  "key, \\", \\u001B, \\n, \\\\, é": 1,\n}');
      const key = wide(narrow);
      expect(key).toBeUTF16String();
      expect(Bun.inspect({ [key]: 1 })).toBe('{\n  "key, \\", \\u001B, \\n, \\\\, é": 1,\n}');
      // As a key, the 16-bit string was swapped for the 8-bit one, and that is what was printed.
      expect(notLatin1([narrow, key])).toEqual([]);
    });

    it("for every character up to U+00FF", () => {
      const codes = Array.from({ length: 256 }, (_, code) => code);
      // "-" is in no identifier, so each key prints with quotes. Equal keys are one atom of one width: the
      // second letter keeps the 8-bit key and the 16-bit key of a character apart.
      const narrow = codes.map(code => "-n" + String.fromCharCode(code));
      const twins = codes.map(code => wide("-w" + String.fromCharCode(code)));
      const printed = key => Bun.inspect({ [key]: 1 });
      expect(narrow.map(printed)).toEqual(codes.map(code => `{\n  "-n${escapeOf(code)}": 1,\n}`));
      expect(twins.map(printed)).toEqual(codes.map(code => `{\n  "-w${escapeOf(code)}": 1,\n}`));
      expect(notLatin1(narrow)).toEqual([]);
      expect(notUTF16(twins)).toEqual([]);
    });

    it("with characters above U+00FF", () => {
      expect(Bun.inspect({ '日本 "q" \x1b \\': 1 })).toBe('{\n  "日本 \\"q\\" \\u001B \\\\": 1,\n}');
      expect(Bun.inspect(JSON.parse('{"日本\\nline two":1}'))).toBe('{\n  "日本\\nline two": 1,\n}');
      expect(Bun.inspect({ "a\u2028\u2029\ufeff 😎": 1, "\ud800b\udc00": 2 })).toBe(
        '{\n  "a\u2028\u2029\ufeff 😎": 1,\n  "\\ud800b\\udc00": 2,\n}',
      );
      expect(Bun.inspect({ 笑: 1, "笑 ": 2 })).toBe('{\n  "笑": 1,\n  "笑 ": 2,\n}');
    });

    it("with colors", () => {
      const key = wide(parts.join("; "));
      expect(key).toBeUTF16String();
      expect(Bun.inspect({ [key]: 1 }, { colors: true })).toBe(
        '{\n  \x1b[0m\x1b[32m"key; \\"; \\u001B; \\n; \\\\; é"\x1b[0m\x1b[2m:\x1b[0m \x1b[0m\x1b[33m1\x1b[0m\x1b[0m\x1b[2m,\x1b[0m\n}',
      );
      expect(key).toBeUTF16String();
    });

    // The key printer of bun:test is another one, and a stored snapshot keeps its text.
    it("is stored as it is in a snapshot of bun:test", () => {
      expect({ ['日本 "q"\n\\ end']: 1 }).toMatchInlineSnapshot(`
        {
          "日本 "q"
        \\ end": 1,
        }
      `);
    });

    it("of URLSearchParams and FormData", () => {
      const name = 'k"\x1b\\ 日本 😎';
      const printed = '"k\\"\\u001B\\\\ 日本 😎"';
      expect(Bun.inspect(new URLSearchParams([[name, "v"]]))).toBe(`URLSearchParams {\n  ${printed}: "v",\n}`);
      const form = new FormData();
      form.append(name, "v");
      expect(Bun.inspect(form)).toBe(`FormData {\n  ${printed}: "v",\n}`);
    });
  });
});

describe("depth cap applies to Map/Set/Array and Error cause chains", () => {
  it("Map respects max_depth", () => {
    let m = new Map([["leaf", 1]]);
    for (let i = 0; i < 10; i++) m = new Map([[m, i]]);
    expect(Bun.inspect(m, { depth: 2 })).toBe(
      "Map(1) {\n  Map(1) {\n    Map(1) {\n      [Map ...]: 7,\n    }: 8,\n  }: 9,\n}",
    );
    expect(Bun.inspect(m, { depth: 0 })).toBe("Map(1) {\n  [Map ...]: 9,\n}");
    expect(Bun.inspect(m, { depth: Infinity })).toContain('"leaf": 1');
  });

  it("Set respects max_depth", () => {
    let s = new Set([1]);
    for (let i = 0; i < 10; i++) s = new Set([s]);
    expect(Bun.inspect(s, { depth: 2 })).toBe("Set(1) {\n  Set(1) {\n    Set(1) {\n      [Set ...],\n    },\n  },\n}");
    expect(Bun.inspect(s, { depth: 0 })).toBe("Set(1) {\n  [Set ...],\n}");
    expect(Bun.inspect(s, { depth: Infinity })).toContain("1,");
  });

  it("Array respects max_depth", () => {
    let a = [1];
    for (let i = 0; i < 10; i++) a = [a];
    expect(Bun.inspect(a, { depth: 2 })).toBe("[\n  [\n    [\n      [Array ...]\n    ]\n  ]\n]");
    expect(Bun.inspect(a, { depth: 0 })).toBe("[\n  [Array ...]\n]");
    expect(Bun.inspect(a, { depth: Infinity })).toContain("[ 1 ]");
  });

  it("MapIterator/SetIterator respect max_depth", () => {
    const mi = () => new Map([["a", 1]]).entries();
    const si = () => new Set(["leaf"]).values();
    expect(Bun.inspect({ x: mi() }, { depth: 0 })).toBe("{\n  x: [MapIterator ...],\n}");
    expect(Bun.inspect({ x: si() }, { depth: 0 })).toBe("{\n  x: [SetIterator ...],\n}");
    expect(Bun.inspect([[[mi()]]], { depth: 2 })).toBe("[\n  [\n    [\n      [MapIterator ...]\n    ]\n  ]\n]");
    expect(Bun.inspect([[[si()]]], { depth: 2 })).toBe("[\n  [\n    [\n      [SetIterator ...]\n    ]\n  ]\n]");
    expect(Bun.inspect([[[mi()]]], { depth: Infinity })).toContain('[ "a", 1 ]');
    expect(Bun.inspect([[[si()]]], { depth: Infinity })).toContain('"leaf"');
  });

  it("an empty Array, Map, or Set past max_depth prints as empty", () => {
    const value = { a: [], b: new Map(), c: new Set(), d: [1], e: new Map([[1, 2]]), f: new Set([1]) };
    expect(Bun.inspect(value, { depth: 0 })).toBe(
      "{\n  a: [],\n  b: Map {},\n  c: Set {},\n  d: [Array ...],\n  e: [Map ...],\n  f: [Set ...],\n}",
    );
  });

  it("console.log of deeply nested Map/Set/Array/Error does not blow up or throw", async () => {
    const src = `
      let m = new Map([["leaf", 1]]);
      for (let i = 0; i < 1000; i++) m = new Map([[m, i]]);
      console.log(m);

      let s = new Set([1]);
      for (let i = 0; i < 1000; i++) s = new Set([s]);
      console.log(s);

      let a = [1];
      for (let i = 0; i < 1000; i++) a = [a];
      console.log(a);

      let e = new Error("leaf");
      for (let i = 0; i < 1000; i++) e = new Error("retry " + i, { cause: e });
      console.log(e);

      let ag = new Error("leaf");
      for (let i = 0; i < 1000; i++) ag = new AggregateError([ag], "L" + i);
      console.log(ag);

      let ev = new MessageEvent("message", { data: 1 });
      for (let i = 0; i < 1000; i++) ev = new MessageEvent("message", { data: ev });
      console.log(ev);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("[Map ...]");
    expect(stdout).toContain("[Set ...]");
    expect(stdout).toContain("[Array ...]");
    expect(stdout).toContain("[Error ...]");
    expect(stdout).toContain("[MessageEvent ...]");
    // Previously each of these produced megabytes of output or threw RangeError.
    expect(stdout.length).toBeLessThan(4096);
    expect(exitCode).toBe(0);
  });

  it("Error cause chain truncates at max_depth", () => {
    let e = new Error("leaf");
    for (let i = 0; i < 10; i++) e = new Error("retry " + i, { cause: e });
    const out = Bun.inspect(e, { depth: 2 });
    expect(out).toContain("error: retry 9");
    expect(out).toContain("error: retry 8");
    expect(out).toContain("error: retry 7");
    expect(out).toContain("[Error ...]");
    expect(out).not.toContain("error: retry 6");
    expect(out).not.toContain("error: leaf");

    const full = Bun.inspect(e, { depth: Infinity });
    expect(full).toContain("error: leaf");
    expect(full).not.toContain("[Error ...]");
  });

  it("object/array properties on a cause error still expand one level", () => {
    const inner = new Error("inner");
    inner.info = { code: "E_FOO", detail: "bar" };
    inner.tags = ["a", "b"];
    const out = Bun.inspect(new Error("outer", { cause: inner }));
    expect(out).toContain('code: "E_FOO"');
    expect(out).toContain('detail: "bar"');
    expect(out).toContain('"a"');
    expect(out).toContain('"b"');
    expect(out).not.toContain("info: [Object ...]");
    expect(out).not.toContain("tags: [Array ...]");
  });

  it("an Error nested in an Error property walks its cause to the caller's depth", () => {
    const make = () => {
      const outer = new Error("outer");
      outer.details = { inner: new Error("inner", { cause: new Error("deep one") }) };
      outer.list = [new Error("listed", { cause: new Error("deep two") })];
      outer.group = { agg: new AggregateError([new Error("member")], "agg") };
      return outer;
    };
    // An inspected Error shows a preview of this file's source. Drop those lines.
    const inspect = depth => Bun.inspect(make(), { depth }).replace(/^ *\d+ \|.*\n/gm, "");

    const full = inspect(Infinity);
    expect(full).toContain("error: deep one");
    expect(full).toContain("error: deep two");
    expect(full).toContain("error: member");
    expect(full).not.toContain("[Error ...]");

    const capped = inspect(2);
    expect(capped).toContain("error: inner");
    expect(capped).toContain("error: listed");
    expect(capped).toContain("AggregateError: agg");
    expect(capped).toContain("[Error ...]");
    expect(capped).not.toContain("error: deep one");
    expect(capped).not.toContain("error: deep two");
    expect(capped).not.toContain("error: member");
  });

  it("an AggregateError whose members are past max_depth still prints itself", () => {
    const inspect = errors =>
      Bun.inspect(new AggregateError(errors, "agg message"), { depth: 0 }).replace(/^ *\d+ \|.*\n/gm, "");

    const out = inspect([new Error("member x"), new Error("member y")]);
    expect(out.match(/AggregateError: agg message/g)).toHaveLength(1);
    expect(out.match(/\[Error \.\.\.\]/g)).toHaveLength(2);
    expect(out).not.toContain("error: member");

    const empty = inspect([]);
    expect(empty.match(/AggregateError: agg message/g)).toHaveLength(1);
    expect(empty).not.toContain("[Error ...]");
  });

  it("nested AggregateError recursion truncates at max_depth", () => {
    let e = new Error("leaf");
    for (let i = 0; i < 10; i++) e = new AggregateError([e], "L" + i);
    const out = Bun.inspect(e, { depth: 2 });
    expect(out).toContain("AggregateError: L7");
    expect(out).toContain("[Error ...]");
    expect(out).not.toContain("error: leaf");

    const full = Bun.inspect(e, { depth: Infinity });
    expect(full).toContain("error: leaf");

    // Common flat case is unchanged.
    const flat = Bun.inspect(new AggregateError([new Error("a"), new Error("b")], "agg"));
    expect(flat).toContain("error: a");
    expect(flat).toContain("error: b");
    expect(flat).not.toContain("[Error ...]");
  });

  it("nested MessageEvent/ErrorEvent respects max_depth", () => {
    let me = new MessageEvent("message", { data: 1 });
    for (let i = 0; i < 10; i++) me = new MessageEvent("message", { data: me });
    const out = Bun.inspect(me, { depth: 2 });
    expect(out).toContain("[MessageEvent ...]");
    expect(out.length).toBeLessThan(400);
    expect(Bun.inspect(me, { depth: Infinity })).toContain("data: 1");

    let ee = new ErrorEvent("error", { error: 1 });
    for (let i = 0; i < 10; i++) ee = new ErrorEvent("error", { error: ee });
    expect(Bun.inspect(ee, { depth: 2 })).toContain("[ErrorEvent ...]");
    expect(Bun.inspect(ee, { depth: Infinity })).toContain("error: 1,");
  });

  it("deep AggregateError with depth: Infinity bails on stack limit instead of crashing", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `let e = new Error("leaf");
         for (let i = 0; i < 20000; i++) e = new AggregateError([e], "L" + i);
         const out = Bun.inspect(e, { depth: Infinity });
         console.log("len=" + out.length);
         console.log("truncated=" + out.includes("[Error ...]"));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toStartWith("len=");
    expect(stdout).toContain("truncated=true");
    expect(exitCode).toBe(0);
  });
});

// https://github.com/oven-sh/bun/issues/25309
it("object property enumeration scales linearly with property count", () => {
  function makeWide(n) {
    const o = {};
    for (let i = 0; i < n; i++) o["p" + i] = i;
    return o;
  }
  function timeInspect(o) {
    const t0 = performance.now();
    const out = Bun.inspect(o);
    return { ms: performance.now() - t0, out };
  }

  const small = makeWide(3000);
  const large = makeWide(30000);

  withoutAggressiveGC(() => {
    Bun.inspect(small); // warm up
    const s = timeInspect(small);
    const l = timeInspect(large);

    // Output still lists every property (no behavior change).
    expect(s.out.includes("p2999")).toBe(true);
    expect(l.out.includes("p29999")).toBe(true);

    // Per-property cost must stay roughly constant as n grows 10x. The previous
    // Vector-based visited-property dedup was O(n^2), giving a ~9x ratio here.
    expect(l.ms / 30000 / (s.ms / 3000)).toBeLessThan(3);
  });
});

describe("own non-enumerable properties are not printed", () => {
  const hide = (object, key, descriptor = { value: { hidden: true } }) =>
    Object.defineProperty(object, key, descriptor);

  it("string and symbol keys", () => {
    const obj = hide(hide({}, Symbol("impl")), "hiddenString");
    obj[Symbol("enumerable")] = 3;
    obj.visible = 4;
    expect(Bun.inspect(obj)).toBe("{\n  [Symbol(enumerable)]: 3,\n  visible: 4,\n}");
  });

  it("nothing else to print", () => {
    expect(Bun.inspect(hide({}, "a"))).toBe("{}");
    expect(Bun.inspect(hide(Object.create(null), "a"))).toBe("[Object: null prototype] {}");
    expect(Bun.inspect(hide(new (class Foo {})(), "a"))).toBe("Foo {}");
  });

  it("next to an accessor", () => {
    const obj = {
      get visible() {
        return 1;
      },
    };
    hide(obj, "data");
    hide(obj, "accessor", { get() {} });
    expect(Bun.inspect(obj)).toBe("{\n  visible: [Getter],\n}");
  });

  it("nested", () => {
    expect(Bun.inspect({ a: hide({ b: 1 }, "c") })).toBe("{\n  a: {\n    b: 1,\n  },\n}");
    expect(Bun.inspect([hide({ b: 1 }, "c")])).toBe("[\n  {\n    b: 1,\n  }\n]");
  });

  it("array", () => {
    const array = hide([1, 2], "hidden");
    array.visible = 3;
    expect(Bun.inspect(array)).toBe("[ 1, 2, visible: 3 ]");
  });

  it("sorted", () => {
    expect(Bun.inspect(hide({ b: 1, a: 2 }, "c"), { sorted: true })).toBe("{\n  a: 2,\n  b: 1,\n}");
  });

  it("hides the property of the prototype that it shadows", () => {
    expect(Bun.inspect(hide(Object.create({ a: "inherited", b: 2 }), "a"))).toBe("{\n  b: 2,\n}");
    class Foo {
      get a() {
        return "inherited";
      }
      get b() {
        return 2;
      }
    }
    expect(Bun.inspect(hide(new Foo(), "a"))).toBe("Foo {\n  b: [Getter],\n}");
  });

  it("members of the prototypes are still printed", () => {
    class Foo {
      field = 1;
      get getter() {
        return 1;
      }
      method() {}
    }
    expect(Bun.inspect(new Foo())).toBe("Foo {\n  field: 1,\n  getter: [Getter],\n  method: [Function: method],\n}");
    expect(Bun.inspect(new TextDecoder())).toContain('encoding: "utf-8"');
  });
});

describe("values of another realm", () => {
  it("the members of its Object.prototype are not printed", () => {
    expect(Bun.inspect(vm.runInNewContext("({ a: 1 })"))).toBe("{\n  a: 1,\n}");
    expect(Bun.inspect(vm.runInNewContext("({})"))).toBe("{}");
    expect(Bun.inspect(vm.runInNewContext("({ a: { b: [{ c: 1 }] } })"))).toBe(Bun.inspect({ a: { b: [{ c: 1 }] } }));
    expect(Bun.inspect(vm.runInNewContext("Object.create({ a: 1 })"))).toBe("{\n  a: 1,\n}");
    expect(Bun.inspect(vm.runInNewContext("new (class Foo { x = 1; m() {} })()"))).toBe(
      "Foo {\n  x: 1,\n  m: [Function: m],\n}",
    );
  });

  it("its global prints its enumerable properties", () => {
    expect(Bun.inspect(vm.runInContext("this", vm.createContext({ a: 1 })))).toBe("{\n  a: 1,\n}");
    expect(Bun.inspect(vm.runInContext("var b = 2; this", vm.createContext({})))).toBe("{\n  b: 2,\n}");
    expect(Bun.inspect(vm.runInNewContext("this"))).toBe("{}");
    expect(
      Bun.inspect(
        vm.runInNewContext("Object.setPrototypeOf(this, (class Window { m() {} }).prototype); this.a = 1; this"),
      ),
    ).toBe("Window {\n  a: 1,\n}");
  });

  it("properties inherited from its global aren't printed", () => {
    expect(Bun.inspect(Object.create(vm.runInContext("this", vm.createContext({ a: 1 }))))).toBe("{}");
  });
});

describe("a value whose [nodejs.util.inspect.custom] cannot be read", () => {
  const values = {
    "inherits from a Proxy that throws": () =>
      Object.create(
        new Proxy(
          {},
          {
            get() {
              throw new Error("cannot be read");
            },
          },
        ),
      ),
    "has a getter that throws": () => ({
      get [Symbol.for("nodejs.util.inspect.custom")]() {
        throw new Error("cannot be read");
      },
    }),
  };
  const holders = {
    "itself": value => value,
    "the first property": value => ({ value, b: 2 }),
    "the second property": value => ({ a: 1, value }),
    "an element": value => [1, value],
    "a property of the global of a node:vm context": value => vm.runInContext("this", vm.createContext({ value })),
    "a property of a DONT_CONTEXTIFY context": value =>
      Object.assign(vm.createContext(vm.constants.DONT_CONTEXTIFY), { value }),
  };

  describe.each(Object.keys(values))("because it %s", kind => {
    it.each(Object.keys(holders))("Bun.inspect() throws the error: %s", holder => {
      expect(() => Bun.inspect(holders[holder](values[kind]()))).toThrow("cannot be read");
      expect(Bun.inspect({ a: 1 })).toBe("{\n  a: 1,\n}");
    });
  });

  it.concurrent("console.log() throws the error, and later calls still print", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const value = { get [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("cannot be read"); } };
        for (const log of [console.log, console.error, console.table]) {
          try {
            log([{ value }]);
            process.stdout.write("\\nreturned\\n");
          } catch (error) {
            process.stdout.write("\\n" + error.message + "\\n");
          }
        }
        console.log({ a: 1 });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ lines: stdout.split("\n").filter(line => /^[a-z]/.test(line)), end: stdout.slice(-12), exitCode }).toEqual(
      {
        lines: ["cannot be read", "cannot be read", "cannot be read"],
        end: "{\n  a: 1,\n}\n",
        exitCode: 0,
      },
    );
  });

  // Printing an uncaught error must never throw itself.
  describe.each(["throw thrown;", "Promise.reject(thrown);", "reportError(thrown); process.exitCode = 1;"])(
    "%s",
    report => {
      async function reportOf(thrown) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", `const thrown = ${thrown};\n${report}`],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr: stderr.replace(/\n+Bun v.*\n$/, "\n"), exitCode };
      }

      it.concurrent("does not read it", async () => {
        const getter = `get [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("cannot be read"); }`;
        expect(await reportOf(`{ value: { ${getter} }, b: 2 }`)).toEqual({
          stdout: "",
          stderr: "error\n{\n  value: {\n    [Symbol(nodejs.util.inspect.custom)]: [Getter],\n  },\n  b: 2,\n}\n",
          exitCode: 1,
        });
      });

      it.concurrent("prints [threw while printing] in place of a property that throws", async () => {
        const handler = `{ getPrototypeOf() { throw new Error("has no prototype"); } }`;
        expect(await reportOf(`{ a: 1, value: Object.create(new Proxy({}, ${handler})) }`)).toEqual({
          stdout: "",
          stderr: "error\n{\n  a: 1,\n  value: [threw while printing]\n",
          exitCode: 1,
        });
      });
    },
  );
});

it("expect.objectContaining(fn) prints the function when it has no properties to list", () => {
  const f = () => {};
  expect(Bun.inspect(expect.objectContaining(f))).toBe("ObjectContaining [Function: f]");
  expect(Bun.inspect(expect.objectContaining(class A {}))).toBe("ObjectContaining [class A]");
  expect(Bun.inspect({ x: expect.objectContaining(f) })).toBe("{\n  x: ObjectContaining [Function: f],\n}");
  expect(Bun.inspect(expect.objectContaining(Object.assign(() => {}, { a: 1 })))).toBe(
    "ObjectContaining {\n  a: 1,\n}",
  );
});

describe("compact prints one line", () => {
  it("an array of more than 100 items", () => {
    expect(Bun.inspect(Array(150).fill(0), { compact: true })).toBe(
      `[ ${Array(100).fill(0).join(", ")}, ... 50 more items ]`,
    );
    expect(Bun.inspect({ a: Array(101).fill(0) }, { compact: true })).toBe(
      `{ a: [ ${Array(100).fill(0).join(", ")}, ... 1 more items ] }`,
    );
  });

  it("an object past the depth", () => {
    expect(Bun.inspect({ a: { b: 1 }, z: 1 }, { compact: true, depth: 0 })).toBe("{ a: [Object ...], z: 1 }");
    expect(Bun.inspect([{ b: 1 }, { c: 2 }], { compact: true, depth: 0 })).toBe("[ [Object ...], [Object ...] ]");
  });
});

// Each case runs in a fresh child so the formatter hasn't loaded util.inspect before the failing call.
describe.concurrent("Bun.inspect when loading util.inspect for a custom inspect function throws", () => {
  async function inspectInChild(code) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const obj = { [Bun.inspect.custom]() { return "custom"; } };
          const styled = { [Bun.inspect.custom](depth, options) { return options.stylize("x", "number"); } };
          ${code}
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it("throws while a global the module needs is replaced, and works once it's restored", async () => {
    const result = await inspectInChild(`
      const RealSymbol = Symbol;
      globalThis.Symbol = 0;
      try {
        console.log(Bun.inspect(styled, { colors: true }));
      } catch {
        console.log("threw");
      }
      globalThis.Symbol = RealSymbol;
      console.log(Bun.inspect(obj));
      console.log(Bun.inspect(styled, { colors: true }) === "\\u001b[33mx\\u001b[39m");
      Bun.gc(true);
      console.log(Bun.inspect(styled, { colors: true }) === "\\u001b[33mx\\u001b[39m");
    `);
    expect(result).toEqual({ stdout: "threw\ncustom\ntrue\ntrue\n", stderr: "", exitCode: 0 });
  });

  it("throws the RangeError at the stack limit, and works afterwards", async () => {
    const result = await inspectInChild(`
      let deep;
      function recurse() {
        try {
          recurse();
        } catch {
          try {
            deep = Bun.inspect(obj);
          } catch (e) {
            deep = e;
          }
        }
      }
      recurse();
      console.log(String(deep));
      console.log(Bun.inspect(obj));
    `);
    expect(result).toEqual({
      stdout: "RangeError: Maximum call stack size exceeded.\ncustom\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("passes the real inspect function while util.inspect is replaced", async () => {
    const result = await inspectInChild(`
      const util = require("node:util");
      const realInspect = util.inspect;
      util.inspect = 42;
      const receives = { [Bun.inspect.custom](depth, options, inspect) { return String(inspect === realInspect); } };
      console.log(Bun.inspect(receives));
    `);
    expect(result).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
  });
});

// Runs in a subprocess because a native stack overflow would kill the test runner.
it.concurrent.each([
  [
    "circular jsx",
    `const children = { $$typeof: Symbol.for("react.element"), type: "div", key: null };
     children.props = { children };
     console.log(Bun.inspect(children));
     const key = { $$typeof: Symbol.for("react.element"), type: "div", props: {} };
     key.key = key;
     console.log(Bun.inspect(key));`,
    "<div>\n  [Circular]\n</div>\n<div key=[Circular] />",
  ],
  [
    "a deep Proxy chain",
    `let proxy = { ok: 1 };
     for (let i = 0; i < 100000; i++) proxy = new Proxy(proxy, {});
     console.log(Bun.inspect(proxy));`,
    "{\n  ok: 1,\n}",
  ],
  [
    "deep jsx",
    `let element = { $$typeof: Symbol.for("react.element"), type: "div", props: {}, key: null };
     for (let i = 0; i < 100000; i++)
       element = { $$typeof: Symbol.for("react.element"), type: "div", props: { children: element }, key: null };
     try { Bun.inspect(element); } catch (e) { console.log(e.name); }`,
    "RangeError",
  ],
])("Bun.inspect of %s doesn't overflow the stack", async (_, script, expected) => {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe(expected);
  expect(exitCode).toBe(0);
});

// A substring rope's characters live in its base string, and only the rope references the base.
// Malloc=1 makes bmalloc use the system heap so ASAN can catch a read of freed characters.
it.skipIf(!isASAN)("prints a substring-rope jsx type after a prop's inspect.custom resolves the rope", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const type = Buffer.from("_div-abcdefghijklmnopqrstuvwxyz").toString().slice(1);
       const custom = {
         [Bun.inspect.custom]() {
           // Using the rope as a property key atomizes it, which copies its characters and drops the base.
           ({})[type];
           Bun.gc(true);
           return "x";
         },
       };
       const props = { custom, children: "text" };
       console.log(Bun.inspect({ $$typeof: Symbol.for("react.element"), type, key: null, props }));`,
    ],
    env: { ...bunEnv, Malloc: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toEndWith("</div-abcdefghijklmnopqrstuvwxyz>\n");
  expect(exitCode).toBe(0);
});
