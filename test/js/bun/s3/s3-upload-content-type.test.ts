import { S3Client, type S3Options } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";

// S3 stores the PUT request's Content-Type as object metadata and serves it
// back verbatim, so a wrong header means images / HTML / JSON download instead
// of rendering. These tests drive uploads against a local recording origin and
// assert the Content-Type header that reached it.

describe("s3 - upload Content-Type from body", () => {
  let lastPut: { path: string; contentType: string | null } | undefined;
  let server: ReturnType<typeof Bun.serve>;
  let client: S3Client;
  let dir: ReturnType<typeof tempDir>;

  const s3Options: S3Options = {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    bucket: "b",
  };

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") {
          lastPut = {
            path: new URL(req.url).pathname,
            contentType: req.headers.get("content-type"),
          };
        }
        await req.arrayBuffer();
        return new Response("", { status: 200, headers: { ETag: '"e"' } });
      },
    });
    client = new S3Client({ ...s3Options, endpoint: server.url.href });
    dir = tempDir("s3-upload-content-type", {
      "logo.png": Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "noext": "hello",
    });
  });

  afterAll(() => {
    server.stop(true);
    dir[Symbol.dispose]();
  });

  async function capturePut(fn: () => Promise<unknown>) {
    lastPut = undefined;
    await fn();
    return lastPut!;
  }

  it("S3Client.write(key, Bun.file()) uses the source file's inferred type for an extensionless key", async () => {
    const png = Bun.file(path.join(String(dir), "logo.png"));
    expect(png.type).toBe("image/png");
    const put = await capturePut(() => client.write("uploads/8f3a1c", png));
    expect(put).toEqual({ path: "/b/uploads/8f3a1c", contentType: "image/png" });
  });

  it("Bun.write(s3.file(), Bun.file()) uses the source file's inferred type", async () => {
    const png = Bun.file(path.join(String(dir), "logo.png"));
    const put = await capturePut(() => Bun.write(client.file("assets/logo"), png));
    expect(put).toEqual({ path: "/b/assets/logo", contentType: "image/png" });
  });

  it("S3Client.write(key, Blob) uses the Blob's explicit type for an extensionless key", async () => {
    const blob = new Blob(['{"a":1}'], { type: "application/json" });
    const put = await capturePut(() => client.write("noext", blob));
    expect(put.contentType).toStartWith("application/json");
  });

  it("S3Client.write(key, Blob) prefers the Blob's explicit type over the key's extension", async () => {
    const blob = new Blob(["<p>hi</p>"], { type: "text/html" });
    const put = await capturePut(() => client.write("page.txt", blob));
    expect(put.contentType).toStartWith("text/html");
  });

  it("S3Client.write(key, Response) uses the Response's Content-Type header", async () => {
    const res = new Response("a,b", { headers: { "content-type": "text/csv" } });
    const put = await capturePut(() => client.write("noext-resp", res));
    expect(put).toEqual({ path: "/b/noext-resp", contentType: "text/csv" });
  });

  it("S3Client.write(key, Request) uses the Request's Content-Type header", async () => {
    const req = new Request("http://x/", {
      method: "POST",
      body: "a,b",
      headers: { "content-type": "text/csv" },
    });
    const put = await capturePut(() => client.write("noext-req", req));
    expect(put).toEqual({ path: "/b/noext-req", contentType: "text/csv" });
  });

  it("explicit {type} option still overrides the body's type", async () => {
    const png = Bun.file(path.join(String(dir), "logo.png"));
    const put = await capturePut(() => client.write("uploads/8f3a1c", png, { type: "text/plain" }));
    expect(put.contentType).toStartWith("text/plain");
  });

  it("falls back to key-extension inference when the body carries no type", async () => {
    const put = await capturePut(() => client.write("photo.png", new Uint8Array([1, 2, 3])));
    expect(put).toEqual({ path: "/b/photo.png", contentType: "image/png" });
  });

  it("falls back to key-extension inference when the source file has no recognised extension", async () => {
    const noext = Bun.file(path.join(String(dir), "noext"));
    expect(noext.type).toBe("application/octet-stream");
    const put = await capturePut(() => client.write("data.json", noext));
    expect(put.contentType).toStartWith("application/json");
  });

  it("typeless Blob does not override key-extension inference", async () => {
    const put = await capturePut(() => client.write("data.json", new Blob(["{}"])));
    expect(put.contentType).toStartWith("application/json");
  });
});
