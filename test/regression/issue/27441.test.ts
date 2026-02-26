import { expect, test } from "bun:test";

// Regression test for https://github.com/oven-sh/bun/issues/27441
// req.formData() used bun.Semver.String (u32 length) for file body values,
// which silently truncated files >= 4GB. The fix stores file body values as
// native slices instead.
//
// We can't allocate 4GB+ in CI, but we verify the code path with a meaningful
// payload size to ensure formData parsing preserves the full file body.

test("formData() preserves file size for large uploads", async () => {
  const FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  const payload = Buffer.alloc(FILE_SIZE, 0x42);

  using server = Bun.serve({
    port: 0,
    maxRequestBodySize: FILE_SIZE * 4,
    async fetch(req) {
      const formData = await req.formData();
      const file = formData.get("file") as Blob;
      return Response.json({
        receivedSize: file?.size ?? 0,
      });
    },
  });

  const form = new FormData();
  form.append("file", new Blob([payload]), "test.bin");

  const res = await fetch(server.url, {
    method: "POST",
    body: form,
  });
  const { receivedSize } = (await res.json()) as { receivedSize: number };

  expect(receivedSize).toBe(FILE_SIZE);
});

test("formData() file content is not corrupted", async () => {
  // Verify content integrity, not just size
  const content = "Hello, World! This is a test file for issue #27441.";

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const formData = await req.formData();
      const file = formData.get("file") as Blob;
      const text = await file.text();
      return Response.json({
        receivedSize: file?.size ?? 0,
        content: text,
      });
    },
  });

  const form = new FormData();
  form.append("file", new Blob([content]), "test.txt");

  const res = await fetch(server.url, {
    method: "POST",
    body: form,
  });
  const json = (await res.json()) as { receivedSize: number; content: string };

  expect(json.receivedSize).toBe(content.length);
  expect(json.content).toBe(content);
});

test("formData() handles multiple files with correct sizes", async () => {
  const sizes = [1024, 1024 * 100, 1024 * 1024]; // 1KB, 100KB, 1MB

  using server = Bun.serve({
    port: 0,
    maxRequestBodySize: 1024 * 1024 * 10,
    async fetch(req) {
      const formData = await req.formData();
      const results: number[] = [];
      for (const size of sizes) {
        const file = formData.get(`file_${size}`) as Blob;
        results.push(file?.size ?? 0);
      }
      return Response.json({ receivedSizes: results });
    },
  });

  const form = new FormData();
  for (const size of sizes) {
    form.append(`file_${size}`, new Blob([Buffer.alloc(size, 0x41)]), `test_${size}.bin`);
  }

  const res = await fetch(server.url, {
    method: "POST",
    body: form,
  });
  const { receivedSizes } = (await res.json()) as { receivedSizes: number[] };

  expect(receivedSizes).toEqual(sizes);
});
