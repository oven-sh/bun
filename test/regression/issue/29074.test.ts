// https://github.com/oven-sh/bun/issues/29074
//
// Per the Fetch spec, `BodyInit` is a union of ReadableStream, Blob,
// BufferSource, FormData, URLSearchParams, and USVString. A plain Array
// is not part of that union, so it falls through to USVString and gets
// coerced via ToString — matching Node and browsers
// (e.g. `new Response([1,2,3]).text()` → "1,2,3").
//
// Bun previously routed arrays through `Blob.get`, which treats them as
// `BlobPart[]` (correct for `new Blob([1,2,3])` → "123") — that's wrong
// for Response/Request body init.

import { describe, expect, test } from "bun:test";

describe("Response body from Array coerces via ToString", () => {
  test("numbers", async () => {
    expect(await new Response([1, 2, 3]).text()).toBe("1,2,3");
  });

  test("Array subclass (DerivedArray)", async () => {
    class Derived extends Array {}
    const arr = new Derived();
    arr.push(1, 2, 3);
    expect(await new Response(arr).text()).toBe("1,2,3");
  });

  test("Array subclass with mixed content", async () => {
    class Derived extends Array {}
    const arr = new Derived();
    arr.push("a", 1, true, null);
    expect(await new Response(arr).text()).toBe("a,1,true,");
  });

  test("strings", async () => {
    expect(await new Response(["a", "b", "c"]).text()).toBe("a,b,c");
  });

  test("empty array", async () => {
    expect(await new Response([]).text()).toBe("");
  });

  test("nested arrays", async () => {
    expect(
      await new Response([
        [1, 2],
        [3, 4],
      ]).text(),
    ).toBe("1,2,3,4");
  });

  test("objects in array", async () => {
    expect(await new Response([{ a: 1 }, { b: 2 }]).text()).toBe("[object Object],[object Object]");
  });

  test("mixed types", async () => {
    expect(await new Response([1, "a", true, null]).text()).toBe("1,a,true,");
  });

  test("sparse array", async () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(await new Response([1, , 3]).text()).toBe("1,,3");
  });

  test("matches Array.prototype.toString()", async () => {
    const arr = [1, 2, 3, "x", "y"];
    expect(await new Response(arr).text()).toBe(arr.toString());
  });
});

describe("Request body from Array coerces via ToString", () => {
  test("numbers", async () => {
    const req = new Request("http://example.com", {
      method: "POST",
      body: [1, 2, 3],
    });
    expect(await req.text()).toBe("1,2,3");
  });

  test("Array subclass (DerivedArray)", async () => {
    class Derived extends Array {}
    const arr = new Derived();
    arr.push(1, 2, 3);
    const req = new Request("http://example.com", {
      method: "POST",
      body: arr,
    });
    expect(await req.text()).toBe("1,2,3");
  });

  test("strings", async () => {
    const req = new Request("http://example.com", {
      method: "POST",
      body: ["a", "b", "c"],
    });
    expect(await req.text()).toBe("a,b,c");
  });
});

describe("other body-like types still work", () => {
  test("string", async () => {
    expect(await new Response("hello").text()).toBe("hello");
  });

  test("Uint8Array", async () => {
    expect(await new Response(new Uint8Array([65, 66, 67])).text()).toBe("ABC");
  });

  test("ArrayBuffer", async () => {
    const buf = new Uint8Array([65, 66, 67]).buffer;
    expect(await new Response(buf).text()).toBe("ABC");
  });

  test("URLSearchParams", async () => {
    const params = new URLSearchParams({ foo: "bar" });
    expect(await new Response(params).text()).toBe("foo=bar");
  });

  test("Blob", async () => {
    const blob = new Blob(["hello"]);
    expect(await new Response(blob).text()).toBe("hello");
  });

  test("number", async () => {
    expect(await new Response(42).text()).toBe("42");
  });

  test("plain object", async () => {
    expect(await new Response({ foo: "bar" }).text()).toBe("[object Object]");
  });

  test("new Blob() still joins parts without separators", async () => {
    // Separate: `new Blob([1, 2, 3])` is BlobPart[] semantics → "123".
    // This path is NOT affected by the fix.
    const blob = new Blob([1, 2, 3]);
    expect(await blob.text()).toBe("123");
  });
});
