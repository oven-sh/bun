import { expect, test } from "bun:test";

// Regression test for https://github.com/oven-sh/bun/issues/26740
// FormData multipart parsing was truncating binary file content at null bytes
// for files 8 bytes or smaller due to Semver.String inline storage optimization.

test("FormData preserves binary data with null bytes in small files", async () => {
  const testCases = [
    { name: "8 bytes with null at position 3", data: [0x01, 0x02, 0x03, 0x00, 0x05, 0x06, 0x07, 0x08] },
    { name: "4 bytes with null at end", data: [0x1f, 0x8b, 0x08, 0x00] },
    { name: "1 byte null", data: [0x00] },
    { name: "all nulls (8 bytes)", data: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] },
    { name: "7 bytes ending with null", data: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x00] },
    { name: "6 bytes starting with null", data: [0x00, 0x02, 0x03, 0x04, 0x05, 0x06] },
  ];

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      const bytes = new Uint8Array(await file.arrayBuffer());
      return Response.json({
        expectedSize: parseInt(req.headers.get("x-expected-size") || "0"),
        actualSize: bytes.byteLength,
        content: Array.from(bytes),
      });
    },
  });

  for (const tc of testCases) {
    const content = new Uint8Array(tc.data);
    const file = new File([content], "test.bin", { type: "application/octet-stream" });
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`http://localhost:${server.port}`, {
      method: "POST",
      body: formData,
      headers: { "x-expected-size": String(tc.data.length) },
    });

    const result = (await res.json()) as { expectedSize: number; actualSize: number; content: number[] };

    expect(result.actualSize).toBe(result.expectedSize);
    expect(result.content).toEqual(tc.data);
  }
});

test("FormData preserves binary data in larger files (> 8 bytes)", async () => {
  // This should have worked before the fix, but let's verify it still works
  const testCases = [
    { name: "16 bytes with nulls", data: Array.from({ length: 16 }, (_, i) => (i % 3 === 0 ? 0x00 : i)) },
    { name: "9 bytes with null at start", data: [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08] },
  ];

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      const bytes = new Uint8Array(await file.arrayBuffer());
      return Response.json({
        expectedSize: parseInt(req.headers.get("x-expected-size") || "0"),
        actualSize: bytes.byteLength,
        content: Array.from(bytes),
      });
    },
  });

  for (const tc of testCases) {
    const content = new Uint8Array(tc.data);
    const file = new File([content], "test.bin", { type: "application/octet-stream" });
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`http://localhost:${server.port}`, {
      method: "POST",
      body: formData,
      headers: { "x-expected-size": String(tc.data.length) },
    });

    const result = (await res.json()) as { expectedSize: number; actualSize: number; content: number[] };

    expect(result.actualSize).toBe(result.expectedSize);
    expect(result.content).toEqual(tc.data);
  }
});
