import { expect, test } from "bun:test";

test("S3Client.write does not crash with out-of-range float as path", () => {
  expect(() => Bun.S3Client.write(-1.5379890021597998e308, "data")).toThrow();
  expect(() => Bun.S3Client.write(1e308, "data")).toThrow();
  expect(() => Bun.S3Client.write(Infinity, "data")).toThrow();
  expect(() => Bun.S3Client.write(-Infinity, "data")).toThrow();
  expect(() => Bun.S3Client.write(NaN, "data")).toThrow();
});

test("S3 file type option containing CR/LF or other control characters is not reflected into upload request headers", async () => {
  const seenRequests: { headers: Headers; url: string }[] = [];
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      seenRequests.push({ headers: req.headers, url: req.url });
      return new Response("", { status: 200 });
    },
  });

  const client = new Bun.S3Client({
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "eu-west-3",
    bucket: "my_bucket",
    endpoint: server.url.href,
  });

  // A `type` value embedding CR/LF is rejected outright at option-parsing time,
  // before any request is made, so it can never become extra request headers.
  expect(() => client.file("report.txt", { type: "text/plain\r\nx-amz-acl: public-read" })).toThrow(
    "type must not contain newline characters (CR/LF)",
  );

  // Other control characters in `type` must not be stored as the file's content
  // type, and must not leak into the outgoing object-storage request headers.
  const file = client.file("report.txt", { type: "text/plain\x0bx-amz-acl: public-read" });
  expect(file.type).not.toContain("\x0b");
  expect(file.type).not.toContain("public-read");
  await file.write("hello");

  expect(seenRequests.length).toBeGreaterThan(0);
  for (const seen of seenRequests) {
    expect(seen.headers.get("x-amz-acl")).toBeNull();
    expect(seen.headers.get("content-type") ?? "").not.toContain("public-read");
    expect(seen.headers.get("content-type") ?? "").not.toContain("\x0b");
  }

  // A legitimate content type still reaches the server unchanged.
  const before = seenRequests.length;
  await client.file("plain.txt", { type: "text/plain" }).write("hello");
  const legit = seenRequests.slice(before);
  expect(legit.length).toBeGreaterThan(0);
  expect(legit.some(seen => (seen.headers.get("content-type") ?? "").startsWith("text/plain"))).toBe(true);
  for (const seen of legit) {
    expect(seen.headers.get("x-amz-acl")).toBeNull();
  }
});

test("Bun.write(s3file, response) with a locked or disturbed body rejects instead of crashing", async () => {
  const client = new Bun.S3Client({
    accessKeyId: "a",
    secretAccessKey: "b",
    bucket: "c",
    // Never reached: both rejections happen synchronously before any request.
    endpoint: "http://127.0.0.1:1",
  });

  const locked = new Response(new ReadableStream({ pull() {} }));
  locked.body!.getReader(); // lock without disturbing
  await expect(Bun.write(client.file("k"), locked)).rejects.toThrow("ReadableStream is locked");

  // A disturbed body is rejected one layer earlier, synchronously.
  const disturbed = new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1)); } }));
  await disturbed.body!.getReader().read();
  expect(() => Bun.write(client.file("k"), disturbed)).toThrow("ReadableStream has already been used");
});
