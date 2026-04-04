import { expect, test } from "bun:test";

// Regression test for a Fuzzilli-found crash in ByteBlobLoader.toBufferedValue:
// calling a buffered consumer (text/bytes/blob/json) on a blob-backed
// ReadableStream after the underlying store has been detached used to return
// an empty JSValue without throwing, tripping the
// "Expected an exception to be thrown" assertion.
test("blob stream buffered consumers do not crash on empty blob", async () => {
  expect(await new Blob([]).stream().text()).toBe("");
  expect((await new Blob([]).stream().bytes()).byteLength).toBe(0);
  expect((await new Blob([]).stream().blob()).size).toBe(0);
  await expect(new Blob([]).stream().json()).rejects.toThrow();
});

test("blob stream buffered consumers return data for non-empty blob", async () => {
  expect(await new Blob(["hello"]).stream().text()).toBe("hello");
  expect(Array.from(await new Blob(["hi"]).stream().bytes())).toEqual([104, 105]);
  expect((await new Blob(["x"]).stream().blob()).size).toBe(1);
  expect(await new Blob(['{"a":1}']).stream().json()).toEqual({ a: 1 });
});
