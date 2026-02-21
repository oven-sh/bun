import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/21193
// Per the Fetch spec, BufferSource bodies (ArrayBuffer, TypedArray, DataView)
// should not have a default Content-Type header.
test("Response with Uint8Array body should not have content-type in Bun.serve", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(new TextEncoder().encode("hello"));
    },
  });

  const res = await fetch(server.url);
  expect(res.headers.get("content-type")).toBeNull();
  expect(await res.text()).toBe("hello");
});

test("Response with ArrayBuffer body should not have content-type in Bun.serve", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(new ArrayBuffer(8));
    },
  });

  const res = await fetch(server.url);
  expect(res.headers.get("content-type")).toBeNull();
  expect(res.headers.get("content-length")).toBe("8");
});

test("Response with DataView body should not have content-type in Bun.serve", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(new DataView(new ArrayBuffer(4)));
    },
  });

  const res = await fetch(server.url);
  expect(res.headers.get("content-type")).toBeNull();
  expect(res.headers.get("content-length")).toBe("4");
});

test("Response with string body should still have text/plain content-type", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("hello");
    },
  });

  const res = await fetch(server.url);
  expect(res.headers.get("content-type")).toBe("text/plain;charset=utf-8");
  expect(await res.text()).toBe("hello");
});

test("Response with Blob body should have blob content-type", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(new Blob(["hello"], { type: "text/html" }));
    },
  });

  const res = await fetch(server.url);
  expect(res.headers.get("content-type")).toBe("text/html;charset=utf-8");
  expect(await res.text()).toBe("hello");
});

test("Response with explicit content-type header and Uint8Array body should keep it", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(new TextEncoder().encode("hello"), {
        headers: { "content-type": "text/plain" },
      });
    },
  });

  const res = await fetch(server.url);
  expect(res.headers.get("content-type")).toBe("text/plain");
  expect(await res.text()).toBe("hello");
});
