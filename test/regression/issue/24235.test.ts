import { describe, expect, test } from "bun:test";
import { Buffer, transcode } from "node:buffer";

describe("transcode", () => {
  test("should transcode UTF-8 to ASCII with replacement char", () => {
    const euroBuffer = Buffer.from("€", "utf8");
    const result = transcode(euroBuffer, "utf8", "ascii");
    expect(result.toString("ascii")).toBe("?");
  });

  test("should transcode UTF-8 to Latin1 with replacement char", () => {
    const euroBuffer = Buffer.from("€", "utf8");
    const result = transcode(euroBuffer, "utf8", "latin1");
    expect(result.toString("latin1")).toBe("?");
  });

  test("should transcode ASCII to UTF-8", () => {
    const asciiBuffer = Buffer.from("hello", "ascii");
    const result = transcode(asciiBuffer, "ascii", "utf8");
    expect(result.toString("utf8")).toBe("hello");
  });

  test("should transcode Latin1 to UTF-8", () => {
    const latin1Buffer = Buffer.from([0xc0, 0xe9]); // À é
    const result = transcode(latin1Buffer, "latin1", "utf8");
    expect(result.toString("utf8")).toBe("Àé");
  });

  test("should transcode UTF-8 to UTF-16LE", () => {
    const utf8Buffer = Buffer.from("hello", "utf8");
    const result = transcode(utf8Buffer, "utf8", "utf16le");
    expect(result.toString("utf16le")).toBe("hello");
  });

  test("should transcode UTF-16LE to UTF-8", () => {
    const utf16Buffer = Buffer.from("hello", "utf16le");
    const result = transcode(utf16Buffer, "utf16le", "utf8");
    expect(result.toString("utf8")).toBe("hello");
  });

  test("should transcode UCS2 to UTF-8", () => {
    const ucs2Buffer = Buffer.from("test", "ucs2");
    const result = transcode(ucs2Buffer, "ucs2", "utf8");
    expect(result.toString("utf8")).toBe("test");
  });

  test("should handle empty buffer", () => {
    const emptyBuffer = Buffer.from("", "utf8");
    const result = transcode(emptyBuffer, "utf8", "ascii");
    expect(result.length).toBe(0);
  });

  test("should handle same encoding", () => {
    const buffer = Buffer.from("hello", "utf8");
    const result = transcode(buffer, "utf8", "utf8");
    expect(result.toString("utf8")).toBe("hello");
  });

  test("should throw on invalid source type", () => {
    expect(() => {
      // @ts-expect-error - testing invalid input
      transcode("not a buffer", "utf8", "ascii");
    }).toThrow();
  });

  test("should throw on unsupported encoding", () => {
    const buffer = Buffer.from("test", "utf8");
    expect(() => {
      // @ts-expect-error - testing invalid encoding
      transcode(buffer, "utf8", "unsupported");
    }).toThrow();
  });

  test("should transcode UTF-16LE to ASCII with replacement", () => {
    const utf16Buffer = Buffer.from("hello€", "utf16le");
    const result = transcode(utf16Buffer, "utf16le", "ascii");
    expect(result.toString("ascii")).toBe("hello?");
  });

  test("should transcode Latin1 to UTF-16LE", () => {
    const latin1Buffer = Buffer.from([0xc0, 0xe9]); // À é
    const result = transcode(latin1Buffer, "latin1", "utf16le");
    expect(result.toString("utf16le")).toBe("Àé");
  });

  test("should handle multi-byte UTF-8 characters", () => {
    const utf8Buffer = Buffer.from("你好", "utf8");
    const result = transcode(utf8Buffer, "utf8", "utf16le");
    expect(result.toString("utf16le")).toBe("你好");
  });

  test("should transcode UTF-16LE multi-byte to UTF-8", () => {
    const utf16Buffer = Buffer.from("你好", "utf16le");
    const result = transcode(utf16Buffer, "utf16le", "utf8");
    expect(result.toString("utf8")).toBe("你好");
  });

  test("should transcode ASCII to Latin1", () => {
    const asciiBuffer = Buffer.from("hello", "ascii");
    const result = transcode(asciiBuffer, "ascii", "latin1");
    expect(result.toString("latin1")).toBe("hello");
  });

  test("should transcode Latin1 to ASCII with high byte replacement", () => {
    // 0xC0 is 'À' which is > 0x7F, should become '?'
    const latin1Buffer = Buffer.from([0x68, 0x69, 0xc0], "latin1"); // "hi" + À
    const result = transcode(latin1Buffer, "latin1", "ascii");
    expect(result).toEqual(Buffer.from([0x68, 0x69, 0x3f])); // "hi?"
  });

  test("should enforce 7-bit ASCII limit from UTF-8", () => {
    // © (U+00A9 = 0xA9 in Latin1) should become '?' in ASCII
    const utf8Buffer = Buffer.from("©", "utf8");
    const result = transcode(utf8Buffer, "utf8", "ascii");
    expect(result.toString("ascii")).toBe("?");
  });

  test("should preserve Latin1 characters when transcoding to Latin1", () => {
    // À (0xC0) is valid in Latin1
    const latin1Buffer = Buffer.from([0xc0], "latin1");
    const result = transcode(latin1Buffer, "latin1", "latin1");
    expect(result).toEqual(Buffer.from([0xc0]));
  });
});
