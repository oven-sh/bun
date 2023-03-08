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
});

test("new Blob", () => {
  var blob = new Blob(["Bun", "Foo"], { type: "text/foo" });
  expect(blob.size).toBe(6);
  expect(blob.type).toBe("text/foo");

  blob = new Blob(["Bun", "Foo"], { type: "\u1234" });
  expect(blob.size).toBe(6);
  expect(blob.type).toBe("");
});
