import { test, expect } from "bun:test";

test("Blob.slice", () => {
  const blob = new Blob(["Bun", "Foo"]);
  const b1 = blob.slice(0, 3, "Text/HTML");
  expect(b1 instanceof Blob).toBeTruthy();
  expect(b1.size).toBe(3);
  expect(b1.type).toBe("text/html");
  const b2 = blob.slice(-1, 3);
  expect(b2.size).toBe(0);
  const b3 = blob.slice(100, 3);
  expect(b3.size).toBe(0);
  const b4 = blob.slice(0, 10);
  expect(b4.size).toBe(blob.size);

  expect(blob.slice().size).toBe(blob.size);
  expect(blob.slice(0).size).toBe(blob.size);
  expect(blob.slice(NaN).size).toBe(blob.size);
  expect(blob.slice(0, Infinity).size).toBe(blob.size);
  expect(blob.slice(-Infinity).size).toBe(blob.size);
  expect(blob.slice(0, NaN).size).toBe(0);
  // @ts-expect-error
  expect(blob.slice(Symbol(), "-123").size).toBe(6);
  expect(blob.slice(Object.create(null), "-123").size).toBe(6);
  // @ts-expect-error
  expect(blob.slice(null, "-123").size).toBe(6);
  expect(blob.slice(0, 10).size).toBe(blob.size);
  expect(blob.slice("text/plain;charset=utf-8").type).toBe("text/plain;charset=utf-8");
});

test("Blob.prototype.type setter", () => {
  var blob = new Blob(["Bun", "Foo"], { type: "text/foo" });
  expect(blob.type).toBe("text/foo");
  blob.type = "text/bar";
  expect(blob.type).toBe("text/bar");
  blob.type = "text/baz";
  expect(blob.type).toBe("text/baz");
  blob.type = "text/baz; charset=utf-8";
  expect(blob.type).toBe("text/baz; charset=utf-8");
  // @ts-expect-error
  blob.type = NaN;
  expect(blob.type).toBe("");
  // @ts-expect-error
  blob.type = Symbol();
  expect(blob.type).toBe("");
});

test("new Blob", () => {
  var blob = new Blob(["Bun", "Foo"], { type: "text/foo" });
  expect(blob.size).toBe(6);
  expect(blob.type).toBe("text/foo");

  blob = new Blob(["Bun", "Foo"], { type: "\u1234" });
  expect(blob.size).toBe(6);
  expect(blob.type).toBe("");
});
