import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/28012
// Bun.Archive should handle non-ASCII UTF-8 filenames

test("Archive supports non-ASCII UTF-8 filenames", async () => {
  const files: Record<string, string> = {
    "Søreng.json": JSON.stringify({ name: "Søreng" }),
    "café.txt": "hello from café",
    "日本語.json": JSON.stringify({ lang: "ja" }),
    "żółć.txt": "Polish characters",
  };

  const archive = new Bun.Archive(files);
  const bytes = await archive.bytes();
  expect(bytes.byteLength).toBeGreaterThan(0);

  // Round-trip: read back and verify filenames and contents are preserved
  const readBack = new Bun.Archive(bytes);
  const result = await readBack.files();
  expect(result.size).toBe(Object.keys(files).length);
  for (const [name, content] of Object.entries(files)) {
    const entry = result.get(name) as Blob | undefined;
    expect(entry).toBeDefined();
    expect(await entry!.text()).toBe(content);
  }
});
