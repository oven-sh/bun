test("this file is utf8 with bom", async () => {
  const arrayBuffer = await Bun.file(import.meta.path).arrayBuffer();
  expect(arrayBuffer.byteLength).toBeGreaterThan(3);
  const uint8Array = new Uint8Array(arrayBuffer);
  expect(uint8Array[0]).toBe(0xef);
  expect(uint8Array[1]).toBe(0xbb);
  expect(uint8Array[2]).toBe(0xbf);
  const text = await Bun.file(import.meta.path).text();
  expect(text).toInclude("this text right here");
});
