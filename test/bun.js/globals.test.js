import { it, describe, expect } from "bun:test";

it("extendable", () => {
  const classes = [
    Blob,
    TextDecoder,
    TextEncoder,
    Request,
    Response,
    Headers,
    HTMLRewriter,
    Bun.Transpiler,
  ];
  // None of these should error
  for (let Class of classes) {
    var Foo = class extends Class {};
    var bar = new Foo();
    expect(bar instanceof Class).toBe(true);
    expect(!!Class.prototype).toBe(true);
    expect(typeof Class.prototype).toBe("object");
  }
  expect(true).toBe(true);
});

it("name", () => {
  const classes = [
    ["Blob", Blob],
    ["TextDecoder", TextDecoder],
    ["TextEncoder", TextEncoder],
    ["Request", Request],
    ["Response", Response],
    ["Headers", Headers],
    ["HTMLRewriter", HTMLRewriter],
    ["Transpiler", Bun.Transpiler],
  ];
  for (let [name, Class] of classes) {
    expect(Class.name).toBe(name);
  }
});
