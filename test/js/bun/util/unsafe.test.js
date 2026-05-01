import { expect, it } from "bun:test";
import { gc } from "harness";

it("arrayBufferToString u8", async () => {
  var encoder = new TextEncoder();
  const bytes = encoder.encode("hello world");
  gc(true);
  expect(Bun.unsafe.arrayBufferToString(bytes)).toBe("hello world");
  gc(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  gc(true);
});

it("arrayBufferToString ArrayBuffer", async () => {
  var encoder = new TextEncoder();
  var bytes = encoder.encode("hello world");
  gc(true);
  const out = Bun.unsafe.arrayBufferToString(bytes.buffer);
  expect(out).toBe("hello world");
  gc(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  globalThis.bytes = bytes;
  gc(true);
  expect(out).toBe("hello world");
});

it("arrayBufferToString u16", () => {
  var encoder = new TextEncoder();
  const bytes = encoder.encode("hello world");
  var uint16 = new Uint16Array(bytes.byteLength);
  uint16.set(bytes);
  const charCodes = Bun.unsafe
    .arrayBufferToString(uint16)
    .split("")
    .map(a => a.charCodeAt(0));
  gc(true);
  for (let i = 0; i < charCodes.length; i++) {
    expect("hello world"[i]).toBe(String.fromCharCode(charCodes[i]));
  }
  gc(true);
  expect(charCodes.length).toBe("hello world".length);
  gc(true);
});

it("Bun.allocUnsafe", () => {
  var buffer = Bun.allocUnsafe(1024);
  expect(buffer instanceof Uint8Array).toBe(true);
  expect(buffer.length).toBe(1024);
  buffer[0] = 0;
  expect(buffer[0]).toBe(0);
});
