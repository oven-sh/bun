import { describe, expect, it } from "bun:test";
import {
  bunEnv,
  bunExe,
  isASAN,
  isDebug,
  isWindows,
  normalizeBunSnapshot,
  tempDir,
  tmpdirSync,
  withoutAggressiveGC,
} from "harness";
import { join } from "path";
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

it("does not call a $$typeof getter while checking for a React element", () => {
  let called = 0;
  const obj = {
    get $$typeof() {
      called++;
      return Symbol.for("react.element");
    },
  };

  expect(Bun.inspect(obj)).toBe("{\n" + "  $$typeof: [Getter]," + "\n" + "}");
  expect(called).toBe(0);

  const throwing = {
    get $$typeof() {
      called++;
      throw new Error("Test failed!");
    },
  };

  expect(Bun.inspect(throwing)).toBe("{\n" + "  $$typeof: [Getter]," + "\n" + "}");
  expect(Bun.inspect([throwing, "after"])).toBe('[\n  {\n    $$typeof: [Getter],\n  }, "after"\n]');
  expect(Bun.inspect(new Map([[1, throwing]]))).toBe("Map(1) {\n  1: {\n    $$typeof: [Getter],\n  },\n}");
  expect(Bun.inspect(new Set([throwing]))).toBe("Set(1) {\n  {\n    $$typeof: [Getter],\n  },\n}");
  expect(Bun.inspect({ nested: throwing })).toBe("{\n  nested: {\n    $$typeof: [Getter],\n  },\n}");

  const hidden = {};
  Object.defineProperty(hidden, "$$typeof", {
    get() {
      called++;
      throw new Error("Test failed!");
    },
    enumerable: false,
  });
  expect(() => Bun.inspect(hidden)).not.toThrow();
  expect(called).toBe(0);

  // A plain data property still marks a React element.
  const element = { $$typeof: Symbol.for("react.element"), type: "div", key: null, ref: null, props: { id: "x" } };
  expect(Bun.inspect(element)).toBe('<div id="x" />');
});

it("prints a React element without calling getters on its type, key, props or children", () => {
  const $$typeof = Symbol.for("react.element");
  let called = 0;
  const getter = {
    get() {
      called++;
      throw new Error("Test failed!");
    },
    enumerable: true,
  };
  const withGetter = (target, name) => Object.defineProperty(target, name, getter);

  expect(Bun.inspect(withGetter({ $$typeof, props: {} }, "type"))).toBe("<unknown />");
  expect(Bun.inspect(withGetter({ $$typeof, type: "div", props: {} }, "key"))).toBe("<div />");
  expect(Bun.inspect(withGetter({ $$typeof, type: "div" }, "props"))).toBe("<div />");
  expect(Bun.inspect({ $$typeof, type: "div", props: withGetter({}, "children") })).toBe("<div />");
  // An accessor prop prints like every other accessor.
  expect(Bun.inspect({ $$typeof, type: "div", props: withGetter({ id: "x" }, "hidden") })).toBe(
    '<div id="x" hidden=[Getter] />',
  );
  // A Proxy props object, nested or not, is read through its innermost target.
  const trap = () => {
    called++;
    throw new Error("Test failed!");
  };
  const proxyProps = new Proxy({ id: "x" }, { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
  expect(Bun.inspect({ $$typeof, type: "div", props: proxyProps })).toBe('<div id="x" />');
  expect(Bun.inspect({ $$typeof, type: "div", props: new Proxy(proxyProps, {}) })).toBe('<div id="x" />');
  expect(called).toBe(0);

  // Data props, including a numeric key, still print.
  expect(Bun.inspect({ $$typeof, type: "div", key: "k", props: { 0: "a", b: 1, children: "hi" } })).toBe(
    '<div key="k" 0="a" b=1>hi</div>',
  );
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

// The fields come from the native event, so what a subclass or the instance puts
// in front of the prototype's getter does not run.
it("Event subclass with a throwing getter does not make Bun.inspect throw", () => {
  class ThrowType extends Event {
    get type() {
      throw new Error("type-getter-boom");
    }
  }
  const typeOut = Bun.inspect(new ThrowType("t"));
  expect(typeOut).toContain("type: [Getter]");
  expect(typeOut).not.toContain("type-getter-boom");
  expect(() => Bun.inspect({ payload: [new ThrowType("t")] })).not.toThrow();

  class ThrowData extends MessageEvent {
    get data() {
      throw new Error("data-getter-boom");
    }
  }
  expect(Bun.inspect(new ThrowData("message", { data: "p" }))).toBe(
    `MessageEvent {\n  type: "message",\n  data: "p",\n}`,
  );

  class ThrowError extends ErrorEvent {
    get error() {
      throw new Error("error-getter-boom");
    }
    get message() {
      throw new Error("message-getter-boom");
    }
  }
  expect(Bun.inspect(new ThrowError("error", { message: "m", error: 5 }))).toBe(
    `ErrorEvent {\n  type: "error",\n  message: "m",\n  error: 5,\n}`,
  );

  // Own-instance accessors (not subclass) on the Event branch reads.
  const me = new MessageEvent("message", { data: "p" });
  Object.defineProperty(me, "data", {
    get() {
      throw new Error("own-data-boom");
    },
    configurable: true,
  });
  expect(Bun.inspect(me)).toBe(`MessageEvent {\n  type: "message",\n  data: "p",\n}`);
  expect(Bun.inspect({ nested: me })).toContain('data: "p"');
});

it("Function.prototype is not its own ancestor", () => {
  expect(Bun.inspect(Function.prototype)).toBe("[Function]");
});

it("indentation stops growing at 32 levels", () => {
  let nested = "leaf";
  for (let i = 0; i < 40; i++) nested = { nested };
  const widest = Math.max(
    ...Bun.inspect(nested, { depth: Infinity })
      .split("\n")
      .map(line => line.search(/\S/)),
  );
  expect(widest).toBe(64);
});

it("a React element with a revoked Proxy for props prints no props", () => {
  const { proxy, revoke } = Proxy.revocable({ secret: 1 }, {});
  revoke();
  expect(Bun.inspect({ $$typeof: Symbol.for("react.element"), type: "div", key: null, props: proxy })).toBe("<div />");
});

it("an Event that only has the type of a MessageEvent or an ErrorEvent prints its own properties", () => {
  class Told extends Event {
    data = { a: 1 };
  }
  class Failed extends Event {
    message = "oops";
  }
  expect(Bun.inspect(new Told("message"))).toContain("data: {\n    a: 1,\n  }");
  expect(Bun.inspect(new Failed("error"))).toContain('message: "oops"');
  expect(Bun.inspect(new Event("message"))).not.toContain("MessageEvent");
  expect(Bun.inspect(new MessageEvent("message", { data: 1 }))).toBe(
    'MessageEvent {\n  type: "message",\n  data: 1,\n}',
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

it.concurrent("jsx with circular references does not crash", async () => {
  // Run in a subprocess: without the fix this overflows the native stack and segfaults,
  // which would otherwise kill the test runner before it can record a failure.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const a = { $$typeof: Symbol.for("react.element"), type: "div", props: null, key: null };
        a.props = a;
        console.log(Bun.inspect(a));

        const b = { $$typeof: Symbol.for("react.element"), type: "div", key: null };
        b.props = { children: b };
        console.log(Bun.inspect(b));

        const c = { $$typeof: Symbol.for("react.element"), type: "span", key: null };
        c.props = { children: [c, c] };
        console.log(Bun.inspect(c));

        const d = { $$typeof: Symbol.for("react.element"), type: "div", props: {} };
        d.key = d;
        console.log(Bun.inspect(d));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("[Circular]");
  expect(stdout).toContain("<div>\n  [Circular]\n</div>");
  expect(stdout).toContain("<span>\n  [Circular]\n  [Circular]\n</span>");
  expect(stdout).toContain("<div key=[Circular] />");
  expect(exitCode).toBe(0);
});

it.concurrent("deeply nested Proxy chain does not crash", async () => {
  // Without the fix, print_proxy recurses on the target without a stack-safety
  // check and segfaults; run in a subprocess so a regression fails the suite
  // instead of killing the runner.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let p = { ok: 1 };
        for (let i = 0; i < 100000; i++) p = new Proxy(p, {});
        console.log(Bun.inspect(p));
        console.log(p);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "{
      ok: 1,
    }
    {
      ok: 1,
    }"
  `);
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

it("jsx props are separated no matter where children sits in props", () => {
  // A spread can put `children` before the other props.
  expect(Bun.inspect(<x {...{ children: "c" }} a="1" b="2" />)).toBe(`<x a="1" b="2">c</x>`);
  expect(Bun.inspect(<x key="k" {...{ children: "c" }} a="1" b="2" />)).toBe(`<x key="k" a="1" b="2">c</x>`);
  // `children: undefined` is not printed and must not leave a stray space behind.
  const undefinedChild = (
    <x a="1" b="2">
      {undefined}
    </x>
  );
  expect(Bun.inspect(undefinedChild)).toBe(`<x a="1" b="2" />`);
  // Five props share the tag's line; the rest go one per line.
  const sixProps = <x a="1" b="2" c="3" d="4" e="5" f="6" />;
  expect(Bun.inspect(sixProps)).toBe(`<x a="1" b="2" c="3" d="4" e="5"\n  f="6" />`);
  expect(Bun.inspect(<x {...{ children: "c" }} a="1" b="2" c="3" d="4" e="5" f="6" />)).toBe(
    `<x a="1" b="2" c="3" d="4" e="5"\n  f="6">c</x>`,
  );
  // compact mode (also used for console.table cells) never wraps props and uses the same separator logic.
  expect(Bun.inspect(sixProps, { compact: true })).toBe(`<x a="1" b="2" c="3" d="4" e="5" f="6" />`);
  expect(Bun.inspect(undefinedChild, { compact: true })).toBe(`<x a="1" b="2" />`);
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

// JSC has three kinds of arguments objects: DirectArguments (sloppy function), ScopedArguments
// (sloppy function with a parameter captured by a closure) and ClonedArguments (strict function).
// The first two keep the arguments outside the regular indexed property storage. This file is a
// module, so its own functions are strict; the body of a `new Function` is sloppy regardless.
const argumentsObjectKinds = [
  ["direct", new Function("return arguments")],
  ["scoped", new Function("a", "const f = () => a; return arguments")],
  [
    "cloned",
    function () {
      return arguments;
    },
  ],
];
// Only a sloppy function's arguments object has `callee` as a data property (a strict one has a
// throwing accessor), so this tells the first two kinds from the third.
const isSloppyArguments = a => "value" in Object.getOwnPropertyDescriptor(a, "callee");

it.each(argumentsObjectKinds)("Bun.inspect %s arguments object with holes and extra indexes", (kind, args) => {
  expect(isSloppyArguments(args())).toBe(kind !== "cloned");
  let a = args(1, 2, 3);
  delete a[1];
  expect(Bun.inspect(a)).toBe("[ 1, empty item, 3 ]");
  a = args(1, 2, 3);
  delete a[2];
  expect(Bun.inspect(a)).toBe("[ 1, 2, empty item ]");
  // Runs of more than one deleted argument, each followed by an argument that is still there.
  a = args(1, 2, 3, 4, 5, 6, 7);
  for (const i of [1, 2, 4, 5]) delete a[i];
  a.length = 9;
  expect(Bun.inspect(a)).toBe("[ 1, 2 x empty items, 4, 2 x empty items, 7, 2 x empty items ]");
  // A deleted argument that is assigned again lives in the regular indexed storage. Here it
  // comes after a hole and before an argument that was never deleted.
  a = args(1, 2, 3, 4);
  delete a[1];
  delete a[2];
  a[2] = "x";
  expect(Bun.inspect(a)).toBe('[ 1, empty item, "x", 4 ]');
  a = args(1, 2, 3);
  Object.defineProperty(a, 1, { value: "x", enumerable: false });
  expect(Bun.inspect(a)).toBe('[ 1, "x", 3 ]');
  a = args(1, 2, 3);
  a.length = 2;
  expect(Bun.inspect(a)).toBe("[ 1, 2 ]");
  a = args();
  a.length = 3;
  expect(Bun.inspect(a)).toBe("[ 3 x empty items ]");
  // An index past the arguments themselves lands in the regular indexed storage
  // and only shows once `length` covers it, like any other array-like.
  a = args(1, 2, 3);
  a[5] = 6;
  expect(Bun.inspect(a)).toBe("[ 1, 2, 3 ]");
  a.length = 8;
  expect(Bun.inspect(a)).toBe("[ 1, 2, 3, 2 x empty items, 6, 2 x empty items ]");
  delete a[2];
  a[1_000_000] = "far";
  a.length = 1_000_002;
  expect(Bun.inspect(a)).toBe('[\n  1, 2, 3 x empty items, 6, 999994 x empty items, "far", empty item\n]');
});

it("Bun.inspect arguments object without a length ends at its last element, in time linear in what it holds", () => {
  function args() {
    return arguments;
  }
  const a = args(1);
  delete a.length;
  // Enough that asking the sparse map once per element does not finish before the timeout.
  for (let i = 0; i < 50_000; i++) a[1e6 + i * 3] = i;
  const text = Bun.inspect(a);
  expect(text).toStartWith("[\n  1, 999999 x empty items, 0, 2 x empty items, 1, 2 x empty items, 2,");
  // 1e6 + 49_999 * 3 + 1 indexes, less the 1e6 + 99 * 3 before the hundredth sparse element.
  expect(text).toContain("... 149701 more items");
});

// Unlike an array's, an arguments object's `length` is an ordinary writable property: it can be
// anything at all (past 2^32 - 1, a getter) with only a handful of elements behind it, so it must
// not drive an index-by-index probe either. In a child for the same reason as above.
it("Bun.inspect arguments object with a huge length summarizes holes without iterating them", async () => {
  // Code given to -e without a require() is a module as well, so the same three definitions.
  const code = `
    const direct = new Function("return arguments");
    const scoped = new Function("a", "const f = () => a; return arguments");
    class K { static cloned() { return arguments; } }
    const isSloppyArguments = ${isSloppyArguments};
    for (const args of [direct, scoped, K.cloned]) {
      const a = args(1, 2, 3);
      console.log(isSloppyArguments(a));
      a.length = 2 ** 32;
      console.log(a);
      const b = args(1, 2, 3);
      delete b[1];
      b[70] = 70;
      b[4294967294] = "max";
      // Does not run: the array then ends at its last element.
      Object.defineProperty(b, "length", { get: () => 2 ** 50 });
      console.log(Bun.inspect({ b }));
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const formatted =
    "[\n  1, 2, 3, 4294967293 x empty items\n]\n" +
    '{\n  b: [\n    1, empty item, 3, 67 x empty items, 70, 4294967223 x empty items, "max"\n  ],\n}\n';
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "true\n" + formatted + "true\n" + formatted + "false\n" + formatted,
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
    // ReferenceError. util.inspect prints such an export as `<uninitialized>`, this formatter leaves
    // it out.
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
  expect(Bun.inspect(blob)).toBe('Blob (3 bytes) {\n  type: "text/plain;charset=utf-8"\n}');
  blob.name = "bar";
  expect(Bun.inspect(blob)).toBe('Blob (3 bytes) {\n  name: "bar",\n  type: "text/plain;charset=utf-8"\n}');
  blob.name = "foobar";
  expect(Bun.inspect(blob)).toBe('Blob (3 bytes) {\n  name: "foobar",\n  type: "text/plain;charset=utf-8"\n}');

  const file = new File(["foo"], "bar.txt", { type: "text/plain" });
  expect(Bun.inspect(file)).toBe(
    `File (3 bytes) {\n  name: "bar.txt",\n  type: "text/plain;charset=utf-8",\n  lastModified: ${file.lastModified}\n}`,
  );
  file.name = "foobar";
  expect(Bun.inspect(file)).toBe(
    `File (3 bytes) {\n  name: "foobar",\n  type: "text/plain;charset=utf-8",\n  lastModified: ${file.lastModified}\n}`,
  );
  file.name = "";
  expect(Bun.inspect(file)).toBe(
    `File (3 bytes) {\n  name: "",\n  type: "text/plain;charset=utf-8",\n  lastModified: ${file.lastModified}\n}`,
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

// Objects made only of data properties are enumerated straight from their Structure (fast
// path); a getter takes the same object through getOwnPropertyNames (slow path); `sorted`
// uses a third walker. Which keys get hidden must not depend on the path taken.
describe("Symbol.toStringTag property", () => {
  it("prints an own enumerable Symbol.toStringTag on every enumeration path", () => {
    expect(Bun.inspect({ a: 1, [Symbol.toStringTag]: "Tag" })).toBe(
      'Tag {\n  a: 1,\n  [Symbol(Symbol.toStringTag)]: "Tag",\n}',
    );
    expect(Bun.inspect({ a: 1, get g() {}, [Symbol.toStringTag]: "Tag" })).toBe(
      'Tag {\n  a: 1,\n  g: [Getter],\n  [Symbol(Symbol.toStringTag)]: "Tag",\n}',
    );
    expect(Bun.inspect({ a: 1, [Symbol.toStringTag]: "Tag" }, { sorted: true })).toBe(
      'Tag {\n  [Symbol(Symbol.toStringTag)]: "Tag",\n  a: 1,\n}',
    );
  });

  it("hides an own non-enumerable Symbol.toStringTag on every enumeration path", () => {
    const data = { a: 1 };
    Object.defineProperty(data, Symbol.toStringTag, { value: "Tag" });
    expect(Bun.inspect(data)).toBe("Tag {\n  a: 1,\n}");
    expect(Bun.inspect(data, { sorted: true })).toBe("Tag {\n  a: 1,\n}");

    const withGetter = { a: 1, get g() {} };
    Object.defineProperty(withGetter, Symbol.toStringTag, { value: "Tag" });
    expect(Bun.inspect(withGetter)).toBe("Tag {\n  a: 1,\n  g: [Getter],\n}");
  });

  it("applies the same enumerability rule to the prototypes it walks", () => {
    // Non-enumerable, the way classes and builtins brand themselves: hidden.
    class Branded {
      a = 1;
      method() {}
    }
    Object.defineProperty(Branded.prototype, Symbol.toStringTag, { value: "Branded" });
    expect(Bun.inspect(new Branded())).toBe("Branded {\n  a: 1,\n  method: [Function: method],\n}");

    class BrandedByGetter {
      a = 1;
      get [Symbol.toStringTag]() {
        return "BrandedByGetter";
      }
    }
    expect(Bun.inspect(new BrandedByGetter())).toBe("BrandedByGetter {\n  a: 1,\n}");

    // Plain assignment makes it enumerable, and enumerable prototype data is printed,
    // whether or not the prototype also has a getter.
    class Assigned {
      a = 1;
      method() {}
    }
    Assigned.prototype[Symbol.toStringTag] = "Assigned";
    expect(Bun.inspect(new Assigned())).toBe(
      'Assigned {\n  a: 1,\n  method: [Function: method],\n  [Symbol(Symbol.toStringTag)]: "Assigned",\n}',
    );

    class AssignedWithGetter {
      a = 1;
      get g() {}
    }
    AssignedWithGetter.prototype[Symbol.toStringTag] = "AssignedWithGetter";
    expect(Bun.inspect(new AssignedWithGetter())).toBe(
      'AssignedWithGetter {\n  a: 1,\n  g: [Getter],\n  [Symbol(Symbol.toStringTag)]: "AssignedWithGetter",\n}',
    );
  });
});

describe("__esModule property", () => {
  it("hides the non-enumerable marker compiled CommonJS modules define, with or without re-export getters", () => {
    // What tsc / babel emit: Object.defineProperty(exports, "__esModule", { value: true })
    const dataOnly = {};
    Object.defineProperty(dataOnly, "__esModule", { value: true });
    dataOnly.foo = 1;
    expect(Bun.inspect(dataOnly)).toBe("{\n  foo: 1,\n}");

    const withReExport = {};
    Object.defineProperty(withReExport, "__esModule", { value: true });
    withReExport.foo = 1;
    Object.defineProperty(withReExport, "bar", { enumerable: true, get: () => 2 });
    expect(Bun.inspect(withReExport)).toBe("{\n  foo: 1,\n  bar: [Getter],\n}");
  });

  it("prints an enumerable __esModule like any other key", () => {
    expect(Bun.inspect({ __esModule: true, foo: 1 })).toBe("{\n  __esModule: true,\n  foo: 1,\n}");
    expect(Bun.inspect({ __esModule: true, foo: 1, get g() {} })).toBe(
      "{\n  __esModule: true,\n  foo: 1,\n  g: [Getter],\n}",
    );

    // Inherited ones follow the same rule on both paths.
    const dataOnly = Object.create({ __esModule: true, method() {} });
    dataOnly.x = 1;
    expect(Bun.inspect(dataOnly)).toBe("{\n  x: 1,\n  __esModule: true,\n  method: [Function: method],\n}");

    const withGetter = Object.create({ __esModule: true, get g() {} });
    withGetter.x = 1;
    expect(Bun.inspect(withGetter)).toBe("{\n  x: 1,\n  __esModule: true,\n  g: [Getter],\n}");
  });
});

// Symbol keys are printed after the string keys (OrdinaryOwnPropertyKeys order, what
// node prints) regardless of insertion order. The formatter walks an object with no
// accessors straight off its Structure, which stores keys in insertion order; an
// object with a getter goes through getOwnPropertyNames instead. Each case is
// formatted both ways and must print the same thing.
describe("symbol keys print after string keys", () => {
  const s = Symbol("s");
  const t = Symbol("t");

  it("object literal", () => {
    expect(Bun.inspect({ [s]: 1, a: 2 })).toBe("{\n  a: 2,\n  [Symbol(s)]: 1,\n}");
    expect(Bun.inspect({ [s]: 1, a: 2, get g() {} })).toBe("{\n  a: 2,\n  g: [Getter],\n  [Symbol(s)]: 1,\n}");
  });

  it.each([
    ["symbol inserted first", () => ({ [s]: 1, a: 2, b: 3 }), "{ a: 2, b: 3, [Symbol(s)]: 1 }"],
    ["symbol inserted in the middle", () => ({ a: 2, [s]: 1, b: 3 }), "{ a: 2, b: 3, [Symbol(s)]: 1 }"],
    [
      "symbols keep their insertion order among themselves",
      () => ({ [t]: 1, a: 2, [s]: 3, b: 4 }),
      "{ a: 2, b: 4, [Symbol(t)]: 1, [Symbol(s)]: 3 }",
    ],
    ["only symbol keys", () => ({ [t]: 1, [s]: 2 }), "{ [Symbol(t)]: 1, [Symbol(s)]: 2 }"],
    [
      "class fields",
      () =>
        new (class Foo {
          [s] = 1;
          a = 2;
        })(),
      "Foo { a: 2, [Symbol(s)]: 1 }",
    ],
    ["nested object", () => ({ [s]: { [t]: 1, x: 2 }, a: 3 }), "{ a: 3, [Symbol(s)]: { x: 2, [Symbol(t)]: 1 } }"],
    [
      "own properties first, then the prototype's, symbols last within each",
      () => {
        const obj = Object.create({ [t]: 1, p: 2 });
        obj[s] = 3;
        obj.a = 4;
        return obj;
      },
      "{ a: 4, [Symbol(s)]: 3, p: 2, [Symbol(t)]: 1 }",
    ],
    ["no own properties, only the prototype's", () => Object.create({ [t]: 1, p: 2 }), "{ p: 2, [Symbol(t)]: 1 }"],
  ])("%s", (_, init, expected) => {
    expect(Bun.inspect(init(), { compact: true })).toBe(expected);

    const withGetter = init();
    Object.defineProperty(withGetter, "getter", { get: () => 0, enumerable: true });
    const printed = Bun.inspect(withGetter, { compact: true });
    expect(printed).toContain("getter: [Getter], ");
    expect(printed.replace("getter: [Getter], ", "")).toBe(expected);
  });
});

it("CloseEvent", () => {
  const closeEvent = new CloseEvent("close", {
    code: 1000,
    reason: "Normal",
  });
  expect(Bun.inspect(closeEvent)).toMatchInlineSnapshot(`
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
  const text = normalizeBunSnapshot(Bun.inspect(errorEvent));
  // The caret is indented by the width of the line numbers, which is three digits in the snapshot.
  const width = text.match(/(\d+) \| /)[1].length;
  expect(text.replace(/\d+ \| /gim, "NNN |").replace(/^ +(?=\^$)/m, indent => indent.slice(width - 3)))
    .toMatchInlineSnapshot(`
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
  expect(Bun.inspect(customEvent)).toMatchInlineSnapshot(`
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
  // Each timing covers 30,000 properties, so a garbage collection or a preemption is as likely in
  // one as in the other, and the fastest of a few has neither. A quadratic walk is slow in all of them.
  function timeInspect(o, times) {
    let ms = Infinity;
    let out;
    for (let round = 0; round < 5; round++) {
      const t0 = performance.now();
      for (let i = 0; i < times; i++) out = Bun.inspect(o);
      ms = Math.min(ms, performance.now() - t0);
    }
    return { ms, out };
  }

  const small = makeWide(3000);
  const large = makeWide(30000);

  withoutAggressiveGC(() => {
    Bun.inspect(small); // warm up
    const s = timeInspect(small, 10);
    const l = timeInspect(large, 1);

    // Output still lists every property (no behavior change).
    expect(s.out.includes("p2999")).toBe(true);
    expect(l.out.includes("p29999")).toBe(true);

    // Per-property cost must stay roughly constant as n grows 10x. The previous
    // Vector-based visited-property dedup was O(n^2), giving a ~9x ratio here.
    expect(l.ms / s.ms).toBeLessThan(3);
  });
});

describe.each([
  ["WeakMap", WeakMap],
  ["WeakSet", WeakSet],
])("%s with user-added size property", (name, Ctor) => {
  it("Bun.inspect does not attempt to iterate", () => {
    expect(Bun.inspect(new Ctor())).toBe(`${name} {}`);

    const w = new Ctor();
    w.size = 2;
    expect(Bun.inspect(w)).toBe(`${name} {}`);
  });

  it("Bun.inspect does not invoke a .size getter", () => {
    const w = new Ctor();
    let called = false;
    Object.defineProperty(w, "size", {
      get() {
        called = true;
        throw new Error("should not be called");
      },
    });
    expect(Bun.inspect(w)).toBe(`${name} {}`);
    expect(called).toBe(false);
  });
});

describe("boxed primitives and RegExp with overridden conversion hooks", () => {
  it("reads the internal slot, does not run user hooks, does not throw", () => {
    const calls = [];
    const throwing = () => {
      calls.push("THROW");
      throw new Error("should not be called");
    };

    const n = new Number(5);
    n[Symbol.toPrimitive] = throwing;
    n.toString = throwing;
    n.valueOf = throwing;

    const bFalse = new Boolean(false);
    bFalse[Symbol.toPrimitive] = throwing;
    bFalse.toString = throwing;
    bFalse.valueOf = throwing;

    const bTrue = new Boolean(true);
    bTrue.toString = throwing;

    const s = new String("hello");
    s[Symbol.toPrimitive] = throwing;
    s.toString = throwing;
    s.valueOf = throwing;

    const r = /a/g;
    r[Symbol.toPrimitive] = throwing;
    r.toString = throwing;

    const nan = new Number(NaN);
    nan.toString = throwing;

    const inf = new Number(Infinity);
    inf.toString = throwing;

    expect(Bun.inspect(n)).toBe("[Number: 5]");
    expect(Bun.inspect(nan)).toBe("[Number: NaN]");
    expect(Bun.inspect(inf)).toBe("[Number: Infinity]");
    expect(Bun.inspect(new Number(-Infinity))).toBe("[Number: -Infinity]");
    expect(Bun.inspect(new Number(-0))).toBe("[Number: -0]");
    expect(Bun.inspect(bFalse)).toBe("[Boolean: false]");
    expect(Bun.inspect(bTrue)).toBe("[Boolean: true]");
    expect(Bun.inspect(s)).toBe('"hello"');
    expect(Bun.inspect(r)).toBe("/a/g");
    // nested in an object: must not abort mid-print
    expect(Bun.inspect({ before: 1, boxed: n, after: 2 })).toBe(
      "{\n  before: 1,\n  boxed: [Number: 5],\n  after: 2,\n}",
    );

    const s16 = new String("日本語");
    s16.toString = throwing;
    expect(Bun.inspect(s16)).toBe('"日本語"');
    expect(Bun.inspect({ x: s16 })).toBe('{\n  x: "日本語",\n}');

    class MyNum extends Number {}
    const mn = new MyNum(3);
    mn.toString = throwing;
    expect(Bun.inspect(mn)).toBe("[Number (MyNum): 3]");

    class MyBool extends Boolean {}
    const mb = new MyBool(false);
    mb.toString = throwing;
    expect(Bun.inspect(mb)).toBe("[Boolean (MyBool): false]");

    class MyStr extends String {}
    const ms = new MyStr("hi");
    ms.toString = throwing;
    expect(Bun.inspect(ms)).toBe('"hi"');

    expect(calls).toEqual([]);
  });

  it("console.log does not run user hooks and does not throw mid-line", async () => {
    const src = `
      const calls = [];
      const hook = tag => () => { calls.push(tag); return "SPOOF"; };
      const throwing = () => { throw new Error("boom") };

      const n = new Number(5);
      n[Symbol.toPrimitive] = hook("n");
      console.log(n);

      const b = new Boolean(false);
      b.toString = hook("b");
      console.log(b);

      const s = new String("hi");
      s.toString = hook("s");
      console.log(s);

      const t = new Number(7);
      t.toString = throwing;
      console.log(t);

      const r = /abc/gi;
      r.toString = throwing;
      console.log(r);

      console.log({ before: 1, boxed: t, re: r, after: 2 });

      // As non-last args (must not be promoted to the %-format string path):
      console.log(r, "x");
      console.log(s, "x");
      console.log(new String("%s"), "arg");

      const s16 = new String("😀日本語");
      s16.toString = throwing;
      console.log(s16);

      console.log("calls:" + calls.length);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: { ...bunEnv, NO_COLOR: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "[Number: 5]
      [Boolean: false]
      [String: "hi"]
      [Number: 7]
      /abc/gi
      {
        before: 1,
        boxed: [Number: 7],
        re: /abc/gi,
        after: 2,
      }
      /abc/gi x
      [String: "hi"] x
      [String: "%s"] arg
      [String: "😀日本語"]
      calls:0"
    `);
    expect(exitCode).toBe(0);
  });
});

// The formatter drives `Symbol.iterator` for a Map, a Set and their iterators.
// Once user code replaces it, user code decides when the walk ends, and an
// iterator that never reports `done` printed forever at 100% CPU. The walk now
// stops at the number of entries the collection reports, as in node.
describe("inspect bounds a replaced Map or Set iterator", () => {
  const entries = length => Array.from({ length }, (_, i) => [i, i]);
  const values = length => Array.from({ length }, (_, i) => i);

  it("a collection that user code did not touch prints every entry", () => {
    expect(Bun.inspect(new Map(entries(150)))).toEndWith("  148: 148,\n  149: 149,\n}");
    expect(Bun.inspect(new Set(values(150)))).toEndWith("  148,\n  149,\n}");
    expect(Bun.inspect(new Map(entries(150)).keys())).toEndWith("  148,\n  149,\n}");
    expect(Bun.inspect(new Set(values(150)).values())).toEndWith("  148,\n  149,\n}");
  });

  it("a subclass with more stored entries than the budget prints every entry", () => {
    class Collection extends Map {}
    class Bag extends Set {}
    expect(Bun.inspect(new Collection(entries(1500)))).toEndWith("  1498: 1498,\n  1499: 1499,\n}");
    expect(Bun.inspect(new Bag(values(1500)))).toEndWith("  1498,\n  1499,\n}");
  });

  // quick-lru is a Map subclass of this shape: it never calls `super.set`, so
  // the inherited storage stays empty.
  class Elsewhere extends Map {
    #items = [
      ["a", 1],
      ["b", 2],
    ];
    get size() {
      return this.#items.length;
    }
    *[Symbol.iterator]() {
      yield* this.#items;
    }
  }

  it("a Map subclass that keeps its entries elsewhere prints them", () => {
    expect(Bun.inspect(new Elsewhere())).toBe('Map(2) {\n  "a": 1,\n  "b": 2,\n}');
    expect(Bun.inspect(new Elsewhere(), { compact: true })).toBe('Map(2) { "a": 1, "b": 2 }');
    expect(Bun.inspect.table(new Elsewhere())).toBe(
      [
        "┌───┬─────┬────────┐",
        "│   │ Key │ Values │",
        "├───┼─────┼────────┤",
        "│ 0 │ a   │ 1      │",
        "│ 1 │ b   │ 2      │",
        "└───┴─────┴────────┘",
        "",
      ].join("\n"),
    );
  });

  it("such a subclass prints every entry past the budget for unsized iterables", () => {
    class Cache extends Map {
      #items = entries(1500);
      get size() {
        return this.#items.length;
      }
      *[Symbol.iterator]() {
        yield* this.#items;
      }
    }
    expect(Bun.inspect(new Cache())).toEndWith("  1498: 1498,\n  1499: 1499,\n}");
    expect(Bun.inspect.table(new Cache())).toEndWith("│ 1499 │ 1499 │ 1499   │\n└──────┴──────┴────────┘\n");
  });

  it("reads `size` once", () => {
    let reads = 0;
    class Counted extends Map {
      get size() {
        reads++;
        return 1;
      }
      *[Symbol.iterator]() {
        yield ["a", 1];
      }
    }
    expect(Bun.inspect(new Counted())).toBe('Map(1) {\n  "a": 1,\n}');
    expect(reads).toBe(1);
  });

  it("an iterator that yields more than `size` is cut there and marked", () => {
    class Overflow extends Map {
      get size() {
        return 2;
      }
      *[Symbol.iterator]() {
        for (let i = 0; i < 5; i++) yield [i, i];
      }
    }
    class OverflowSet extends Set {
      get size() {
        return 2;
      }
      *[Symbol.iterator]() {
        for (let i = 0; i < 5; i++) yield i;
      }
    }
    expect(Bun.inspect(new Overflow())).toBe("Map(2) {\n  0: 0,\n  1: 1,\n  ... more items\n}");
    expect(Bun.inspect(new Overflow(), { compact: true })).toBe("Map(2) { 0: 0, 1: 1, ... more items }");
    expect(Bun.inspect(new OverflowSet())).toBe("Set(2) {\n  0,\n  1,\n  ... more items\n}");
    expect(Bun.inspect(new OverflowSet(), { compact: true })).toBe("Set(2) { 0, 1, ... more items }");
  });

  it("closes the iterator it cuts short", () => {
    let returned = 0;
    class Overflow extends Map {
      get size() {
        return 1;
      }
      [Symbol.iterator]() {
        let i = 0;
        return {
          next: () => (i < 5 ? { value: [i, i++], done: false } : { value: undefined, done: true }),
          return: () => (returned++, {}),
        };
      }
    }
    expect(Bun.inspect(new Overflow())).toBe("Map(1) {\n  0: 0,\n  ... more items\n}");
    expect(returned).toBe(1);
  });
});

describe.concurrent("inspect survives an iterator that never ends", () => {
  // Stops the read at `limit` bytes and kills the child, so that a formatter that
  // prints without end reports `runaway` at once.
  async function run(source, stream) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: stream === "stdout" ? "pipe" : "ignore",
      stderr: stream === "stderr" ? "pipe" : "ignore",
    });

    const limit = 1024 * 1024;
    const decoder = new TextDecoder();
    let output = "";
    let runaway = false;
    for await (const chunk of proc[stream]) {
      output += decoder.decode(chunk, { stream: true });
      if (output.length > limit) {
        runaway = true;
        // Keep the assertion diff readable.
        output = output.slice(0, 256);
        proc.kill();
        break;
      }
    }
    return { output, runaway, exitCode: await proc.exited };
  }

  const count = (text, needle) => text.split(needle).length - 1;

  it("Map.prototype[Symbol.iterator]", async () => {
    const { output, runaway, exitCode } = await run(
      `Map.prototype[Symbol.iterator] = function* () { for (;;) yield ["k", "v"]; };
       console.log(new Map([["a", 1], ["b", 2]]));`,
      "stdout",
    );
    expect({ output, runaway }).toEqual({
      output: 'Map(2) {\n  "k": "v",\n  "k": "v",\n  ... more items\n}\n',
      runaway: false,
    });
    expect(exitCode).toBe(0);
  });

  it("Set.prototype[Symbol.iterator]", async () => {
    const { output, runaway, exitCode } = await run(
      `Set.prototype[Symbol.iterator] = function* () { for (;;) yield "x"; };
       console.log(new Set(["a", "b"]));`,
      "stdout",
    );
    expect({ output, runaway }).toEqual({ output: 'Set(2) {\n  "x",\n  "x",\n  ... more items\n}\n', runaway: false });
    expect(exitCode).toBe(0);
  });

  // What an iterator has left is read from the collection, so `next` does not run.
  it("a replaced next() on the Map iterator prototype", async () => {
    const { output, runaway, exitCode } = await run(
      `const map = new Map([["a", 1], ["b", 2]]);
       Object.getPrototypeOf(map.entries()).next = () => ({ value: ["k", "v"], done: false });
       console.log(map.entries());`,
      "stdout",
    );
    expect({ output, runaway }).toEqual({
      output: 'MapIterator { \n  [ "a", 1 ],\n  [ "b", 2 ],\n}\n',
      runaway: false,
    });
    expect(exitCode).toBe(0);
  });

  it("a replaced next() on the Set iterator prototype", async () => {
    const { output, runaway, exitCode } = await run(
      `const set = new Set(["a", "b"]);
       Object.getPrototypeOf(set.values()).next = () => ({ value: "k", done: false });
       console.log(set.values());`,
      "stdout",
    );
    expect({ output, runaway }).toEqual({ output: 'SetIterator { \n  "a",\n  "b",\n}\n', runaway: false });
    expect(exitCode).toBe(0);
  });

  it("a Map subclass whose size is not a finite count", async () => {
    const { output, runaway, exitCode } = await run(
      `let yielded = 0;
       class Lazy extends Map {
         get size() { return Infinity; }
         *[Symbol.iterator]() { for (;;) { if (++yielded > 5000) process.exit(2); yield [yielded, yielded]; } }
       }
       console.table(new Lazy());
       console.log("yielded=" + yielded);`,
      "stdout",
    );
    expect(runaway).toBe(false);
    // `Infinity` says nothing about where the walk ends, so the budget of 1000 rows applies.
    expect(output.split("\n").slice(-5)).toEqual([
      "│ 999 │ 1000 │ 1000   │",
      "└─────┴──────┴────────┘",
      "... more rows",
      "yielded=1001",
      "",
    ]);
    expect(exitCode).toBe(0);
  });

  it("an uncaught error that carries such a Map", async () => {
    const { output, runaway, exitCode } = await run(
      `Map.prototype[Symbol.iterator] = function* () { for (;;) yield ["k", "v"]; };
       const err = new Error("boom");
       err.ctx = new Map([["a", 1]]);
       throw err;`,
      "stderr",
    );
    expect(runaway).toBe(false);
    expect(output).toContain('ctx: Map(1) {\n  "k": "v",\n  ... more items\n}');
    expect(exitCode).toBe(1);
  });

  it("an uncaught AggregateError whose errors list never ends", async () => {
    const { output, runaway, exitCode } = await run(
      `const err = new AggregateError([], "boom");
       err.errors = { [Symbol.iterator]: function* () { for (;;) yield new Error("inner"); } };
       throw err;`,
      "stderr",
    );
    expect({ members: count(output, "error: inner"), runaway }).toEqual({ members: 100, runaway: false });
    expect(output).toContain("... more errors\n");
    expect(exitCode).toBe(1);
  });

  it("an AggregateError whose errors is a long array prints every member", async () => {
    const { output, runaway, exitCode } = await run(
      `console.error(new AggregateError(Array.from({ length: 150 }, (_, i) => "member" + i + ";"), "boom"));`,
      "stderr",
    );
    expect({
      first: output.includes("member0;"),
      last: output.includes("member149;"),
      marker: output.includes("... more errors"),
      runaway,
    }).toEqual({ first: true, last: true, marker: false, runaway: false });
    expect(exitCode).toBe(0);
  });
});

// One formatter prints for every sink below, so a value that is safe in one is
// safe in all of them. A new kind of hostile value goes in `values`, a new way
// to print a value goes in `sinks`, and the product is checked.
describe("hostile values in every sink", () => {
  const values = `
    // Counts the hooks that a printer has no business running.
    globalThis.ran = 0;
    const hook = () => { ran++; throw new Error("a hook ran"); };
    const el = (type, props) => ({ $$typeof: Symbol.for("react.element"), type, key: null, ref: null, props });
    const nest = (n, seed, wrap) => { let v = seed; for (let i = 0; i < n; i++) v = wrap(v); return v; };
    const tie = (v, close) => (close(v), v);
    function args() { return arguments; }
    const custom = Symbol.for("nodejs.util.inspect.custom");
    // A debug build has larger frames, and takes seconds to build 100,000 Maps.
    const deep = ${isDebug ? 5e3 : 1e5};

    globalThis.values = {
      // Deeper than the native stack.
      "deep object": () => nest(deep, {}, v => ({ v })),
      "deep array": () => nest(deep, [], v => [v]),
      "deep Map": () => nest(deep, new Map(), v => new Map([[1, v]])),
      "deep Set": () => nest(deep, new Set(), v => new Set([v])),
      "deep JSX": () => nest(deep, "leaf", v => el("div", { children: v })),
      "deep Proxy": () => nest(deep, { ok: 1 }, v => new Proxy(v, {})),
      "deep cause": () => nest(deep / 10, new Error("e"), v => new Error("e", { cause: v })),
      "deep errors": () => nest(deep / 10, new Error("e"), v => new AggregateError([v], "a")),
      "deep boxed": () => nest(deep, 1, v => Object.assign(new Number(1), { v })),

      // Reaches itself.
      "cyclic object": () => tie({}, v => (v.v = v)),
      "cyclic array": () => tie([], v => v.push(v)),
      "cyclic Map": () => tie(new Map(), v => v.set(v, v)),
      "cyclic Set": () => tie(new Set(), v => v.add(v)),
      "cyclic JSX": () => tie(el("div", {}), v => (v.props.children = v)),
      "cyclic cause": () => tie(new Error("e"), v => (v.cause = v)),
      "cyclic errors": () => tie(new AggregateError([], "a"), v => ((v.errors = [v]), (v.cause = v))),
      "cyclic boxed": () => tie(new Number(1), v => (v.v = v)),
      "cyclic through a Proxy": () => tie({}, v => (v.v = new Proxy(v, {}))),
      "cyclic MessageEvent": () => tie({}, data => (data.event = new MessageEvent("message", { data }))).event,

      // 2^40 paths to one leaf.
      "shared objects": () => nest(40, "leaf", v => ({ a: v, b: v })),
      "shared arrays": () => nest(40, "leaf", v => [v, v]),
      "shared Maps": () => nest(40, "leaf", v => new Map([[1, v], [2, v]])),
      "shared JSX": () => nest(40, "leaf", v => el("div", { children: [v, v] })),
      "shared causes": () => nest(40, new Error("e"), v => Object.assign(new Error("e"), { cause: v, other: v })),

      // Claims more than it holds.
      "sparse array": () => tie([], v => (v.length = 2 ** 32 - 1)),
      "arguments with a huge length": () => tie(args(1, 2), v => (v.length = 2 ** 53)),
      "JSX with sparse children": () => el("div", { children: tie(["a"], v => (v.length = 2 ** 32 - 1)) }),
      "sparse errors": () => Object.assign(new AggregateError([], "a"), { errors: tie([new Error("e")], v => (v.length = 2 ** 32 - 1)) }),
      "errors that grow as they print": () => tie(new AggregateError([], "a"), a => {
        const grows = () => Object.defineProperty(new Error(), "message", { get() { a.errors.push(grows()); return "m"; } });
        a.errors.push(grows());
      }),
      "arguments without a length": () => tie(args(1, 2), v => delete v.length),
      "WeakMap with a size": () => Object.assign(new WeakMap(), { size: 2 }),
      "WeakSet with a size": () => Object.assign(new WeakSet(), { size: 2 }),
      "endless Map": () => new (class extends Map { get size() { return 2; } *[Symbol.iterator]() { for (;;) yield [1, 1]; } })(),
      "endless Set": () => new (class extends Set { get size() { return 2; } *[Symbol.iterator]() { for (;;) yield 1; } })(),
      "endless errors": () => Object.assign(new AggregateError([], "a"), { errors: { *[Symbol.iterator]() { for (;;) yield 1; } } }),
      // Gets a million steps, which takes a debug build too long.
      ${isDebug || isASAN ? "" : '"endless Map with a huge size": () => new (class extends Map { get size() { return 2 ** 31 - 1; } *[Symbol.iterator]() { for (;;) yield [1, 1]; } })(),'}
      "endless generator": () => (function* () { for (;;) yield { a: 1 }; })(),
      "Map that grows as it prints": () => tie(new Map(), m => m.set(1, { [custom]() { m.set({}, this); return "v"; } })),
      "Set that grows as it prints": () => tie(new Set(), s => s.add({ [custom]() { s.add({ [custom]: this[custom] }); return "v"; } })),
      "iterator of a Set that grows as it prints": () => tie(new Set(), s => s.add({ [custom]() { s.add({ [custom]: this[custom] }); return "v"; } })).values(),

      // Hooks a printer has no business running.
      "$$typeof getter": () => ({ get $$typeof() { hook(); } }),
      "JSX getters": () => ({ $$typeof: Symbol.for("react.element"), get type() { hook(); }, get key() { hook(); }, get props() { hook(); } }),
      "JSX prop getters": () => el("div", { get a() { hook(); }, get children() { hook(); } }),
      "JSX props Proxy": () => el("div", new Proxy({ a: 1 }, { get: hook, ownKeys: hook, getOwnPropertyDescriptor: hook })),
      "boxed Number": () => Object.assign(new Number(1), { toString: hook, valueOf: hook, [Symbol.toPrimitive]: hook }),
      "boxed String": () => Object.assign(new String("s"), { toString: hook, valueOf: hook, [Symbol.toPrimitive]: hook }),
      "boxed Boolean": () => Object.assign(new Boolean(true), { toString: hook, valueOf: hook, [Symbol.toPrimitive]: hook }),
      "RegExp": () => Object.defineProperties(Object.assign(/a/g, { toString: hook }), { source: { get: hook }, flags: { get: hook } }),
      "Event": () => new (class extends Event { get type() { hook(); } })("t"),
      "MessageEvent": () => new (class extends MessageEvent { get type() { hook(); } get data() { hook(); } })("message", { data: 1 }),
      "ErrorEvent": () => new (class extends ErrorEvent { get type() { hook(); } get message() { hook(); } get error() { hook(); } })("error", { message: "m", error: 1 }),
      "arguments with a length getter": () => Object.defineProperty(args(1, 2), "length", { get: hook }),
      "accessor": () => ({ get a() { hook(); }, set a(v) { hook(); } }),
      "revoked Proxy": () => tie(Proxy.revocable({}, {}), v => v.revoke()).proxy,
      "Proxy of a revoked Proxy": () => { const { proxy, revoke } = Proxy.revocable({}, {}); const outer = new Proxy(proxy, {}); revoke(); return outer; },
    };

    // What the value is left with: an iterator that was printed still has its entries.
    globalThis.leaves = {
      "Map iterator": [() => new Map([[1, 2]]).entries(), it => it.next().done],
      "Set iterator": [() => new Set([1]).values(), it => it.next().done],
    };

    const { writeFileSync } = require("node:fs");
    // \`runsUserCode\`: the sink reads properties like a program would, so all that is left to
    // check is that it ends, stays small and leaves the value alone.
    globalThis.check = (sinks, limit, runsUserCode = false) => {
      const results = {};
      // Printing changes nothing, and a debug build takes seconds to build a deep value.
      const made = {};
      for (const [index, [sink, print]] of Object.entries(sinks).entries()) {
        for (const [name, make] of Object.entries(values)) {
          // It prints the whole budget of the policy, which the sinks of a process share.
          if (index > 0 && name.startsWith("shared ")) continue;
          // Names the culprit if the process dies here.
          writeFileSync(process.env.PROGRESS, sink + " / " + name);
          const value = (made[name] ??= make());
          ran = 0;
          let outcome = "ok";
          try {
            const size = print(value);
            if (size > limit) outcome = "printed " + size + " bytes";
          } catch (e) {
            if (!runsUserCode) outcome = "threw " + (e?.name ?? e) + ": " + String(e?.message).slice(0, 60);
          }
          if (ran && !runsUserCode) outcome += ", ran " + ran + " hooks";
          if (outcome !== "ok") (results[sink] ??= {})[name] = outcome;
        }
        for (const [name, [make, done]] of Object.entries(leaves)) {
          const it = make();
          try { print(it); } catch {}
          if (done(it)) (results[sink] ??= {})[name] = "was used up";
        }
      }
      writeFileSync(process.env.RESULTS, JSON.stringify(results));
    };
  `;

  async function run(files, cmd) {
    using dir = tempDir("hostile-values", { "values.js": values, ...files });
    const progress = join(String(dir), "progress.txt");
    const results = join(String(dir), "results.json");
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      env: { ...bunEnv, PROGRESS: progress, RESULTS: results },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    return {
      signalCode: proc.signalCode,
      results: await Bun.file(results)
        .json()
        .catch(async () => "died at: " + (await Bun.file(progress).text())),
    };
  }

  // These policies repeat shared values up to 2 ** 27 bytes, like util.inspect. JSX gets there, because
  // the depth option does not apply to it, and it lets through hundreds of renders of an error.
  const skipOnSlowBuild = isDebug || isASAN ? 'delete values["shared JSX"]; delete values["shared causes"];' : "";
  // These sinks report a stack overflow to their caller.
  const jsx = { "deep JSX": "threw RangeError: Maximum call stack size exceeded." };

  // One process for each policy a formatter is made with.
  it.concurrent("console", async () => {
    const seen = await run(
      {
        "sinks.js": `
          require("./values.js");
          ${skipOnSlowBuild}
          check({
            "Bun.inspect": v => Bun.inspect(v).length,
            "Bun.inspect sorted": v => Bun.inspect(v, { sorted: true }).length,
            "Bun.inspect compact": v => Bun.inspect(v, { compact: true, colors: true }).length,
            "Bun.inspect nested": v => Bun.inspect({ a: [v] }).length,
            "console.log": v => console.log(v, v),
            "console.error": v => console.error(v),
            "console.dir": v => console.dir(v, { depth: 4 }),
            "console.log %": v => console.log("%o %O %j %s %d", v, v, {}, "", 1),
          }, 2 ** 27 + 1024 * 1024);
        `,
      },
      ["sinks.js"],
    );
    expect(seen).toEqual({
      signalCode: null,
      results: {
        "Bun.inspect": jsx,
        "Bun.inspect sorted": jsx,
        // `compact` does not print the children of a React element.
        "Bun.inspect nested": jsx,
        "console.log": jsx,
        "console.error": jsx,
        "console.dir": jsx,
        "console.log %": jsx,
      },
    });
  });

  it.concurrent("error handler", async () => {
    const seen = await run(
      { "sinks.js": `require("./values.js"); ${skipOnSlowBuild} check({ "reportError": v => reportError(v) });` },
      ["sinks.js"],
    );
    // The error printer reads `message` off whatever it is given, and ignores what that throws.
    expect(seen).toEqual({ signalCode: null, results: { "reportError": { "ErrorEvent": "ok, ran 1 hooks" } } });
  });

  // A row is what `Object.keys` lists and a cell is what reading the property gives, as in Node.
  it.concurrent("table cell", async () => {
    const seen = await run(
      {
        "sinks.js": `
          require("./values.js");
          ${skipOnSlowBuild}
          check({
            "Bun.inspect.table": v => Bun.inspect.table(v).length,
            "Bun.inspect.table rows": v => Bun.inspect.table([v, { v }]).length,
            "console.table": v => console.table(v),
          }, 64 * 1024 * 1024, true);
        `,
      },
      ["sinks.js"],
    );
    expect(seen).toEqual({ signalCode: null, results: {} });
  });

  it.concurrent.each([
    [
      "diff",
      "expect(",
      {
        "toEqual received": "expect(v).toEqual(other)",
        "toEqual expected": "expect(other).toEqual(v)",
        "toStrictEqual nested": "expect({ a: [v] }).toStrictEqual(other)",
        "toHaveBeenCalledWith": "{ const f = mock(); f(v); expect(f).toHaveBeenCalledWith(other); }",
        "objectContaining": "expect(other).toEqual(expect.objectContaining({ v }))",
        "arrayContaining": "expect(other).toEqual(expect.arrayContaining([v]))",
      },
    ],
    [
      "matcher message",
      "expect(",
      {
        "toBe": "expect(v).toBe(other)",
        "toBeNull": "expect(v).toBeNull()",
        "toContain": "expect([other]).toContain(v)",
      },
    ],
    ["message", "Expected array, got ", { "test.each": "test.each({ v })" }],
  ])("%s", async (_, start, statements) => {
    const seen = await run(
      {
        "sinks.js": `
          const { expect, mock, test } = require("bun:test");
          require("./values.js");
          // A primitive, so that the comparison is over before it reads anything off the value.
          const other = 1;
          // It fails with its own message, not with what the value threw.
          const message = fails => v => {
            try { fails(v); } catch (e) {
              if (!String(e.message).startsWith(${JSON.stringify(start)})) throw e;
              return e.message.length;
            }
            throw new Error("did not throw");
          };
          check({
            ${Object.entries(statements)
              .map(([name, statement]) => `${JSON.stringify(name)}: message(v => ${statement}),`)
              .join("\n")}
          }, 32 * 1024 * 1024);
        `,
      },
      ["sinks.js"],
    );
    expect(seen).toEqual({ signalCode: null, results: {} });
  });

  // A snapshot makes the reads of the formatter that wrote the stored ones, so hooks run. It is exact
  // or it is an error, and lists a million entries before it gives up on an iterator.
  it.concurrent("snapshot", async () => {
    const seen = await run(
      {
        "sinks.test.js": `
          import { test, expect } from "bun:test";
          require("./values.js");
          for (const name of Object.keys(values))
            if (name.startsWith("shared ") || ${isDebug || isASAN} && name.startsWith("endless ")) delete values[name];
          test("sinks", () => check({
            "toMatchSnapshot": v => void expect(v).toMatchSnapshot(),
            "toMatchSnapshot nested": v => void expect({ a: [v] }).toMatchSnapshot(),
          }, Infinity, true), 120_000);
        `,
      },
      ["test", "--update-snapshots", "sinks.test.js"],
    );
    expect(seen).toEqual({ signalCode: null, results: {} });
  });
});
