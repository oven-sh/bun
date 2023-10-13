import { test, expect } from "bun:test";

test("Blob.slice", async () => {
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

  // test Blob.slice().slice(), issue#6252
  expect(await blob.slice(0, 4).slice(0, 3).text()).toBe("Bun");
  expect(await blob.slice(0, 4).slice(1, 3).text()).toBe("un");
  expect(await blob.slice(1, 4).slice(0, 3).text()).toBe("unF");
  expect(await blob.slice(1, 4).slice(1, 3).text()).toBe("nF");
  expect(await blob.slice(1, 4).slice(2, 3).text()).toBe("F");
  expect(await blob.slice(1, 4).slice(3, 3).text()).toBe("");
  expect(await blob.slice(1, 4).slice(4, 3).text()).toBe("");
  // test negative start
  expect(await blob.slice(1, 4).slice(-1, 3).text()).toBe("F");
  expect(await blob.slice(1, 4).slice(-2, 3).text()).toBe("nF");
  expect(await blob.slice(1, 4).slice(-3, 3).text()).toBe("unF");
  expect(await blob.slice(1, 4).slice(-4, 3).text()).toBe("unF");
  expect(await blob.slice(1, 4).slice(-5, 3).text()).toBe("unF");
  expect(await blob.slice(-1, 4).slice(-1, 3).text()).toBe("");
  expect(await blob.slice(-2, 4).slice(-1, 3).text()).toBe("");
  expect(await blob.slice(-3, 4).slice(-1, 3).text()).toBe("F");
  expect(await blob.slice(-4, 4).slice(-1, 3).text()).toBe("F");
  expect(await blob.slice(-5, 4).slice(-1, 3).text()).toBe("F");
  expect(await blob.slice(-5, 4).slice(-2, 3).text()).toBe("nF");
  expect(await blob.slice(-5, 4).slice(-3, 3).text()).toBe("unF");
  expect(await blob.slice(-5, 4).slice(-4, 3).text()).toBe("unF");
  expect(await blob.slice(-4, 4).slice(-3, 3).text()).toBe("nF");
  expect(await blob.slice(-5, 4).slice(-4, 3).text()).toBe("unF");
  expect(await blob.slice(-3, 4).slice(-2, 3).text()).toBe("F");
  expect(await blob.slice(-blob.size, 4).slice(-blob.size, 3).text()).toBe("Bun");
});

test("new Blob", () => {
  var blob = new Blob(["Bun", "Foo"], { type: "text/foo" });
  expect(blob.size).toBe(6);
  expect(blob.type).toBe("text/foo");

  blob = new Blob(["Bun", "Foo"], { type: "\u1234" });
  expect(blob.size).toBe(6);
  expect(blob.type).toBe("");
});
