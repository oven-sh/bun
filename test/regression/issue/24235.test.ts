import { expect, test } from "bun:test";
import * as buffer from "node:buffer";

test("buffer.transcode is a function, not undefined", () => {
  expect(typeof buffer.transcode).toBe("function");
});

test("buffer.transcode converts UTF-8 to ASCII with ? substitution", () => {
  const newBuf = buffer.transcode(Buffer.from("€"), "utf8", "ascii");
  expect(newBuf.toString("ascii")).toBe("?");
});

test("buffer.transcode converts UTF-8 to Latin-1 with ? substitution", () => {
  const orig = Buffer.from("těst ☕", "utf8");
  const dest = buffer.transcode(orig, "utf8", "latin1");
  // ě (U+011B) fits in latin1 → 0x3F because it's > 0xFF? No.
  // Actually ě is U+011B which is > 0xFF, so it becomes '?' (0x3F)
  // ☕ is U+2615, also > 0xFF, so '?' (0x3F)
  expect(Array.from(dest)).toEqual([0x74, 0x3f, 0x73, 0x74, 0x20, 0x3f]);
});

test("buffer.transcode converts UTF-8 to UCS-2", () => {
  const orig = Buffer.from("těst ☕", "utf8");
  const dest = buffer.transcode(orig, "utf8", "ucs2");
  expect(Array.from(dest)).toEqual([0x74, 0x00, 0x1b, 0x01, 0x73, 0x00, 0x74, 0x00, 0x20, 0x00, 0x15, 0x26]);
});

test("buffer.transcode round-trips UCS-2 to UTF-8", () => {
  const orig = Buffer.from("těst ☕", "utf8");
  const ucs2 = buffer.transcode(orig, "utf8", "ucs2");
  const back = buffer.transcode(Buffer.from(ucs2), "ucs2", "utf8");
  expect(back.toString()).toBe(orig.toString());
});

test("buffer.transcode handles large data", () => {
  const utf8 = Buffer.from("€".repeat(4000), "utf8");
  const ucs2 = Buffer.from("€".repeat(4000), "ucs2");
  const utf8_to_ucs2 = buffer.transcode(utf8, "utf8", "ucs2");
  const ucs2_to_utf8 = buffer.transcode(ucs2, "ucs2", "utf8");
  expect(Buffer.compare(utf8, ucs2_to_utf8)).toBe(0);
  expect(Buffer.compare(ucs2, utf8_to_ucs2)).toBe(0);
});

test("buffer.transcode throws on invalid source type", () => {
  expect(() => buffer.transcode(null as any, "utf8", "ascii")).toThrow();
});

test("buffer.transcode throws on unsupported encoding", () => {
  expect(() => buffer.transcode(Buffer.from("a"), "b" as any, "utf8")).toThrow(/U_ILLEGAL_ARGUMENT_ERROR/);
  expect(() => buffer.transcode(Buffer.from("a"), "uf8" as any, "b" as any)).toThrow(/U_ILLEGAL_ARGUMENT_ERROR/);
});

test("buffer.transcode ASCII/Latin-1 to UTF-16LE", () => {
  expect(buffer.transcode(Buffer.from("hi", "ascii"), "ascii", "utf16le")).toEqual(Buffer.from("hi", "utf16le"));
  expect(buffer.transcode(Buffer.from("hi", "latin1"), "latin1", "utf16le")).toEqual(Buffer.from("hi", "utf16le"));
  expect(buffer.transcode(Buffer.from("hä", "latin1"), "latin1", "utf16le")).toEqual(Buffer.from("hä", "utf16le"));
});

test("buffer.transcode accepts Uint8Array", () => {
  const uint8array = new Uint8Array([...Buffer.from("hä", "latin1")]);
  expect(buffer.transcode(uint8array, "latin1", "utf16le")).toEqual(Buffer.from("hä", "utf16le"));
});

test("buffer.transcode empty input", () => {
  const dest = buffer.transcode(new Uint8Array(), "utf8", "latin1");
  expect(dest.length).toBe(0);
});

test("buffer.transcode doesn't crash with allocUnsafeSlow", () => {
  buffer.transcode(new buffer.Buffer.allocUnsafeSlow(1) as any, "utf16le", "ucs2");
});
