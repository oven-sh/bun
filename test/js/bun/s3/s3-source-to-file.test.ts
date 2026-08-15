import { expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";

function client(endpoint: string) {
  return new Bun.S3Client({
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "us-east-1",
    bucket: "bucket",
    endpoint,
  });
}

test("Bun.write(path, s3file) replaces a longer destination and resolves with the byte count", async () => {
  const body = Buffer.alloc(100, "S").toString();
  using server = Bun.serve({
    port: 0,
    fetch: () => new Response(body, { headers: { "content-length": String(body.length) } }),
  });
  using dir = tempDir("s3-source-to-file", {
    "out.bin": Buffer.alloc(500, "X").toString(),
  });
  const dest = path.join(String(dir), "out.bin");

  const n = await Bun.write(dest, client(server.url.href).file("obj.bin"));

  expect({ n, contents: await Bun.file(dest).text() }).toEqual({ n: 100, contents: body });
});

test("Bun.write(missing/dir/file, s3file) creates the parent directories", async () => {
  const body = "nested";
  using server = Bun.serve({
    port: 0,
    fetch: () => new Response(body, { headers: { "content-length": String(body.length) } }),
  });
  using dir = tempDir("s3-source-to-file-mkdirp", {});
  const dest = path.join(String(dir), "a", "b", "out.txt");

  const n = await Bun.write(dest, client(server.url.href).file("obj.txt"));

  expect({ n, contents: await Bun.file(dest).text() }).toEqual({ n: body.length, contents: body });
});
