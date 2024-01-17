// @known-failing-on-windows: 1 failing
import { it, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("offset should work in Bun.file() #4963", async () => {
  const filename = tmpdir() + "/bun.test.offset.txt";
  await Bun.write(filename, "contents");
  const file = Bun.file(filename);
  const slice = file.slice(2, file.size);
  const contents = await slice.text();
  expect(contents).toBe("ntents");
});

it("should be able to parse utf16le json", async () => {
  const path = join(import.meta.dir, "./json-utf16le.json");
  const arrayBuffer = await Bun.file(path).arrayBuffer();
  expect(arrayBuffer.byteLength).toBeGreaterThan(3);
  const uint8Array = new Uint8Array(arrayBuffer);
  expect(uint8Array[0]).toBe(0xff);
  expect(uint8Array[1]).toBe(0xfe);
  const json = await Bun.file(path).json();
  expect(json).toEqual({
    "data": "i am utf16 spooky",
  });
});

it("should be able to parse utf8bom json", async () => {
  const path = join(import.meta.dir, "./json-utf8bom.json");
  const arrayBuffer = await Bun.file(path).arrayBuffer();
  expect(arrayBuffer.byteLength).toBeGreaterThan(3);
  const uint8Array = new Uint8Array(arrayBuffer);
  expect(uint8Array[0]).toBe(0xef);
  expect(uint8Array[1]).toBe(0xbb);
  expect(uint8Array[2]).toBe(0xbf);
  const json = await Bun.file(path).json();
  expect(json).toEqual({
    "data": "i am utf8 spooky",
  });
});
