// https://github.com/oven-sh/bun/issues/29074

import { expect, test } from "bun:test";

test("Response body from number array coerces via ToString", async () => {
  expect(await new Response([1, 2, 3]).text()).toBe("1,2,3");
});

test("Response body from string array coerces via ToString", async () => {
  expect(await new Response(["a", "b", "c"]).text()).toBe("a,b,c");
});

test("Response body matches Array.prototype.toString", async () => {
  const arr = [1, 2, 3, "x", "y"];
  expect(await new Response(arr).text()).toBe(arr.toString());
});

test("Response body from Array subclass coerces via ToString", async () => {
  class Derived extends Array {}
  const arr = new Derived();
  arr.push(1, 2, 3);
  expect(await new Response(arr).text()).toBe(arr.toString());
});

test("Request body from number array coerces via ToString", async () => {
  const req = new Request("http://example.com/", { method: "POST", body: [1, 2, 3] });
  expect(await req.text()).toBe("1,2,3");
});

test("new Blob([1, 2, 3]) still joins BlobPart[] without separators", async () => {
  // The Blob constructor path is NOT affected by the fix; arrays here
  // are `BlobPart[]` per the File API spec and join without separators.
  const blob = new Blob([1, 2, 3]);
  expect(await blob.text()).toBe("123");
});

test("Response body from Uint8Array still decodes bytes", async () => {
  expect(await new Response(new Uint8Array([65, 66, 67])).text()).toBe("ABC");
});

test("Response body from string still works", async () => {
  expect(await new Response("hello").text()).toBe("hello");
});
