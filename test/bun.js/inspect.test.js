import { it, expect } from "bun:test";

it("Blob inspect", () => {
  expect(Bun.inspect(new Blob(["123"]))).toBe(`Blob (3 bytes)`);
  expect(Bun.inspect(new Blob(["123".repeat(900)]))).toBe(`Blob (3 KB)`);
  expect(Bun.inspect(Bun.file("/tmp/file.txt")))
    .toBe(`FileRef ("/tmp/file.txt") {
  type: "text/plain;charset=utf-8"
}`);
  expect(Bun.inspect(Bun.file(123))).toBe(`FileRef (fd: 123) {
  type: "application/octet-stream"
}`);
  expect(Bun.inspect(new Response(""))).toBe(`Response (0 KB) {
  ok: true,
  url: "",
  statusText: "",
  redirected: false,
  bodyUsed: false,
  status: 200,
  [Blob detached]
}`);
  expect(Bun.inspect(new Response("Hello"))).toBe(`Response (5 bytes) {
  ok: true,
  url: "",
  statusText: "",
  redirected: false,
  bodyUsed: false,
  status: 200,
  Blob (5 bytes)
}`);
});

it("utf16 property name", () => {
  var { Database } = require("bun:sqlite");
  const db = Database.open(":memory:");
  expect(Bun.inspect(db.prepare("select '😀' as 笑").all())).toBe(
    '[ { "笑": "😀" } ]'
  );
});

it("latin1", () => {
  expect(Bun.inspect("English")).toBe("English");
  expect(Bun.inspect("Français")).toBe("Français");
  expect(Bun.inspect("Ελληνική")).toBe("Ελληνική");
  expect(Bun.inspect("日本語")).toBe("日本語");
  expect(Bun.inspect("Emoji😎")).toBe("Emoji😎");
  expect(Bun.inspect("Français / Ελληνική")).toBe("Français / Ελληνική");
});

it("Request object", () => {
  expect(Bun.inspect(new Request({ url: "https://example.com" })).trim()).toBe(
    `
Request (0 KB) {
  method: "GET",
  url: "https://example.com"
}`.trim()
  );
});

// https://github.com/oven-sh/bun/issues/561
it("TypedArray prints", () => {
  // TODO: add tests for all variants of typed arrays
  // even if the code is the same for each implementation, we should test it
  const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  const input = Bun.inspect(buffer);

  expect(input).toBe(
    `Uint8Array(${buffer.length}) [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]`
  );
  for (let i = 1; i < buffer.length + 1; i++) {
    expect(Bun.inspect(buffer.subarray(i))).toBe(
      `Uint8Array(${buffer.length - i}) [ ` +
        [...buffer.subarray(i)].join(", ") +
        " ]"
    );
  }
});

it("jsx with two elements", () => {
  const input = Bun.inspect(
    <div hello="quoted">
      <input type="text" value={"123"} />
      string inside child
    </div>
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
  expect(Bun.inspect(new TypeError("what")).includes("TypeError: what")).toBe(
    true
  );
  expect("hi").toBe("hi");
  expect(Bun.inspect(1)).toBe("1");
  expect(Bun.inspect(1, "hi")).toBe("1 hi");
  expect(Bun.inspect([])).toBe("[]");
  expect(Bun.inspect({})).toBe("{ }");
  expect(Bun.inspect({ hello: 1 })).toBe("{ hello: 1 }");
  expect(Bun.inspect({ hello: 1, there: 2 })).toBe("{ hello: 1, there: 2 }");
  expect(Bun.inspect({ hello: "1", there: 2 })).toBe(
    '{ hello: "1", there: 2 }'
  );
  expect(Bun.inspect({ 'hello-"there': "1", there: 2 })).toBe(
    '{ "hello-\\"there": "1", there: 2 }'
  );
  var str = "123";
  while (str.length < 4096) {
    str += "123";
  }
  expect(Bun.inspect(str)).toBe(str);
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
  expect(Bun.inspect(new Map([["foo", "bar"]]))).toBe(
    'Map(1) {\n  "foo": "bar",\n}'
  );
  expect(Bun.inspect(new Set(["bar"]))).toBe('Set(1) {\n  "bar",\n}');
  expect(Bun.inspect(<div>foo</div>)).toBe("<div>foo</div>");
  expect(Bun.inspect(<div hello>foo</div>)).toBe("<div hello=true>foo</div>");
  expect(Bun.inspect(<div hello={1}>foo</div>)).toBe("<div hello=1>foo</div>");
  expect(Bun.inspect(<div hello={123}>hi</div>)).toBe(
    "<div hello=123>hi</div>"
  );
  expect(Bun.inspect(<div hello="quoted">quoted</div>)).toBe(
    '<div hello="quoted">quoted</div>'
  );
  expect(
    Bun.inspect(
      <div hello="quoted">
        <input type="text" value={"123"} />
      </div>
    )
  ).toBe(
    `
<div hello="quoted">
  <input type="text" value="123" />
</div>`.trim()
  );
  expect(Bun.inspect(BigInt(32))).toBe("32n");
});
