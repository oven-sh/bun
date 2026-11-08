import { expect, test } from "bun:test";

const bytes = new TextEncoder().encode(JSON.stringify({ name: "Zoë" }));

test("json() of a Blob is the same after text() of an ASCII slice of it", async () => {
  const blob = new Blob([bytes]);
  expect(await blob.json()).toEqual({ name: "Zoë" });
  expect(await blob.slice(0, 1).text()).toBe("{");
  expect(await blob.json()).toEqual({ name: "Zoë" });
});

test("json() of a Blob is the same after a slice that nobody reads", async () => {
  const blob = new Blob([bytes]);
  expect(await blob.json()).toEqual({ name: "Zoë" });
  blob.slice(0, 1);
  expect(await blob.json()).toEqual({ name: "Zoë" });
});

test("json() of an ASCII Blob is the same after text() of a slice of it", async () => {
  const blob = new Blob([new TextEncoder().encode(JSON.stringify({ name: "Zoe" }))]);
  expect(await blob.json()).toEqual({ name: "Zoe" });
  expect(await blob.slice(0, 1).text()).toBe("{");
  expect(await blob.json()).toEqual({ name: "Zoe" });
  expect(await blob.text()).toBe('{"name":"Zoe"}');
});
