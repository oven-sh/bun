import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

test("Blob.arrayBuffer copy-on-write is not shared", async () => {
  // 8 MB is the threshold for copy-on-write without --smol.
  const bytes = new Uint8Array((1024 * 1024 * 8 * 1.5) | 0);
  bytes.fill(42);
  bytes[bytes.length - 100] = 43;
  const blob = new Blob([bytes]);
  bytes.fill(8);

  const buf = new Uint8Array(await blob.arrayBuffer());
  expect(buf.length).toBe(blob.size);
  expect(buf[0]).toBe(42);
  expect(buf[buf.length - 1]).toBe(42);

  buf[0] = 0;

  const buf2 = new Uint8Array(await blob.arrayBuffer());
  expect(buf2[0]).toBe(42);
  buf2[0] = 1;
  expect(buf2[buf.length - 1]).toBe(42);

  const buf3 = new Uint8Array(await blob.slice(0, 1).arrayBuffer());
  expect(buf3[0]).toBe(42);
  buf3[0] = 2;
  expect(buf3.length).toBe(1);

  const buf4 = new Uint8Array(await blob.slice(blob.size - 100).arrayBuffer());
  expect(buf4[0]).toBe(43);
  buf4[0] = 3;
  expect(buf4.length).toBe(100);

  expect(buf[0]).toBe(0);
  expect(buf2[0]).toBe(1);
  expect(buf3[0]).toBe(2);
  expect(buf4[0]).toBe(3);
});

test("Response.arrayBuffer from a Blob body is not shared with the Blob", async () => {
  const blob = new Blob(["hello world"]);
  const buf = new Uint8Array(await new Response(blob).arrayBuffer());
  expect(new TextDecoder().decode(buf)).toBe("hello world");
  buf.fill(120);
  expect(await blob.text()).toBe("hello world");
});

test("Response.bytes from a Blob body is not shared with the Blob", async () => {
  const blob = new Blob(["hello world"]);
  const buf = await new Response(blob).bytes();
  expect(new TextDecoder().decode(buf)).toBe("hello world");
  buf.fill(120);
  expect(await blob.text()).toBe("hello world");
});

test("Request.arrayBuffer from a Blob body is not shared with the Blob", async () => {
  const blob = new Blob(["hello world"]);
  const request = new Request("http://localhost/", { method: "POST", body: blob });
  const buf = new Uint8Array(await request.arrayBuffer());
  expect(new TextDecoder().decode(buf)).toBe("hello world");
  buf.fill(120);
  expect(await blob.text()).toBe("hello world");
});

test("Response.bytes from a Blob body is not shared with text previously read from the Blob", async () => {
  const blob = new Blob(["hello world"]);
  const text = await blob.text();
  const buf = await new Response(blob).bytes();
  buf.fill(120);
  expect(text).toBe("hello world");
  expect(await blob.text()).toBe("hello world");
});

test("Response.bytes from an array of one Blob is not shared with the Blob", async () => {
  const blob = new Blob(["hello world"]);
  const buf = await new Response([blob] as any).bytes();
  expect(new TextDecoder().decode(buf)).toBe("hello world");
  buf.fill(120);
  expect(await blob.text()).toBe("hello world");
});

test("a Bun.build() output stays readable after it was a part of a Response body", async () => {
  using dir = tempDir("blob-cow-build-output", { "in.js": "console.log(1);" });
  const { outputs } = await Bun.build({ entrypoints: [join(String(dir), "in.js")], minify: true });
  expect(await new Response(outputs as any).text()).toBe("console.log(1);\n");
  expect(await outputs[0].text()).toBe("console.log(1);\n");
});

test("a request body from server.fetch() is not shared with the Blob", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(request) {
      const buf = await request.bytes();
      const text = new TextDecoder().decode(buf);
      buf.fill(120);
      return new Response(text);
    },
  });
  const blob = new Blob(["hello world"]);
  const response = await server.fetch(server.url.href, { method: "POST", body: blob });
  expect([await response.text(), blob.size, await blob.text()]).toEqual(["hello world", 11, "hello world"]);
});
