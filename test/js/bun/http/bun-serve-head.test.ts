import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";

// RFC 9110 9.3.2: the server sends the same header fields in response to a HEAD
// request as it would have sent had the request been a GET. The representation
// metadata (Content-Type, Content-Length) is derived from the body that GET
// would have sent, even though HEAD sends no body bytes.
describe("HEAD mirrors GET's representation metadata", () => {
  async function metadataOf(url: string, method: string) {
    const res = await fetch(url, { method });
    const body = await res.arrayBuffer();
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentLength: res.headers.get("content-length"),
      bodyLength: body.byteLength,
    };
  }

  test.each([
    ["string body", () => new Response("hello")],
    ["typed Blob body", () => new Response(new Blob(["<h1>hi</h1>"], { type: "text/html" }))],
    ["sliced Blob body", () => new Response(new Blob(["abcdef"], { type: "text/html" }).slice(0, 3))],
    ["Uint8Array body", () => new Response(new Uint8Array([1, 2, 3]))],
    ["explicit Content-Type", () => new Response("hi", { headers: { "content-type": "text/foo" } })],
    ["bodiless", () => new Response(null)],
  ])("%s", async (_label, make) => {
    using server = Bun.serve({ port: 0, fetch: () => make() });
    const url = server.url.href;

    const get = await metadataOf(url, "GET");
    const head = await metadataOf(url, "HEAD");

    // HEAD advertises the same representation, but sends no body bytes.
    expect(head).toEqual({
      status: get.status,
      contentType: get.contentType,
      contentLength: get.contentLength,
      bodyLength: 0,
    });
  });

  test("Bun.file body", async () => {
    using dir = tempDir("serve-head", { "page.html": "<h1>hi</h1>" });
    const file = path.join(String(dir), "page.html");

    using server = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(file)) });
    const url = server.url.href;

    const get = await metadataOf(url, "GET");
    const head = await metadataOf(url, "HEAD");

    expect(get.contentType).toBe("text/html;charset=utf-8");
    expect(head).toEqual({
      status: get.status,
      contentType: get.contentType,
      contentLength: get.contentLength,
      bodyLength: 0,
    });
  });
});
