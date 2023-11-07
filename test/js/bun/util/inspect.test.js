import { it, expect, describe } from "bun:test";
import util from "util";

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

  expect(Bun.inspect(obj)).toBe("{\n" + "  foo: [Getter]" + "\n" + "}");
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

  expect(Bun.inspect(objWithThrowingGetter)).toBe("{\n" + "  foo: [Getter]" + "\n" + "}");
  expect(called).toBe(false);
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
  expect(Bun.inspect(obj).trim()).toBe('{\n  foo: "456"\n}'.trim());
});

it("Blob inspect", () => {
  expect(Bun.inspect(new Blob(["123"]))).toBe(`Blob (3 bytes)`);
  expect(Bun.inspect(new Blob(["123".repeat(900)]))).toBe(`Blob (2.70 KB)`);
  expect(Bun.inspect(Bun.file("/tmp/file.txt"))).toBe(`FileRef ("/tmp/file.txt") {
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
  [Blob detached]
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

it("utf16 property name", () => {
  var { Database } = require("bun:sqlite");
  const db = Database.open(":memory:");
  expect("笑".codePointAt(0)).toBe(31505);

  // latin1 escaping identifier issue
  expect(Object.keys({ 笑: "hey" })[0].codePointAt(0)).toBe(31505);

  const output = JSON.stringify(
    [
      {
        笑: "😀",
      },
    ],
    null,
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
  data: 123
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
        `${TypedArray.name}(${buffer.length - i}) [ ` + [...buffer.subarray(i)].join(", ") + " ]",
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
        `${TypedArray.name}(${buffer.length - i}) [ ` +
          [...buffer.subarray(i)].map(a => a.toString(10) + "n").join(", ") +
          " ]",
      );
    }
  }
});

it("FloatArray", () => {
  for (let TypedArray of [Float32Array, Float64Array]) {
    const buffer = new TypedArray([Math.fround(42.68)]);
    const input = Bun.inspect(buffer);

    expect(input).toBe(`${TypedArray.name}(${buffer.length}) [ ${[Math.fround(42.68)].join(", ")} ]`);
    for (let i = 1; i < buffer.length + 1; i++) {
      expect(Bun.inspect(buffer.subarray(i))).toBe(
        `${TypedArray.name}(${buffer.length - i}) [ ` + [...buffer.subarray(i)].join(", ") + " ]",
      );
    }
  }
});

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
  expect(Bun.inspect({ hello: 1 })).toBe("{\n  hello: 1\n}");
  expect(Bun.inspect({ hello: 1, there: 2 })).toBe("{\n  hello: 1,\n  there: 2\n}");
  expect(Bun.inspect({ hello: "1", there: 2 })).toBe('{\n  hello: "1",\n  there: 2\n}');
  expect(Bun.inspect({ 'hello-"there': "1", there: 2 })).toBe('{\n  "hello-\\"there": "1",\n  there: 2\n}');
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

const fixture = [
  () => globalThis,
  () => Bun.file("/tmp/log.txt").stream(),
  () => Bun.file("/tmp/log.1.txt").stream().getReader(),
  () => Bun.file("/tmp/log.2.txt").writer(),
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
