import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/27478
// Request.formData() truncates small binary files at first null byte
test("multipart formdata preserves null bytes in small binary files", async () => {
  const boundary = "----bun-null-byte-boundary";
  const source = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="test.bin"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      "utf8",
    ),
    source,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);

  const request = new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: payload,
  });

  const form = await request.formData();
  const file = form.get("file");
  expect(file).toBeInstanceOf(File);

  const parsed = new Uint8Array(await (file as File).arrayBuffer());
  expect(Array.from(parsed)).toEqual(Array.from(source));
  expect(parsed.byteLength).toBe(source.byteLength);
});

test("multipart formdata preserves files that are all null bytes", async () => {
  const boundary = "----bun-test-boundary";
  const source = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="zeros.bin"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      "utf8",
    ),
    source,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);

  const request = new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: payload,
  });

  const form = await request.formData();
  const file = form.get("file");
  expect(file).toBeInstanceOf(File);

  const parsed = new Uint8Array(await (file as File).arrayBuffer());
  expect(Array.from(parsed)).toEqual([0x00, 0x00, 0x00, 0x00]);
  expect(parsed.byteLength).toBe(4);
});

test("multipart formdata preserves single null byte file", async () => {
  const boundary = "----bun-test-boundary";
  const source = Buffer.from([0x00]);
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="null.bin"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      "utf8",
    ),
    source,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);

  const request = new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: payload,
  });

  const form = await request.formData();
  const file = form.get("file");
  expect(file).toBeInstanceOf(File);

  const parsed = new Uint8Array(await (file as File).arrayBuffer());
  expect(Array.from(parsed)).toEqual([0x00]);
  expect(parsed.byteLength).toBe(1);
});

test("multipart formdata preserves 8-byte binary with embedded nulls", async () => {
  const boundary = "----bun-test-boundary";
  // Exactly 8 bytes (max inline length of Semver.String) with nulls interspersed
  const source = Buffer.from([0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00]);
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="mixed.bin"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      "utf8",
    ),
    source,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);

  const request = new Request("http://localhost/", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: payload,
  });

  const form = await request.formData();
  const file = form.get("file");
  expect(file).toBeInstanceOf(File);

  const parsed = new Uint8Array(await (file as File).arrayBuffer());
  expect(Array.from(parsed)).toEqual([0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00]);
  expect(parsed.byteLength).toBe(8);
});
