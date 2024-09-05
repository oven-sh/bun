import { Buffer, SlowBuffer, isAscii, isUtf8, kMaxLength } from "buffer";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { gc } from "harness";

const BufferModule = await import("buffer");

beforeEach(() => gc());
afterEach(() => gc());

/***
 *
 * So, Node.js doesn't have tests for utf8Write, asciiWrite, latin1Write, base64Write, base64urlWrite, ucs2Write, utf16leWrite, utf16beWrite, etc.
 *
 * But, our implementation is slightly different for the *write functions versus the write() function itself.
 *
 * Our workaround for that here is to run all the Buffer.prototype.write() tests twice.
 * 1. First we run them with native Buffer.write
 * 2. Then we run them with Node.js' implementation of Buffer.write, calling out to Bun's implementation of utf8Write, asciiWrite, latin1Write, base64Write, base64urlWrite, ucs2Write, utf16leWrite, utf16beWrite, etc.
 *
 *
 */
const NumberIsInteger = Number.isInteger;
class ERR_INVALID_ARG_TYPE extends TypeError {
  constructor() {
    super("Invalid arg type" + Array.prototype.join.call(arguments, " "));
    this.code = "ERR_INVALID_ARG_TYPE";
  }
}
class ERR_OUT_OF_RANGE extends RangeError {
  constructor() {
    super(Array.prototype.join.call(arguments, ""));
    this.code = "ERR_OUT_OF_RANGE";
  }
}

class ERR_UNKNOWN_ENCODING extends TypeError {
  constructor() {
    super(Array.prototype.join.call(arguments, ""));
    this.message = `Unknown encoding: ${arguments[0]}`;
    this.code = "ERR_UNKNOWN_ENCODING";
  }
}

function getEncodingOps(encoding) {
  encoding = encoding.toLowerCase();
  switch (encoding) {
    case "utf-8":
    case "utf8":
      return {
        write: Buffer.prototype.utf8Write,
      };
    case "ascii":
      return {
        write: Buffer.prototype.asciiWrite,
      };
    case "binary":
    case "latin1":
      return {
        write: Buffer.prototype.latin1Write,
      };

    case "base64":
      return {
        write: Buffer.prototype.base64Write,
      };
    case "base64url":
      return {
        write: Buffer.prototype.base64urlWrite,
      };

    case "ucs2":
    case "ucs-2":
    case "utf16le":
      return {
        write: Buffer.prototype.ucs2Write,
      };

    case "utf-16le":
    case "utf16le":
      return {
        write: Buffer.prototype.utf16leWrite,
      };

    case "utf-16be":
    case "utf16be":
      return {
        write: Buffer.prototype.utf16beWrite,
      };
    case "hex":
      return {
        write: Buffer.prototype.hexWrite,
      };
    default:
      return undefined;
  }
}

const validateInteger = (value, name, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) => {
  if (typeof value !== "number") throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  if (!NumberIsInteger(value)) throw new ERR_OUT_OF_RANGE(name, "an integer", value);
  if (value < min || value > max) throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
};
const validateOffset = (value, name, min = 0, max = kMaxLength) => validateInteger(value, name, min, max);
function nodeJSBufferWriteFn(string, offset, length, encoding = "utf8") {
  // Buffer#write(string);
  if (offset === undefined) {
    return this.utf8Write(string, 0, this.length);
  }
  // Buffer#write(string, encoding)
  if (length === undefined && typeof offset === "string") {
    encoding = offset;
    length = this.length;
    offset = 0;

    // Buffer#write(string, offset[, length][, encoding])
  } else {
    validateOffset(offset, "offset", 0, this.length);

    const remaining = this.length - offset;

    if (length === undefined) {
      length = remaining;
    } else if (typeof length === "string") {
      encoding = length;
      length = remaining;
    } else {
      validateOffset(length, "length", 0, this.length);
      if (length > remaining) length = remaining;
    }
  }

  if (!encoding) return this.utf8Write(string, offset, length);

  const ops = getEncodingOps(encoding);
  if (ops === undefined) throw new ERR_UNKNOWN_ENCODING(encoding);
  return ops.write.call(this, string, offset, length);
}
/**  */
const nativeBufferWrite = Buffer.prototype.write;
for (let withOverridenBufferWrite of [false, true]) {
  describe(
    withOverridenBufferWrite
      ? "with Buffer.write that calls into .utf8Write, .asciiWrite, etc"
      : "with native Buffer.write",
    () => {
      if (withOverridenBufferWrite) {
        beforeEach(() => {
          Buffer.prototype.write = nodeJSBufferWriteFn;
        });
        afterEach(() => {
          Buffer.prototype.write = nativeBufferWrite;
        });
      }
      it("#9120 fill", () => {
        let abBuf = Buffer.alloc(2, "ab");
        let x = Buffer.alloc(1);
        x.fill(abBuf);
        expect(x.toString()).toBe("a");

        for (let count = 2; count < 10; count += 2) {
          const full = Buffer.from("a".repeat(count) + "b".repeat(count));
          const x = Buffer.alloc(count);
          x.fill(full);
          expect(x.toString()).toBe("a".repeat(count));
        }
      });

      it("#9120 alloc", () => {
        let abBuf = Buffer.alloc(2, "ab");
        let x = Buffer.alloc(1, abBuf);
        expect(x.toString()).toBe("a");

        for (let count = 2; count < 10; count += 2) {
          const full = Buffer.from("a".repeat(count) + "b".repeat(count));
          const x = Buffer.alloc(count, full);
          expect(x.toString()).toBe("a".repeat(count));
        }
      });

      it("isAscii", () => {
        expect(isAscii(new Buffer("abc"))).toBeTrue();
        expect(isAscii(new Buffer(""))).toBeTrue();
        expect(isAscii(new Buffer([32, 32, 128]))).toBeFalse();
        expect(isAscii(new Buffer("What did the 🦊 say?"))).toBeFalse();
        expect(isAscii(new Buffer("").buffer)).toBeTrue();
        expect(isAscii(new Buffer([32, 32, 128]).buffer)).toBeFalse();
      });

      it("isUtf8", () => {
        expect(isUtf8(new Buffer("abc"))).toBeTrue();
        expect(isAscii(new Buffer(""))).toBeTrue();
        expect(isUtf8(new Buffer("What did the 🦊 say?"))).toBeTrue();
        expect(isUtf8(new Buffer([129, 129, 129]))).toBeFalse();

        expect(isUtf8(new Buffer("abc").buffer)).toBeTrue();
        expect(isAscii(new Buffer("").buffer)).toBeTrue();
        expect(isUtf8(new Buffer("What did the 🦊 say?").buffer)).toBeTrue();
        expect(isUtf8(new Buffer([129, 129, 129]).buffer)).toBeFalse();
      });

      // https://github.com/oven-sh/bun/issues/2052
      it("Buffer global is settable", () => {
        var prevBuffer = globalThis.Buffer;
        globalThis.Buffer = 42;
        expect(globalThis.Buffer).toBe(42);
        globalThis.Buffer = prevBuffer;
        expect(globalThis.Buffer).toBe(BufferModule.Buffer);
        expect(globalThis.Buffer).toBe(prevBuffer);
      });

      it("length overflow", () => {
        // Verify the maximum Uint8Array size. There is no concrete limit by spec. The
        // internal limits should be updated if this fails.
        expect(() => new Uint8Array(2 ** 32 + 1)).toThrow(/length/);
      });

      it("truncate input values", () => {
        const b = Buffer.allocUnsafe(1024);
        expect(b.length).toBe(1024);

        b[0] = -1;
        expect(b[0]).toBe(255);

        for (let i = 0; i < 1024; i++) {
          b[i] = i;
        }

        for (let i = 0; i < 1024; i++) {
          expect(i % 256).toBe(b[i]);
        }
      });

      it("Buffer.allocUnsafe()", () => {
        const c = Buffer.allocUnsafe(512);
        expect(c.length).toBe(512);
      });

      it("Buffer.from()", () => {
        const d = Buffer.from([]);
        expect(d.length).toBe(0);
      });

      it("offset properties", () => {
        const b = Buffer.alloc(128);
        expect(b.length).toBe(128);
        expect(b.byteOffset).toBe(0);
        expect(b.offset).toBe(0);
      });

      it("creating a Buffer from a Uint32Array", () => {
        const ui32 = new Uint32Array(4).fill(42);
        const e = Buffer.from(ui32);
        for (const [index, value] of e.entries()) {
          expect(value).toBe(ui32[index]);
        }
      });

      it("creating a Buffer from a Uint32Array (old constructor)", () => {
        const ui32 = new Uint32Array(4).fill(42);
        const e = Buffer(ui32);
        for (const [key, value] of e.entries()) {
          expect(value).toBe(ui32[key]);
        }
      });

      it("invalid encoding", () => {
        const b = Buffer.allocUnsafe(64);
        // Test invalid encoding for Buffer.toString
        expect(() => b.toString("invalid")).toThrow(/encoding/);
        // Invalid encoding for Buffer.write
        expect(() => b.write("test string", 0, 5, "invalid")).toThrow(/encoding/);
        // Unsupported arguments for Buffer.write
        expect(() => b.write("test", "utf8", 0)).toThrow(/invalid/i);
      });

      it("create 0-length buffers", () => {
        Buffer.from("");
        Buffer.from("", "ascii");
        Buffer.from("", "latin1");
        Buffer.alloc(0);
        Buffer.allocUnsafe(0);
        new Buffer("");
        new Buffer("", "ascii");
        new Buffer("", "latin1");
        new Buffer("", "binary");
        Buffer(0);
      });

      it("write() beyond end of buffer", () => {
        const b = Buffer.allocUnsafe(64);
        // Try to write a 0-length string beyond the end of b
        expect(() => b.write("", 2048)).toThrow(RangeError);
        // Throw when writing to negative offset
        expect(() => b.write("a", -1)).toThrow(RangeError);
        // Throw when writing past bounds from the pool
        expect(() => b.write("a", 2048)).toThrow(RangeError);
        // Throw when writing to negative offset
        expect(() => b.write("a", -1)).toThrow(RangeError);
        // Offset points to the end of the buffer and does not throw.
        // (see https://github.com/nodejs/node/issues/8127).
        Buffer.alloc(1).write("", 1, 0);
      });

      it("copy() beyond end of buffer", () => {
        const b = Buffer.allocUnsafe(64);
        // Try to copy 0 bytes worth of data into an empty buffer
        b.copy(Buffer.alloc(0), 0, 0, 0);
        // Try to copy 0 bytes past the end of the target buffer
        b.copy(Buffer.alloc(0), 1, 1, 1);
        b.copy(Buffer.alloc(1), 1, 1, 1);
        // Try to copy 0 bytes from past the end of the source buffer
        b.copy(Buffer.alloc(1), 0, 2048, 2048);
      });

      it("smart defaults and ability to pass string values as offset", () => {
        const writeTest = Buffer.from("abcdes");
        writeTest.write("n", "ascii");
        expect(() => writeTest.write("o", "1", "ascii")).toThrow(/offset/);
        writeTest.write("o", 1, "ascii");
        writeTest.write("d", 2, "ascii");
        writeTest.write("e", 3, "ascii");
        writeTest.write("j", 4, "ascii");
        expect(writeTest.toString()).toBe("nodejs");
      });

      it("ASCII slice", () => {
        const buf = Buffer.allocUnsafe(256);
        const str = "hello world";
        for (let i = 0; i < str.length; i++) {
          buf[i] = str.charCodeAt(i);
        }
        expect(buf.toString("ascii", 0, str.length)).toBe(str);

        const offset = 100;
        expect(buf.write(str, offset, "ascii")).toBe(str.length);
        expect(buf.toString("ascii", offset, offset + str.length)).toBe(str);

        const slice1 = buf.slice(offset, offset + str.length);
        const slice2 = buf.slice(offset, offset + str.length);
        for (let i = 0; i < str.length; i++) {
          expect(slice1[i]).toBe(slice2[i]);
        }
      });

      it("UTF-8 slice", () => {
        const b = Buffer.allocUnsafe(256);
        const utf8String = "¡hέlló wôrld!";
        const offset = 100;

        b.write(utf8String, 0, Buffer.byteLength(utf8String), "utf8");
        expect(b.toString("utf8", 0, Buffer.byteLength(utf8String))).toBe(utf8String);

        expect(b.write(utf8String, offset, "utf8")).toBe(Buffer.byteLength(utf8String));
        expect(b.toString("utf8", offset, offset + Buffer.byteLength(utf8String))).toBe(utf8String);

        const sliceA = b.slice(offset, offset + Buffer.byteLength(utf8String));
        const sliceB = b.slice(offset, offset + Buffer.byteLength(utf8String));
        for (let i = 0; i < Buffer.byteLength(utf8String); i++) {
          expect(sliceA[i]).toBe(sliceB[i]);
        }

        const slice = b.slice(100, 150);
        expect(slice.length).toBe(50);
        for (let i = 0; i < 50; i++) {
          expect(b[100 + i]).toBe(slice[i]);
        }
      });

      it("only top level parent propagates from allocPool", () => {
        const b = Buffer.allocUnsafe(5);
        const c = b.slice(0, 4);
        const d = c.slice(0, 2);
        expect(b.parent).toBe(c.parent);
        expect(b.parent).toBe(d.parent);
      });

      it("only top level parent propagates from a non-pooled instance", () => {
        const b = Buffer.allocUnsafeSlow(5);
        const c = b.slice(0, 4);
        const d = c.slice(0, 2);
        expect(c.parent).toBe(d.parent);
      });

      it("UTF-8 write() & slice()", () => {
        {
          const testValue = "\u00F6\u65E5\u672C\u8A9E"; // ö日本語
          const buffer = Buffer.allocUnsafe(32);
          const size = buffer.write(testValue, 0, "utf8");
          const slice = buffer.toString("utf8", 0, size);
          expect(slice).toBe(testValue);
        }
        {
          const buffer = Buffer.allocUnsafe(1);
          buffer.write("\x61");
          buffer.write("\xFF");
          expect(buffer).toStrictEqual(Buffer.from([0x61]));
        }
        {
          const buffer = Buffer.alloc(5);
          buffer.write("\x61\xFF\x62\xFF\x63", "utf8");
          expect(buffer).toStrictEqual(Buffer.from([0x61, 0xc3, 0xbf, 0x62, 0x00]));
        }
        {
          const buffer = Buffer.alloc(5);
          buffer.write("\xFF\x61\xFF\x62\xFF", "utf8");
          expect(buffer).toStrictEqual(Buffer.from([0xc3, 0xbf, 0x61, 0xc3, 0xbf]));
        }
      });

      it("triple slice", () => {
        const a = Buffer.allocUnsafe(8);
        for (let i = 0; i < 8; i++) a[i] = i;
        const b = a.slice(4, 8);
        expect(b[0]).toBe(4);
        expect(b[1]).toBe(5);
        expect(b[2]).toBe(6);
        expect(b[3]).toBe(7);
        const c = b.slice(2, 4);
        expect(c[0]).toBe(6);
        expect(c[1]).toBe(7);
      });

      it("Buffer.from() with encoding", () => {
        const b = Buffer.from([23, 42, 255]);
        expect(b.length).toBe(3);
        expect(b[0]).toBe(23);
        expect(b[1]).toBe(42);
        expect(b[2]).toBe(255);
        expect(Buffer.from(b)).toStrictEqual(b);

        // Test for proper UTF-8 Encoding
        expect(Buffer.from("über")).toStrictEqual(Buffer.from([195, 188, 98, 101, 114]));

        // Test for proper ascii Encoding, length should be 4
        expect(Buffer.from("über", "ascii")).toStrictEqual(Buffer.from([252, 98, 101, 114]));

        ["ucs2", "ucs-2", "utf16le", "utf-16le"].forEach(encoding => {
          // Test for proper UTF16LE encoding, length should be 8
          expect(Buffer.from("über", encoding)).toStrictEqual(Buffer.from([252, 0, 98, 0, 101, 0, 114, 0]));

          // Length should be 12
          const b = Buffer.from("привет", encoding);
          expect(b).toStrictEqual(Buffer.from([63, 4, 64, 4, 56, 4, 50, 4, 53, 4, 66, 4]));
          expect(b.toString(encoding)).toBe("привет");

          const c = Buffer.from([0, 0, 0, 0, 0]);
          expect(c.length).toBe(5);
          expect(c.write("あいうえお", encoding)).toBe(4);
          expect(c).toStrictEqual(Buffer.from([0x42, 0x30, 0x44, 0x30, 0x00]));
        });

        const c = Buffer.from("\uD83D\uDC4D", "utf-16le"); // THUMBS UP SIGN (U+1F44D)
        expect(c.length).toBe(4);
        expect(c).toStrictEqual(Buffer.from("3DD84DDC", "hex"));
      });

      it("construction from arrayish object", () => {
        const arrayIsh = { 0: 0, 1: 1, 2: 2, 3: 3, length: 4 };
        expect(Buffer.from(arrayIsh)).toStrictEqual(Buffer.from([0, 1, 2, 3]));
        const strArrayIsh = { 0: "0", 1: "1", 2: "2", 3: "3", length: 4 };
        expect(Buffer.from(strArrayIsh)).toStrictEqual(Buffer.from([0, 1, 2, 3]));
      });

      it("toString('base64')", () => {
        expect(Buffer.from("Man").toString("base64")).toBe("TWFu");
        expect(Buffer.from("Woman").toString("base64")).toBe("V29tYW4=");
      });

      it("toString('base64url')", () => {
        expect(Buffer.from("Man").toString("base64url")).toBe("TWFu");
        expect(Buffer.from("Woman").toString("base64url")).toBe("V29tYW4");
      });

      it("regular and URL-safe base64 work both ways", () => {
        const expected = [0xff, 0xff, 0xbe, 0xff, 0xef, 0xbf, 0xfb, 0xef, 0xff];
        expect(Buffer.from("//++/++/++//", "base64")).toStrictEqual(Buffer.from(expected));
        expect(Buffer.from("__--_--_--__", "base64")).toStrictEqual(Buffer.from(expected));
        expect(Buffer.from("//++/++/++//", "base64url")).toStrictEqual(Buffer.from(expected));
        expect(Buffer.from("__--_--_--__", "base64url")).toStrictEqual(Buffer.from(expected));
      });

      it("regular and URL-safe base64 work both ways with padding", () => {
        const expected = [0xff, 0xff, 0xbe, 0xff, 0xef, 0xbf, 0xfb, 0xef, 0xff, 0xfb];
        expect(Buffer.from("//++/++/++//+w==", "base64")).toStrictEqual(Buffer.from(expected));
        expect(Buffer.from("//++/++/++//+w==", "base64")).toStrictEqual(Buffer.from(expected));
        expect(Buffer.from("//++/++/++//+w==", "base64url")).toStrictEqual(Buffer.from(expected));
        expect(Buffer.from("//++/++/++//+w==", "base64url")).toStrictEqual(Buffer.from(expected));
      });

      it("big example (base64 & base64url)", () => {
        const quote =
          "Man is distinguished, not only by his reason, but by this " +
          "singular passion from other animals, which is a lust " +
          "of the mind, that by a perseverance of delight in the " +
          "continued and indefatigable generation of knowledge, " +
          "exceeds the short vehemence of any carnal pleasure.";
        const expected =
          "TWFuIGlzIGRpc3Rpbmd1aXNoZWQsIG5vdCBvbmx5IGJ5IGhpcyByZWFzb" +
          "24sIGJ1dCBieSB0aGlzIHNpbmd1bGFyIHBhc3Npb24gZnJvbSBvdGhlci" +
          "BhbmltYWxzLCB3aGljaCBpcyBhIGx1c3Qgb2YgdGhlIG1pbmQsIHRoYXQ" +
          "gYnkgYSBwZXJzZXZlcmFuY2Ugb2YgZGVsaWdodCBpbiB0aGUgY29udGlu" +
          "dWVkIGFuZCBpbmRlZmF0aWdhYmxlIGdlbmVyYXRpb24gb2Yga25vd2xlZ" +
          "GdlLCBleGNlZWRzIHRoZSBzaG9ydCB2ZWhlbWVuY2Ugb2YgYW55IGNhcm" +
          "5hbCBwbGVhc3VyZS4=";

        expect(Buffer.from(quote).toString("base64")).toBe(expected);
        expect(Buffer.from(quote).toString("base64url")).toBe(
          expected.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""),
        );
      });

      function forEachBase64(label, test) {
        ["base64", "base64url"].forEach(encoding => it(`${label} (${encoding})`, test.bind(null, encoding)));
      }

      forEachBase64("big example", encoding => {
        const quote =
          "Man is distinguished, not only by his reason, but by this " +
          "singular passion from other animals, which is a lust " +
          "of the mind, that by a perseverance of delight in the " +
          "continued and indefatigable generation of knowledge, " +
          "exceeds the short vehemence of any carnal pleasure.";
        const expected =
          "TWFuIGlzIGRpc3Rpbmd1aXNoZWQsIG5vdCBvbmx5IGJ5IGhpcyByZWFzb" +
          "24sIGJ1dCBieSB0aGlzIHNpbmd1bGFyIHBhc3Npb24gZnJvbSBvdGhlci" +
          "BhbmltYWxzLCB3aGljaCBpcyBhIGx1c3Qgb2YgdGhlIG1pbmQsIHRoYXQ" +
          "gYnkgYSBwZXJzZXZlcmFuY2Ugb2YgZGVsaWdodCBpbiB0aGUgY29udGlu" +
          "dWVkIGFuZCBpbmRlZmF0aWdhYmxlIGdlbmVyYXRpb24gb2Yga25vd2xlZ" +
          "GdlLCBleGNlZWRzIHRoZSBzaG9ydCB2ZWhlbWVuY2Ugb2YgYW55IGNhcm" +
          "5hbCBwbGVhc3VyZS4=";

        const b = Buffer.allocUnsafe(1024);
        expect(b.write(expected, 0, encoding)).toBe(quote.length);
        expect(b.toString("ascii", 0, quote.length)).toBe(quote);

        // Check that the base64 decoder ignores whitespace
        const white =
          `${expected.slice(0, 60)} \n` +
          `${expected.slice(60, 120)} \n` +
          `${expected.slice(120, 180)} \n` +
          `${expected.slice(180, 240)} \n` +
          `${expected.slice(240, 300)}\n` +
          `${expected.slice(300, 360)}\n`;
        const c = Buffer.allocUnsafe(1024);
        expect(c.write(white, 0, encoding)).toBe(quote.length);
        expect(c.toString("ascii", 0, quote.length)).toBe(quote);

        // Check that the base64 decoder on the constructor works
        // even in the presence of whitespace.
        const d = Buffer.from(white, encoding);
        expect(d.length).toBe(quote.length);
        expect(d.toString("ascii", 0, quote.length)).toBe(quote);

        // Check that the base64 decoder ignores illegal chars
        const illegal =
          expected.slice(0, 60) +
          " \x80" +
          expected.slice(60, 120) +
          " \xff" +
          expected.slice(120, 180) +
          " \x00" +
          expected.slice(180, 240) +
          " \x98" +
          expected.slice(240, 300) +
          "\x03" +
          expected.slice(300, 360);
        const e = Buffer.from(illegal, encoding);
        expect(e.length).toBe(quote.length);
        expect(e.toString("ascii", 0, quote.length)).toBe(quote);
      });

      forEachBase64("padding", encoding => {
        expect(Buffer.from("", encoding).toString()).toBe("");
        expect(Buffer.from("K", encoding).toString()).toBe("");
        // multiple-of-4 with padding
        expect(Buffer.from("Kg==", encoding).toString()).toBe("*");
        expect(Buffer.from("Kio=", encoding).toString()).toBe("*".repeat(2));
        expect(Buffer.from("Kioq", encoding).toString()).toBe("*".repeat(3));
        expect(Buffer.from("KioqKg==", encoding).toString()).toBe("*".repeat(4));
        expect(Buffer.from("KioqKio=", encoding).toString()).toBe("*".repeat(5));
        expect(Buffer.from("KioqKioq", encoding).toString()).toBe("*".repeat(6));
        expect(Buffer.from("KioqKioqKg==", encoding).toString()).toBe("*".repeat(7));
        expect(Buffer.from("KioqKioqKio=", encoding).toString()).toBe("*".repeat(8));
        expect(Buffer.from("KioqKioqKioq", encoding).toString()).toBe("*".repeat(9));
        expect(Buffer.from("KioqKioqKioqKg==", encoding).toString()).toBe("*".repeat(10));
        expect(Buffer.from("KioqKioqKioqKio=", encoding).toString()).toBe("*".repeat(11));
        expect(Buffer.from("KioqKioqKioqKioq", encoding).toString()).toBe("*".repeat(12));
        expect(Buffer.from("KioqKioqKioqKioqKg==", encoding).toString()).toBe("*".repeat(13));
        expect(Buffer.from("KioqKioqKioqKioqKio=", encoding).toString()).toBe("*".repeat(14));
        expect(Buffer.from("KioqKioqKioqKioqKioq", encoding).toString()).toBe("*".repeat(15));
        expect(Buffer.from("KioqKioqKioqKioqKioqKg==", encoding).toString()).toBe("*".repeat(16));
        expect(Buffer.from("KioqKioqKioqKioqKioqKio=", encoding).toString()).toBe("*".repeat(17));
        expect(Buffer.from("KioqKioqKioqKioqKioqKioq", encoding).toString()).toBe("*".repeat(18));
        expect(Buffer.from("KioqKioqKioqKioqKioqKioqKg==", encoding).toString()).toBe("*".repeat(19));
        expect(Buffer.from("KioqKioqKioqKioqKioqKioqKio=", encoding).toString()).toBe("*".repeat(20));
        // No padding, not a multiple of 4
        expect(Buffer.from("Kg", encoding).toString()).toBe("*");
        expect(Buffer.from("Kio", encoding).toString()).toBe("*".repeat(2));
        expect(Buffer.from("KioqKg", encoding).toString()).toBe("*".repeat(4));
        expect(Buffer.from("KioqKio", encoding).toString()).toBe("*".repeat(5));
        expect(Buffer.from("KioqKioqKg", encoding).toString()).toBe("*".repeat(7));
        expect(Buffer.from("KioqKioqKio", encoding).toString()).toBe("*".repeat(8));
        expect(Buffer.from("KioqKioqKioqKg", encoding).toString()).toBe("*".repeat(10));
        expect(Buffer.from("KioqKioqKioqKio", encoding).toString()).toBe("*".repeat(11));
        expect(Buffer.from("KioqKioqKioqKioqKg", encoding).toString()).toBe("*".repeat(13));
        expect(Buffer.from("KioqKioqKioqKioqKio", encoding).toString()).toBe("*".repeat(14));
        expect(Buffer.from("KioqKioqKioqKioqKioqKg", encoding).toString()).toBe("*".repeat(16));
        expect(Buffer.from("KioqKioqKioqKioqKioqKio", encoding).toString()).toBe("*".repeat(17));
        expect(Buffer.from("KioqKioqKioqKioqKioqKioqKg", encoding).toString()).toBe("*".repeat(19));
        expect(Buffer.from("KioqKioqKioqKioqKioqKioqKio", encoding).toString()).toBe("*".repeat(20));
        // Handle padding graciously, multiple-of-4 or not
        expect(Buffer.from("72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw==", encoding).length).toBe(32);
        expect(Buffer.from("72INjkR5fchcxk9-VgdGPFJDxUBFR5_rMFsghgxADiw==", encoding).length).toBe(32);
        expect(Buffer.from("72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw=", encoding).length).toBe(32);
        expect(Buffer.from("72INjkR5fchcxk9-VgdGPFJDxUBFR5_rMFsghgxADiw=", encoding).length).toBe(32);
        expect(Buffer.from("72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw", encoding).length).toBe(32);
        expect(Buffer.from("72INjkR5fchcxk9-VgdGPFJDxUBFR5_rMFsghgxADiw", encoding).length).toBe(32);
        expect(Buffer.from("w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg==", encoding).length).toBe(31);
        expect(Buffer.from("w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg=", encoding).length).toBe(31);
        expect(Buffer.from("w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg", encoding).length).toBe(31);
      });

      it("encodes single '.' character in UTF-16", () => {
        const padded = Buffer.from("//4uAA==", "base64");
        expect(padded[0]).toBe(0xff);
        expect(padded[1]).toBe(0xfe);
        expect(padded[2]).toBe(0x2e);
        expect(padded[3]).toBe(0x00);
        expect(padded.toString("base64")).toBe("//4uAA==");

        const dot = Buffer.from("//4uAA", "base64url");
        expect(dot[0]).toBe(0xff);
        expect(dot[1]).toBe(0xfe);
        expect(dot[2]).toBe(0x2e);
        expect(dot[3]).toBe(0x00);
        expect(dot.toString("base64url")).toBe("__4uAA");
      });

      // https://github.com/joyent/node/issues/402
      it("writing base64 at a position > 0 should not mangle the result", () => {
        const segments = ["TWFkbmVzcz8h", "IFRoaXM=", "IGlz", "IG5vZGUuanMh"];
        const b = Buffer.allocUnsafe(64);
        let pos = 0;

        for (let i = 0; i < segments.length; ++i) {
          pos += b.write(segments[i], pos, "base64");
        }
        expect(b.toString("latin1", 0, pos)).toBe("Madness?! This is node.js!");
      });

      // https://github.com/joyent/node/issues/402
      it("writing base64url at a position > 0 should not mangle the result", () => {
        const segments = ["TWFkbmVzcz8h", "IFRoaXM", "IGlz", "IG5vZGUuanMh"];
        const b = Buffer.allocUnsafe(64);
        let pos = 0;

        for (let i = 0; i < segments.length; ++i) {
          pos += b.write(segments[i], pos, "base64url");
        }
        expect(b.toString("latin1", 0, pos)).toBe("Madness?! This is node.js!");
      });

      it("regression tests from Node.js", () => {
        // Regression test for https://github.com/nodejs/node/issues/3496.
        expect(Buffer.from("=bad".repeat(1e4), "base64").length).toBe(0);
        // Regression test for https://github.com/nodejs/node/issues/11987.
        expect(Buffer.from("w0  ", "base64")).toStrictEqual(Buffer.from("w0", "base64"));
        // Regression test for https://github.com/nodejs/node/issues/13657.
        expect(Buffer.from(" YWJvcnVtLg", "base64")).toStrictEqual(Buffer.from("YWJvcnVtLg", "base64"));
        // issue GH-3416
        Buffer.from(Buffer.allocUnsafe(0), 0, 0);
        // Regression test for https://github.com/nodejs/node-v0.x-archive/issues/5482:
        // should throw but not assert in C++ land.
        expect(() => Buffer.from("", "buffer")).toThrow(/encoding/);
      });

      it("creating buffers larger than pool size", () => {
        const l = Buffer.poolSize + 5;
        const s = "h".repeat(l);
        const b = Buffer.from(s);

        for (let i = 0; i < l; i++) {
          expect(b[i]).toBe("h".charCodeAt(0));
        }

        const sb = b.toString();
        expect(sb.length).toBe(s.length);
        expect(sb).toBe(s);
      });

      it("should use args correctly", () => {
        const buf1 = Buffer.allocUnsafe(26);

        for (let i = 0; i < 26; i++) {
          // 97 is the decimal ASCII value for 'a'.
          buf1[i] = i + 97;
        }

        expect(buf1.toString("utf8")).toBe("abcdefghijklmnopqrstuvwxyz");
        expect(buf1.toString("utf8", 0, 5)).toBe("abcde");

        const buf2 = Buffer.from("tést");
        expect(buf2.toString("hex")).toBe("74c3a97374");
        expect(buf2.toString("utf8", 0, 3)).toBe("té");
        expect(buf2.toString(undefined, 0, 3)).toBe("té");
      });

      it("hex toString()", () => {
        const hexb = Buffer.allocUnsafe(256);
        for (let i = 0; i < 256; i++) {
          hexb[i] = i;
        }
        const hexStr = hexb.toString("hex");
        expect(hexStr).toBe(
          "000102030405060708090a0b0c0d0e0f" +
            "101112131415161718191a1b1c1d1e1f" +
            "202122232425262728292a2b2c2d2e2f" +
            "303132333435363738393a3b3c3d3e3f" +
            "404142434445464748494a4b4c4d4e4f" +
            "505152535455565758595a5b5c5d5e5f" +
            "606162636465666768696a6b6c6d6e6f" +
            "707172737475767778797a7b7c7d7e7f" +
            "808182838485868788898a8b8c8d8e8f" +
            "909192939495969798999a9b9c9d9e9f" +
            "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf" +
            "b0b1b2b3b4b5b6b7b8b9babbbcbdbebf" +
            "c0c1c2c3c4c5c6c7c8c9cacbcccdcecf" +
            "d0d1d2d3d4d5d6d7d8d9dadbdcdddedf" +
            "e0e1e2e3e4e5e6e7e8e9eaebecedeeef" +
            "f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
        );

        const hexb2 = Buffer.from(hexStr, "hex");
        for (let i = 0; i < 256; i++) {
          expect(hexb2[i]).toBe(hexb[i]);
        }
      });

      it("single hex character is discarded", () => {
        expect(Buffer.from("A", "hex").length).toBe(0);
      });

      it("if a trailing character is discarded, rest of string is processed", () => {
        expect(Buffer.from("Abx", "hex")).toEqual(Buffer.from("Ab", "hex"));
      });

      it("single base64 char encodes as 0", () => {
        expect(Buffer.from("A", "base64").length).toBe(0);
      });

      it("invalid slice end", () => {
        const b = Buffer.from([1, 2, 3, 4, 5]);
        const b2 = b.toString("hex", 1, 10000);
        const b3 = b.toString("hex", 1, 5);
        const b4 = b.toString("hex", 1);
        expect(b2).toBe(b3);
        expect(b2).toBe(b4);
      });

      it("slice()", () => {
        function buildBuffer(data) {
          if (Array.isArray(data)) {
            const buffer = Buffer.allocUnsafe(data.length);
            data.forEach((v, k) => (buffer[k] = v));
            return buffer;
          }
          return null;
        }

        const x = buildBuffer([0x81, 0xa3, 0x66, 0x6f, 0x6f, 0xa3, 0x62, 0x61, 0x72]);
        expect(x).toStrictEqual(Buffer.from([0x81, 0xa3, 0x66, 0x6f, 0x6f, 0xa3, 0x62, 0x61, 0x72]));

        const a = x.slice(4);
        expect(a.length).toBe(5);
        expect(a[0]).toBe(0x6f);
        expect(a[1]).toBe(0xa3);
        expect(a[2]).toBe(0x62);
        expect(a[3]).toBe(0x61);
        expect(a[4]).toBe(0x72);

        const b = x.slice(0);
        expect(b.length).toBe(x.length);

        const c = x.slice(0, 4);
        expect(c.length).toBe(4);
        expect(c[0]).toBe(0x81);
        expect(c[1]).toBe(0xa3);

        const d = x.slice(0, 9);
        expect(d.length).toBe(9);

        const e = x.slice(1, 4);
        expect(e.length).toBe(3);
        expect(e[0]).toBe(0xa3);

        const f = x.slice(2, 4);
        expect(f.length).toBe(2);
        expect(f[0]).toBe(0x66);
        expect(f[1]).toBe(0x6f);
      });

      function forEachUnicode(label, test) {
        ["ucs2", "ucs-2", "utf16le", "utf-16le"].forEach(encoding =>
          it(`${label} (${encoding})`, test.bind(null, encoding)),
        );
      }

      forEachUnicode("write()", encoding => {
        const b = Buffer.allocUnsafe(10);
        b.write("あいうえお", encoding);
        expect(b.toString(encoding)).toBe("あいうえお");
      });

      forEachUnicode("write() with offset", encoding => {
        const b = Buffer.allocUnsafe(11);
        b.write("あいうえお", 1, encoding);
        expect(b.toString(encoding, 1)).toBe("あいうえお");
      });

      it("latin1 encoding should write only one byte per character", () => {
        const b = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
        b.write(String.fromCharCode(0xffff), 0, "latin1");
        expect(b[0]).toBe(0xff);
        expect(b[1]).toBe(0xad);
        expect(b[2]).toBe(0xbe);
        expect(b[3]).toBe(0xef);
        b.write(String.fromCharCode(0xaaee), 0, "latin1");
        expect(b[0]).toBe(0xee);
        expect(b[1]).toBe(0xad);
        expect(b[2]).toBe(0xbe);
        expect(b[3]).toBe(0xef);
      });

      it("binary encoding should write only one byte per character", () => {
        const b = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
        b.write(String.fromCharCode(0xffff), 0, "latin1");
        expect(b[0]).toBe(0xff);
        expect(b[1]).toBe(0xad);
        expect(b[2]).toBe(0xbe);
        expect(b[3]).toBe(0xef);
        b.write(String.fromCharCode(0xaaee), 0, "latin1");
        expect(b[0]).toBe(0xee);
        expect(b[1]).toBe(0xad);
        expect(b[2]).toBe(0xbe);
        expect(b[3]).toBe(0xef);
      });

      it("UTF-8 string includes null character", () => {
        // https://github.com/nodejs/node-v0.x-archive/pull/1210
        expect(Buffer.from("\0").length).toBe(1);
        expect(Buffer.from("\0\0").length).toBe(2);
      });

      it("truncate write() at character boundary", () => {
        const buf = Buffer.allocUnsafe(2);
        expect(buf.write("")).toBe(0); // 0bytes
        expect(buf.write("\0")).toBe(1); // 1byte (v8 adds null terminator)
        expect(buf.write("a\0")).toBe(2); // 1byte * 2
        expect(buf.write("あ")).toBe(0); // 3bytes
        expect(buf.write("\0あ")).toBe(1); // 1byte + 3bytes
        expect(buf.write("\0\0あ")).toBe(2); // 1byte * 2 + 3bytes

        const buf2 = Buffer.allocUnsafe(10);
        expect(buf2.write("あいう")).toBe(9); // 3bytes * 3 (v8 adds null term.)
        expect(buf2.write("あいう\0")).toBe(10); // 3bytes * 3 + 1byte
      });

      it("write() with maxLength", () => {
        // https://github.com/nodejs/node-v0.x-archive/issues/243
        const buf = Buffer.allocUnsafe(4);
        buf.fill(0xff);
        expect(buf.write("abcd", 1, 2, "utf8")).toBe(2);
        expect(buf[0]).toBe(0xff);
        expect(buf[1]).toBe(0x61);
        expect(buf[2]).toBe(0x62);
        expect(buf[3]).toBe(0xff);

        buf.fill(0xff);
        expect(buf.write("abcd", 1, 4)).toBe(3);
        expect(buf[0]).toBe(0xff);
        expect(buf[1]).toBe(0x61);
        expect(buf[2]).toBe(0x62);
        expect(buf[3]).toBe(0x63);

        buf.fill(0xff);
        expect(buf.write("abcd", 1, 2, "utf8")).toBe(2);
        expect(buf[0]).toBe(0xff);
        expect(buf[1]).toBe(0x61);
        expect(buf[2]).toBe(0x62);
        expect(buf[3]).toBe(0xff);

        buf.fill(0xff);
        expect(buf.write("abcdef", 1, 2, "hex")).toBe(2);
        expect(buf[0]).toBe(0xff);
        expect(buf[1]).toBe(0xab);
        expect(buf[2]).toBe(0xcd);
        expect(buf[3]).toBe(0xff);

        ["ucs2", "ucs-2", "utf16le", "utf-16le"].forEach(encoding => {
          buf.fill(0xff);
          expect(buf.write("abcd", 0, 2, encoding)).toBe(2);
          expect(buf[0]).toBe(0x61);
          expect(buf[1]).toBe(0x00);
          expect(buf[2]).toBe(0xff);
          expect(buf[3]).toBe(0xff);
        });
      });

      it("offset returns are correct", () => {
        const b = Buffer.allocUnsafe(16);
        expect(b.writeUInt32LE(0, 0)).toBe(4);
        expect(b.writeUInt16LE(0, 4)).toBe(6);
        expect(b.writeUInt8(0, 6)).toBe(7);
        expect(b.writeInt8(0, 7)).toBe(8);
        expect(b.writeDoubleLE(0, 8)).toBe(16);
      });

      it("unmatched surrogates should not produce invalid utf8 output", () => {
        // ef bf bd = utf-8 representation of unicode replacement character
        // see https://codereview.chromium.org/121173009/
        let buf = Buffer.from("ab\ud800cd", "utf8");
        expect(buf[0]).toBe(0x61);
        expect(buf[1]).toBe(0x62);
        expect(buf[2]).toBe(0xef);
        expect(buf[3]).toBe(0xbf);
        expect(buf[4]).toBe(0xbd);
        expect(buf[5]).toBe(0x63);
        expect(buf[6]).toBe(0x64);

        buf = Buffer.from("abcd\ud800", "utf8");
        expect(buf[0]).toBe(0x61);
        expect(buf[1]).toBe(0x62);
        expect(buf[2]).toBe(0x63);
        expect(buf[3]).toBe(0x64);
        expect(buf[4]).toBe(0xef);
        expect(buf[5]).toBe(0xbf);
        expect(buf[6]).toBe(0xbd);

        buf = Buffer.from("\ud800abcd", "utf8");
        expect(buf[0]).toBe(0xef);
        expect(buf[1]).toBe(0xbf);
        expect(buf[2]).toBe(0xbd);
        expect(buf[3]).toBe(0x61);
        expect(buf[4]).toBe(0x62);
        expect(buf[5]).toBe(0x63);
        expect(buf[6]).toBe(0x64);
      });

      it("buffer overrun", () => {
        const buf = Buffer.from([0, 0, 0, 0, 0]); // length: 5
        const sub = buf.slice(0, 4); // length: 4
        expect(sub.write("12345", "latin1")).toBe(4);
        expect(buf[4]).toBe(0);
        expect(sub.write("12345", "binary")).toBe(4);
        expect(buf[4]).toBe(0);
      });

      it("alloc with fill option", () => {
        const buf = Buffer.alloc(5, "800A", "hex");
        expect(buf[0]).toBe(128);
        expect(buf[1]).toBe(10);
        expect(buf[2]).toBe(128);
        expect(buf[3]).toBe(10);
        expect(buf[4]).toBe(128);
      });

      // https://github.com/joyent/node/issues/1758
      it("check for fractional length args, junk length args, etc.", () => {
        // Call .fill() first, stops valgrind warning about uninitialized memory reads.
        Buffer.allocUnsafe(3.3).fill().toString();
        // Throws bad argument error in commit 43cb4ec
        Buffer.alloc(3.3).fill().toString();
        expect(Buffer.allocUnsafe(3.3).length).toBe(3);
        expect(Buffer.from({ length: 3.3 }).length).toBe(3);
        expect(Buffer.from({ length: "BAM" }).length).toBe(0);
        // Make sure that strings are not coerced to numbers.
        expect(Buffer.from("99").length).toBe(2);
        expect(Buffer.from("13.37").length).toBe(5);
        // Ensure that the length argument is respected.
        ["ascii", "utf8", "hex", "base64", "latin1", "binary"].forEach(enc => {
          expect(Buffer.allocUnsafe(1).write("aaaaaa", 0, 1, enc)).toBe(1);
        });
        // Regression test, guard against buffer overrun in the base64 decoder.
        const a = Buffer.allocUnsafe(3);
        const b = Buffer.from("xxx");
        a.write("aaaaaaaa", "base64");
        expect(b.toString()).toBe("xxx");
      });

      it("buffer overflow", () => {
        // issue GH-5587
        expect(() => Buffer.alloc(8).writeFloatLE(0, 5)).toThrow(RangeError);
        expect(() => Buffer.alloc(16).writeDoubleLE(0, 9)).toThrow(RangeError);
        // Attempt to overflow buffers, similar to previous bug in array buffers
        expect(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, 0xffffffff)).toThrow(RangeError);
        expect(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, 0xffffffff)).toThrow(RangeError);
        // Ensure negative values can't get past offset
        expect(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, -1)).toThrow(RangeError);
        expect(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, -1)).toThrow(RangeError);
      });

      it("common write{U}IntLE/BE()", () => {
        let buf = Buffer.allocUnsafe(3);
        buf.writeUIntLE(0x123456, 0, 3);
        expect(buf.toJSON().data).toEqual([0x56, 0x34, 0x12]);
        expect(buf.readUIntLE(0, 3)).toBe(0x123456);

        buf.fill(0xff);
        buf.writeUIntBE(0x123456, 0, 3);
        expect(buf.toJSON().data).toEqual([0x12, 0x34, 0x56]);
        expect(buf.readUIntBE(0, 3)).toBe(0x123456);

        buf.fill(0xff);
        buf.writeIntLE(0x123456, 0, 3);
        expect(buf.toJSON().data).toEqual([0x56, 0x34, 0x12]);
        expect(buf.readIntLE(0, 3)).toBe(0x123456);

        buf.fill(0xff);
        buf.writeIntBE(0x123456, 0, 3);
        expect(buf.toJSON().data).toEqual([0x12, 0x34, 0x56]);
        expect(buf.readIntBE(0, 3)).toBe(0x123456);

        buf.fill(0xff);
        buf.writeIntLE(-0x123456, 0, 3);
        expect(buf.toJSON().data).toEqual([0xaa, 0xcb, 0xed]);
        expect(buf.readIntLE(0, 3)).toBe(-0x123456);

        buf.fill(0xff);
        buf.writeIntBE(-0x123456, 0, 3);
        expect(buf.toJSON().data).toEqual([0xed, 0xcb, 0xaa]);
        expect(buf.readIntBE(0, 3)).toBe(-0x123456);

        buf.fill(0xff);
        buf.writeIntLE(-0x123400, 0, 3);
        expect(buf.toJSON().data).toEqual([0x00, 0xcc, 0xed]);
        expect(buf.readIntLE(0, 3)).toBe(-0x123400);

        buf.fill(0xff);
        buf.writeIntBE(-0x123400, 0, 3);
        expect(buf.toJSON().data).toEqual([0xed, 0xcc, 0x00]);
        expect(buf.readIntBE(0, 3)).toBe(-0x123400);

        buf.fill(0xff);
        buf.writeIntLE(-0x120000, 0, 3);
        expect(buf.toJSON().data).toEqual([0x00, 0x00, 0xee]);
        expect(buf.readIntLE(0, 3)).toBe(-0x120000);

        buf.fill(0xff);
        buf.writeIntBE(-0x120000, 0, 3);
        expect(buf.toJSON().data).toEqual([0xee, 0x00, 0x00]);
        expect(buf.readIntBE(0, 3)).toBe(-0x120000);

        buf = Buffer.allocUnsafe(5);
        buf.writeUIntLE(0x1234567890, 0, 5);
        expect(buf.toJSON().data).toEqual([0x90, 0x78, 0x56, 0x34, 0x12]);
        expect(buf.readUIntLE(0, 5)).toBe(0x1234567890);

        buf.fill(0xff);
        buf.writeUIntBE(0x1234567890, 0, 5);
        expect(buf.toJSON().data).toEqual([0x12, 0x34, 0x56, 0x78, 0x90]);
        expect(buf.readUIntBE(0, 5)).toBe(0x1234567890);

        buf.fill(0xff);
        buf.writeIntLE(0x1234567890, 0, 5);
        expect(buf.toJSON().data).toEqual([0x90, 0x78, 0x56, 0x34, 0x12]);
        expect(buf.readIntLE(0, 5)).toBe(0x1234567890);

        buf.fill(0xff);
        buf.writeIntBE(0x1234567890, 0, 5);
        expect(buf.toJSON().data).toEqual([0x12, 0x34, 0x56, 0x78, 0x90]);
        expect(buf.readIntBE(0, 5)).toBe(0x1234567890);

        buf.fill(0xff);
        buf.writeIntLE(-0x1234567890, 0, 5);
        expect(buf.toJSON().data).toEqual([0x70, 0x87, 0xa9, 0xcb, 0xed]);
        expect(buf.readIntLE(0, 5)).toBe(-0x1234567890);

        buf.fill(0xff);
        buf.writeIntBE(-0x1234567890, 0, 5);
        expect(buf.toJSON().data).toEqual([0xed, 0xcb, 0xa9, 0x87, 0x70]);
        expect(buf.readIntBE(0, 5)).toBe(-0x1234567890);

        buf.fill(0xff);
        buf.writeIntLE(-0x0012000000, 0, 5);
        expect(buf.toJSON().data).toEqual([0x00, 0x00, 0x00, 0xee, 0xff]);
        expect(buf.readIntLE(0, 5)).toBe(-0x0012000000);

        buf.fill(0xff);
        buf.writeIntBE(-0x0012000000, 0, 5);
        expect(buf.toJSON().data).toEqual([0xff, 0xee, 0x00, 0x00, 0x00]);
        expect(buf.readIntBE(0, 5)).toBe(-0x0012000000);
      });

      it("construct buffer from buffer", () => {
        // Regression test for https://github.com/nodejs/node-v0.x-archive/issues/6111.
        // Constructing a buffer from another buffer should a) work, and b) not corrupt
        // the source buffer.
        const a = [...Array(128).keys()]; // [0, 1, 2, 3, ... 126, 127]
        const b = Buffer.from(a);
        const c = Buffer.from(b);
        expect(b.length).toBe(a.length);
        expect(c.length).toBe(a.length);
        for (let i = 0, k = a.length; i < k; ++i) {
          expect(a[i]).toBe(i);
          expect(b[i]).toBe(i);
          expect(c[i]).toBe(i);
        }
      });

      it("truncation after decode", () => {
        const crypto = require("crypto");

        expect(crypto.createHash("sha1").update(Buffer.from("YW55=======", "base64")).digest("hex")).toBe(
          crypto.createHash("sha1").update(Buffer.from("YW55", "base64")).digest("hex"),
        );
      });

      it("Buffer,poolSize", () => {
        const ps = Buffer.poolSize;
        Buffer.poolSize = 0;
        expect(Buffer.allocUnsafe(1).parent instanceof ArrayBuffer).toBe(true);
        Buffer.poolSize = ps;

        expect(() => Buffer.allocUnsafe(10).copy()).toThrow(TypeError);

        expect(() => Buffer.from()).toThrow(TypeError);
        expect(() => Buffer.from(null)).toThrow(TypeError);
      });

      it("prototype getters should not throw", () => {
        expect(Buffer.prototype.parent).toBeUndefined();
        expect(Buffer.prototype.offset).toBeUndefined();
        expect(SlowBuffer.prototype.parent).toBeUndefined();
        expect(SlowBuffer.prototype.offset).toBeUndefined();
      });

      it("large negative Buffer length inputs should not affect pool offset", () => {
        // Use the fromArrayLike() variant here because it's more lenient
        // about its input and passes the length directly to allocate().
        expect(Buffer.from({ length: -Buffer.poolSize })).toStrictEqual(Buffer.from(""));
        expect(Buffer.from({ length: -100 })).toStrictEqual(Buffer.from(""));

        // Check pool offset after that by trying to write string into the pool.
        Buffer.from("abc");
      });

      it("ParseArrayIndex() should handle full uint32", () => {
        expect(() => Buffer.from(new ArrayBuffer(0), -1 >>> 0)).toThrow(RangeError);
      });

      it("ParseArrayIndex() should reject values that don't fit in a 32 bits size_t", () => {
        expect(() => {
          const a = Buffer.alloc(1);
          const b = Buffer.alloc(1);
          a.copy(b, 0, 0x100000000, 0x100000001);
        }).toThrow(RangeError);
      });

      it("unpooled buffer (replaces SlowBuffer)", () => {
        const ubuf = Buffer.allocUnsafeSlow(10);
        expect(ubuf).toBeTruthy();
        expect(ubuf.buffer).toBeTruthy();
        expect(ubuf.buffer.byteLength).toBe(10);
      });

      it("verify that an empty ArrayBuffer does not throw", () => {
        Buffer.from(new ArrayBuffer());
      });

      it("alloc() should throw on non-numeric size", () => {
        expect(() => Buffer.alloc({ valueOf: () => 1 })).toThrow(TypeError);
        expect(() => Buffer.alloc({ valueOf: () => -1 })).toThrow(TypeError);
      });

      it("toLocaleString()", () => {
        const buf = Buffer.from("test");
        expect(buf.toLocaleString()).toBe(buf.toString());
        // expect(Buffer.prototype.toLocaleString).toBe(Buffer.prototype.toString);
      });

      it("alloc() should throw on invalid data", () => {
        expect(() => Buffer.alloc(0x1000, "This is not correctly encoded", "hex")).toThrow(TypeError);
        expect(() => Buffer.alloc(0x1000, "c", "hex")).toThrow(TypeError);
        expect(() => Buffer.alloc(1, Buffer.alloc(0))).toThrow(TypeError);
        expect(() => Buffer.alloc(40, "x", 20)).toThrow(TypeError);
      });

      it("Buffer.toJSON()", () => {
        expect(JSON.stringify(Buffer.from("hello"))).toBe(
          JSON.stringify({
            type: "Buffer",
            data: [104, 101, 108, 108, 111],
          }),
        );
      });

      it("buffer", () => {
        var buf = new Buffer(20);
        gc();
        // if this fails or infinitely loops, it means there is a memory issue with the JSC::Structure object
        expect(Object.keys(buf).length > 0).toBe(true);
        gc();
        expect(buf.write("hello world ")).toBe(12);
        expect(buf.write("hello world ", "utf8")).toBe(12);

        gc();
        expect(buf.toString("utf8", 0, "hello world ".length)).toBe("hello world ");
        gc();
        expect(buf.toString("base64url", 0, "hello world ".length)).toBe(btoa("hello world "));
        gc();
        expect(buf instanceof Uint8Array).toBe(true);
        gc();
        expect(buf instanceof Buffer).toBe(true);
        gc();
        expect(buf.slice() instanceof Uint8Array).toBe(true);
        gc();
        expect(buf.slice(0, 1) instanceof Buffer).toBe(true);
        gc();
        expect(buf.slice(0, 1) instanceof Uint8Array).toBe(true);
        gc();
        expect(buf.slice(0, 1) instanceof Buffer).toBe(true);
        gc();
        expect(buf.slice(0, 0).length).toBe(0);
      });

      it("Buffer", () => {
        var inputs = ["hello world", "hello world".repeat(100), `😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`];
        var good = inputs.map(a => new TextEncoder().encode(a));
        for (let i = 0; i < inputs.length; i++) {
          var input = inputs[i];
          expect(new Buffer(input).toString("utf8")).toBe(inputs[i]);
          gc();
          expect(Array.from(new Buffer(input)).join(",")).toBe(good[i].join(","));
          gc();
          expect(Buffer.byteLength(input)).toBe(good[i].length);
          gc();
          expect(Buffer.from(input).byteLength).toBe(Buffer.byteLength(input));
        }
      });

      it("Buffer.byteLength", () => {
        expect(Buffer.byteLength("😀😃😄😁😆😅😂🤣☺️😊😊😇")).toBe(
          new TextEncoder().encode("😀😃😄😁😆😅😂🤣☺️😊😊😇").byteLength,
        );
      });

      it("Buffer.isBuffer", () => {
        expect(Buffer.isBuffer(new Buffer(1))).toBe(true);
        gc();
        expect(Buffer.isBuffer(new Buffer(0))).toBe(true);
        gc();
        expect(Buffer.isBuffer(new Uint8Array(0))).toBe(false);
        gc();
        expect(Buffer.isBuffer(new Uint8Array(1))).toBe(false);
        gc();
        var a = new Uint8Array(1);
        gc();
        expect(Buffer.isBuffer(a)).toBe(false);
        gc();
        a = new Buffer(a.buffer);
        gc();
        expect(Buffer.isBuffer(a)).toBe(true);
        gc();
        expect(a instanceof Buffer).toBe(true);
        expect(a instanceof Uint8Array).toBe(true);
        expect(new Uint8Array(0) instanceof Buffer).toBe(false);

        // DOMJIT
        for (let i = 0; i < 9000; i++) {
          if (!Buffer.isBuffer(a)) {
            throw new Error("Buffer.isBuffer failed");
          }

          if (Buffer.isBuffer("wat")) {
            throw new Error("Buffer.isBuffer failed");
          }
        }
      });

      it("writeInt", () => {
        var buf = new Buffer(1024);
        var data = new DataView(buf.buffer);
        buf.writeInt32BE(100);
        expect(data.getInt32(0, false)).toBe(100);
        buf.writeInt32BE(100);
        expect(data.getInt32(0, false)).toBe(100);
        var childBuf = buf.subarray(0, 4);
        expect(data.getInt32(0, false)).toBe(100);
        expect(childBuf.readInt32BE(0, false)).toBe(100);
      });

      it("Buffer.from", () => {
        expect(Buffer.from("hello world").toString("utf8")).toBe("hello world");
        expect(Buffer.from("hello world", "ascii").toString("utf8")).toBe("hello world");
        expect(Buffer.from("hello world", "latin1").toString("utf8")).toBe("hello world");
        gc();
        expect(Buffer.from([254]).join(",")).toBe("254");

        expect(Buffer.from([254], "utf8").join(",")).toBe("254");
        expect(Buffer.from([254], "utf-8").join(",")).toBe("254");
        expect(Buffer.from([254], "latin").join(",")).toBe("254");
        expect(Buffer.from([254], "uc2").join(",")).toBe("254");
        expect(Buffer.from([254], "utf16").join(",")).toBe("254");
        expect(Buffer.isBuffer(Buffer.from([254], "utf16"))).toBe(true);

        expect(() => Buffer.from(123).join(",")).toThrow();

        expect(Buffer.from({ length: 124 }).join(",")).toBe(Uint8Array.from({ length: 124 }).join(","));

        expect(Buffer.from(new ArrayBuffer(1024), 0, 512).join(",")).toBe(new Uint8Array(512).join(","));

        expect(Buffer.from(new Buffer(new ArrayBuffer(1024), 0, 512)).join(",")).toBe(new Uint8Array(512).join(","));
        gc();
      });

      it("Buffer.from latin1 vs ascii", () => {
        const simpleBuffer = Buffer.from("\xa4", "binary");
        expect(simpleBuffer.toString("latin1")).toBe("¤");
        expect(simpleBuffer.toString("ascii")).toBe("$");
        gc();
        const asciiBuffer = Buffer.from("\xa4", "ascii");
        expect(asciiBuffer.toString("latin1")).toBe("¤");
        expect(asciiBuffer.toString("ascii")).toBe("$");
        gc();
      });

      it("Buffer.equals", () => {
        var a = new Uint8Array(10);
        a[2] = 1;
        var b = new Uint8Array(10);
        b[2] = 1;
        a = new Buffer(a.buffer);
        b = new Buffer(b.buffer);
        expect(a.equals(b)).toBe(true);
        b[2] = 0;
        expect(a.equals(b)).toBe(false);
      });

      it("Buffer.compare", () => {
        var a = new Uint8Array(10);
        a[2] = 1;
        var b = new Uint8Array(10);
        b[2] = 1;
        a = new Buffer(a.buffer);
        b = new Buffer(b.buffer);
        expect(a.compare(b)).toBe(0);
        b[2] = 0;
        expect(a.compare(b)).toBe(1);
        expect(b.compare(a)).toBe(-1);

        const buf = Buffer.from("0123456789", "utf8");
        const expectedSameBufs = [
          [buf.slice(-10, 10), Buffer.from("0123456789", "utf8")],
          [buf.slice(-20, 10), Buffer.from("0123456789", "utf8")],
          [buf.slice(-20, -10), Buffer.from("", "utf8")],
          [buf.slice(), Buffer.from("0123456789", "utf8")],
          [buf.slice(0), Buffer.from("0123456789", "utf8")],
          [buf.slice(0, 0), Buffer.from("", "utf8")],
          [buf.slice(undefined), Buffer.from("0123456789", "utf8")],
          [buf.slice("foobar"), Buffer.from("0123456789", "utf8")],
          [buf.slice(undefined, undefined), Buffer.from("0123456789", "utf8")],
          [buf.slice(2), Buffer.from("23456789", "utf8")],
          [buf.slice(5), Buffer.from("56789", "utf8")],
          [buf.slice(10), Buffer.from("", "utf8")],
          [buf.slice(5, 8), Buffer.from("567", "utf8")],
          [buf.slice(8, -1), Buffer.from("8", "utf8")],
          [buf.slice(-10), Buffer.from("0123456789", "utf8")],
          [buf.slice(0, -9), Buffer.from("0", "utf8")],
          [buf.slice(0, -10), Buffer.from("", "utf8")],
          [buf.slice(0, -1), Buffer.from("012345678", "utf8")],
          [buf.slice(2, -2), Buffer.from("234567", "utf8")],
          [buf.slice(0, 65536), Buffer.from("0123456789", "utf8")],
          [buf.slice(65536, 0), Buffer.from("", "utf8")],
          [buf.slice(-5, -8), Buffer.from("", "utf8")],
          [buf.slice(-5, -3), Buffer.from("56", "utf8")],
          [buf.slice(-10, 10), Buffer.from("0123456789", "utf8")],
          [buf.slice("0", "1"), Buffer.from("0", "utf8")],
          [buf.slice("-5", "10"), Buffer.from("56789", "utf8")],
          [buf.slice("-10", "10"), Buffer.from("0123456789", "utf8")],
          [buf.slice("-10", "-5"), Buffer.from("01234", "utf8")],
          [buf.slice("-10", "-0"), Buffer.from("", "utf8")],
          [buf.slice("111"), Buffer.from("", "utf8")],
          [buf.slice("0", "-111"), Buffer.from("", "utf8")],
        ];

        for (let i = 0, s = buf.toString(); i < buf.length; ++i) {
          expectedSameBufs.push(
            [buf.slice(i), Buffer.from(s.slice(i))],
            [buf.slice(0, i), Buffer.from(s.slice(0, i))],
            [buf.slice(-i), Buffer.from(s.slice(-i))],
            [buf.slice(0, -i), Buffer.from(s.slice(0, -i))],
          );
        }

        expectedSameBufs.forEach(([buf1, buf2]) => {
          expect(Buffer.compare(buf1, buf2)).toBe(0);
        });

        {
          const buf = Buffer.from([
            1, 29, 0, 0, 1, 143, 216, 162, 92, 254, 248, 63, 0, 0, 0, 18, 184, 6, 0, 175, 29, 0, 8, 11, 1, 0, 0,
          ]);
          const chunk1 = Buffer.from([1, 29, 0, 0, 1, 143, 216, 162, 92, 254, 248, 63, 0]);
          const chunk2 = Buffer.from([0, 0, 18, 184, 6, 0, 175, 29, 0, 8, 11, 1, 0, 0]);
          const middle = buf.length / 2;

          expect(JSON.stringify(buf.slice(0, middle))).toBe(JSON.stringify(chunk1));
          expect(JSON.stringify(buf.slice(middle))).toBe(JSON.stringify(chunk2));
        }
      });

      describe("Buffer.copy", () => {
        it("should work", () => {
          var array1 = new Uint8Array(128);
          array1.fill(100);
          array1 = new Buffer(array1.buffer);
          var array2 = new Uint8Array(128);
          array2.fill(200);
          array2 = new Buffer(array2.buffer);
          var array3 = new Uint8Array(128);
          array3 = new Buffer(array3.buffer);
          gc();
          expect(array1.copy(array2)).toBe(128);
          expect(array1.join("")).toBe(array2.join(""));
        });

        it("should work with offset", () => {
          // Create two `Buffer` instances.
          const buf1 = Buffer.allocUnsafe(26);
          const buf2 = Buffer.allocUnsafe(26).fill("!");

          for (let i = 0; i < 26; i++) {
            // 97 is the decimal ASCII value for 'a'.
            buf1[i] = i + 97;
          }

          // Copy `buf1` bytes 16 through 19 into `buf2` starting at byte 8 of `buf2`.
          buf1.copy(buf2, 8, 16, 20);
          expect(buf2.toString("ascii", 0, 25)).toBe("!!!!!!!!qrst!!!!!!!!!!!!!");
        });

        it("should ignore sourceEnd if it's out of range", () => {
          const buf1 = Buffer.allocUnsafe(26);
          const buf2 = Buffer.allocUnsafe(10).fill("!");

          for (let i = 0; i < 26; i++) {
            // 97 is the decimal ASCII value for 'a'.
            buf1[i] = i + 97;
          }

          // Copy `buf1` bytes "xyz" into `buf2` starting at byte 1 of `buf2`.
          expect(buf1.copy(buf2, 1, 23, 100)).toBe(3);
          expect(buf2.toString()).toBe("!xyz!!!!!!");
        });

        it("copy to the same buffer", () => {
          const buf = Buffer.allocUnsafe(26);

          for (let i = 0; i < 26; i++) {
            // 97 is the decimal ASCII value for 'a'.
            buf[i] = i + 97;
          }

          buf.copy(buf, 0, 4, 10);
          expect(buf.toString()).toBe("efghijghijklmnopqrstuvwxyz");
        });
      });

      describe("Buffer.fill string", () => {
        for (let text of ["hello world", "1234567890", "\uD83D\uDE00", "😀😃😄😁😆😅😂🤣☺️😊😊😇"]) {
          it(text, () => {
            var input = new Buffer(1024);
            input.fill(text);
            var demo = new Uint8Array(1024);
            var encoded = new TextEncoder().encode(text);

            demo.set(encoded);
            fillRepeating(demo, 0, encoded.length);
            expect(input.join("")).toBe(demo.join(""));
          });
        }
      });

      it("Buffer.fill 1 char string", () => {
        var input = new Buffer(1024);
        input.fill("h");
        var demo = new Uint8Array(1024);
        var encoded = new TextEncoder().encode("h");

        demo.set(encoded);
        fillRepeating(demo, 0, encoded.length);
        expect(input.join("")).toBe(demo.join(""));
      });

      it("Buffer.concat", () => {
        var array1 = new Uint8Array(128);
        array1.fill(100);
        var array2 = new Uint8Array(128);
        array2.fill(200);
        var array3 = new Uint8Array(128);
        array3.fill(300);
        gc();
        expect(Buffer.concat([array1, array2, array3]).join("")).toBe(
          array1.join("") + array2.join("") + array3.join(""),
        );
        expect(Buffer.concat([array1, array2, array3], 222).length).toBe(222);
        expect(Buffer.concat([array1, array2, array3], 222).subarray(0, 128).join("")).toBe("100".repeat(128));
        expect(Buffer.concat([array1, array2, array3], 222).subarray(129, 222).join("")).toBe("200".repeat(222 - 129));
        expect(() => {
          Buffer.concat([array1], -1);
        }).toThrow(RangeError);
        expect(() => {
          Buffer.concat([array1], "1");
        }).toThrow(TypeError);
        // issue#6570
        expect(Buffer.concat([array1, array2, array3], undefined).join("")).toBe(
          array1.join("") + array2.join("") + array3.join(""),
        );
        // issue#3639
        expect(Buffer.concat([array1, array2, array3], 128 * 4).join("")).toBe(
          array1.join("") + array2.join("") + array3.join("") + Buffer.alloc(128).join(""),
        );
      });

      it("Buffer.concat huge", () => {
        // largest page size of any supported platform.
        const PAGE = 64 * 1024;

        var array1 = Buffer.allocUnsafe(PAGE);
        array1.fill("a");
        var array2 = Buffer.allocUnsafe(PAGE);
        array2.fill("b");
        var array3 = Buffer.allocUnsafe(PAGE);
        array3.fill("c");

        const complete = array1.toString("hex") + array2.toString("hex") + array3.toString("hex");
        const out = Buffer.concat([array1, array2, array3]);
        expect(out.toString("hex")).toBe(complete);

        const out2 = Buffer.concat([array1, array2, array3], PAGE);
        expect(out2.toString("hex")).toBe(array1.toString("hex"));

        const out3 = Buffer.concat([array1, array2, array3], PAGE * 1.5);
        const out3hex = out3.toString("hex");
        expect(out3hex).toBe(array1.toString("hex") + array2.slice(0, PAGE * 0.5).toString("hex"));

        array1.fill("d");
        expect(out3.toString("hex")).toBe(out3hex);
      });

      it("read", () => {
        var buf = new Buffer(1024);
        var data = new DataView(buf.buffer);
        function reset() {
          new Uint8Array(buf.buffer).fill(0);
        }
        data.setBigInt64(0, BigInt(1000), false);
        expect(buf.readBigInt64BE(0)).toBe(BigInt(1000));
        reset();

        data.setBigInt64(0, BigInt(1000), true);
        expect(buf.readBigInt64LE(0)).toBe(BigInt(1000));
        reset();

        data.setBigUint64(0, BigInt(1000), false);
        expect(buf.readBigUInt64BE(0)).toBe(BigInt(1000));
        reset();

        data.setBigUint64(0, BigInt(1000), true);
        expect(buf.readBigUInt64LE(0)).toBe(BigInt(1000));
        reset();

        data.setFloat64(0, 1000, false);
        expect(buf.readDoubleBE(0)).toBe(1000);
        reset();

        data.setFloat64(0, 1000, true);
        expect(buf.readDoubleLE(0)).toBe(1000);
        reset();

        data.setFloat32(0, 1000, false);
        expect(buf.readFloatBE(0)).toBe(1000);
        reset();

        data.setFloat32(0, 1000, true);
        expect(buf.readFloatLE(0)).toBe(1000);
        reset();

        data.setInt16(0, 1000, false);
        expect(buf.readInt16BE(0)).toBe(1000);
        reset();

        data.setInt16(0, 1000, true);
        expect(buf.readInt16LE(0)).toBe(1000);
        reset();

        data.setInt32(0, 1000, false);
        expect(buf.readInt32BE(0)).toBe(1000);
        reset();

        data.setInt32(0, 1000, true);
        expect(buf.readInt32LE(0)).toBe(1000);
        reset();

        data.setInt8(0, 100, false);
        expect(buf.readInt8(0)).toBe(100);
        reset();

        data.setUint16(0, 1000, false);
        expect(buf.readUInt16BE(0)).toBe(1000);
        reset();

        data.setUint16(0, 1000, true);
        expect(buf.readUInt16LE(0)).toBe(1000);
        reset();

        data.setUint32(0, 1000, false);
        expect(buf.readUInt32BE(0)).toBe(1000);
        reset();

        data.setUint32(0, 1000, true);
        expect(buf.readUInt32LE(0)).toBe(1000);
        reset();

        data.setUint8(0, 255, false);
        expect(buf.readUInt8(0)).toBe(255);
        reset();

        data.setUint8(0, 255, false);
        expect(buf.readUInt8(0)).toBe(255);
        reset();

        data.setUint32(0, 0x55555555, false);
        data.setUint16(4, 0x5555, false);
        expect(buf.readUintBE(0, 5)).toBe(366503875925);
        expect(buf.readUintBE(0, 6)).toBe(93824992236885);
        reset();

        data.setUint32(0, 0xaaaaaaaa, false);
        data.setUint16(4, 0xaaaa, false);
        expect(buf.readUintBE(0, 5)).toBe(733007751850);
        expect(buf.readUintBE(0, 6)).toBe(187649984473770);
        reset();

        // issue#6759
        data.setUint32(0, 0xffffffff, false);
        data.setUint16(4, 0xffff, false);
        expect(buf.readUintBE(0, 5)).toBe(1099511627775);
        expect(buf.readUintBE(0, 6)).toBe(281474976710655);
        reset();
      });

      // this is for checking the simd code path
      it("write long utf16 string works", () => {
        const long = "😀😃😄😁😆😅😂🤣☺️😊😊😇".repeat(200);
        const buf = Buffer.alloc(long.length * 2);
        buf.write(long, 0, "utf16le");
        expect(buf.toString("utf16le")).toBe(long);
        for (let offset = 0; offset < long.length; offset += 48) {
          expect(buf.toString("utf16le", offset, offset + 4)).toBe("😀");
          expect(buf.toString("utf16le", offset, offset + 8)).toBe("😀😃");
          expect(buf.toString("utf16le", offset, offset + 12)).toBe("😀😃😄");
          expect(buf.toString("utf16le", offset, offset + 16)).toBe("😀😃😄😁");
          expect(buf.toString("utf16le", offset, offset + 20)).toBe("😀😃😄😁😆");
          expect(buf.toString("utf16le", offset, offset + 24)).toBe("😀😃😄😁😆😅");
          expect(buf.toString("utf16le", offset, offset + 28)).toBe("😀😃😄😁😆😅😂");
          expect(buf.toString("utf16le", offset, offset + 32)).toBe("😀😃😄😁😆😅😂🤣");
          expect(buf.toString("utf16le", offset, offset + 36)).toBe("😀😃😄😁😆😅😂🤣☺️");
          expect(buf.toString("utf16le", offset, offset + 40)).toBe("😀😃😄😁😆😅😂🤣☺️😊");
          expect(buf.toString("utf16le", offset, offset + 44)).toBe("😀😃😄😁😆😅😂🤣☺️😊😊");
          expect(buf.toString("utf16le", offset, offset + 48)).toBe("😀😃😄😁😆😅😂🤣☺️😊😊😇");
        }
      });

      it("write", () => {
        const resultMap = new Map([
          ["utf8", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
          ["ucs2", Buffer.from([102, 0, 111, 0, 111, 0, 0, 0, 0])],
          ["ascii", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
          ["latin1", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
          ["binary", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
          ["utf16le", Buffer.from([102, 0, 111, 0, 111, 0, 0, 0, 0])],
          ["base64", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
          ["base64url", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
          ["hex", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
        ]);

        let buf = Buffer.alloc(9);
        function reset() {
          new Uint8Array(buf.buffer).fill(0);
        }

        // utf8, ucs2, ascii, latin1, utf16le
        const encodings = ["utf8", "utf-8", "ucs2", "ucs-2", "ascii", "latin1", "binary", "utf16le", "utf-16le"];

        encodings
          .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
          .forEach(encoding => {
            reset();

            const len = Buffer.byteLength("foo", encoding);
            expect(buf.write("foo", 0, len, encoding)).toBe(len);

            if (encoding.includes("-")) encoding = encoding.replace("-", "");

            expect(buf).toStrictEqual(resultMap.get(encoding.toLowerCase()));
          });

        // base64
        ["base64", "BASE64", "base64url", "BASE64URL"].forEach(encoding => {
          reset();

          const len = Buffer.byteLength("Zm9v", encoding);

          expect(buf.write("Zm9v", 0, len, encoding)).toBe(len);
          expect(buf).toStrictEqual(resultMap.get(encoding.toLowerCase()));
        });

        // hex
        ["hex", "HEX"].forEach(encoding => {
          reset();
          const len = Buffer.byteLength("666f6f", encoding);

          expect(buf.write("666f6f", 0, len, encoding)).toBe(len);
          expect(buf).toStrictEqual(resultMap.get(encoding.toLowerCase()));
        });

        // UCS-2 overflow CVE-2018-12115
        for (let i = 1; i < 4; i++) {
          // Allocate two Buffers sequentially off the pool. Run more than once in case
          // we hit the end of the pool and don't get sequential allocations
          const x = Buffer.allocUnsafe(4).fill(0);
          const y = Buffer.allocUnsafe(4).fill(1);
          // Should not write anything, pos 3 doesn't have enough room for a 16-bit char
          expect(x.write("ыыыыыы", 3, "ucs2")).toBe(0);
          // CVE-2018-12115 experienced via buffer overrun to next block in the pool
          expect(Buffer.compare(y, Buffer.alloc(4, 1))).toBe(0);
        }

        // // Should not write any data when there is no space for 16-bit chars
        const z = Buffer.alloc(4, 0);
        expect(z.write("\u0001", 3, "ucs2")).toBe(0);
        expect(Buffer.compare(z, Buffer.alloc(4, 0))).toBe(0);
        // Make sure longer strings are written up to the buffer end.
        expect(z.write("abcd", 2)).toBe(2);
        expect([...z]).toStrictEqual([0, 0, 0x61, 0x62]);

        //Large overrun could corrupt the process with utf8
        expect(Buffer.alloc(4).write("a".repeat(100), 3, "utf8")).toBe(1);

        // Large overrun could corrupt the process
        expect(Buffer.alloc(4).write("ыыыыыы".repeat(100), 3, "utf16le")).toBe(0);

        {
          // .write() does not affect the byte after the written-to slice of the Buffer.
          // Refs: https://github.com/nodejs/node/issues/26422
          const buf = Buffer.alloc(8);
          expect(buf.write("ыы", 1, "utf16le")).toBe(4);
          expect([...buf]).toStrictEqual([0, 0x4b, 0x04, 0x4b, 0x04, 0, 0, 0]);
        }
      });

      it("includes", () => {
        const buf = Buffer.from("this is a buffer");

        expect(buf.includes("this")).toBe(true);
        expect(buf.includes("is")).toBe(true);
        expect(buf.includes(Buffer.from("a buffer"))).toBe(true);
        expect(buf.includes(97)).toBe(true);
        expect(buf.includes(Buffer.from("a buffer example"))).toBe(false);
        expect(buf.includes(Buffer.from("a buffer example").slice(0, 8))).toBe(true);
        expect(buf.includes("this", 4)).toBe(false);
      });

      it("indexOf", () => {
        const buf = Buffer.from("this is a buffer");

        expect(buf.indexOf("this")).toBe(0);
        expect(buf.indexOf("is")).toBe(2);
        expect(buf.indexOf(Buffer.from("a buffer"))).toBe(8);
        expect(buf.indexOf(97)).toBe(8);
        expect(buf.indexOf(Buffer.from("a buffer example"))).toBe(-1);
        expect(buf.indexOf(Buffer.from("a buffer example").slice(0, 8))).toBe(8);

        const utf16Buffer = Buffer.from("\u039a\u0391\u03a3\u03a3\u0395", "utf16le");

        expect(utf16Buffer.indexOf("\u03a3", 0, "utf16le")).toBe(4);
        expect(utf16Buffer.indexOf("\u03a3", -4, "utf16le")).toBe(6);

        const b = Buffer.from("abcdef");

        // Passing a value that's a number, but not a valid byte.
        // Prints: 2, equivalent to searching for 99 or 'c'.
        expect(b.indexOf(99.9)).toBe(2);
        expect(b.indexOf(256 + 99)).toBe(2);

        // Passing a byteOffset that coerces to NaN or 0.
        // Prints: 1, searching the whole buffer.
        expect(b.indexOf("b", undefined)).toBe(1);
        expect(b.indexOf("b", {})).toBe(1);
        expect(b.indexOf("b", null)).toBe(1);
        expect(b.indexOf("b", [])).toBe(1);
      });

      it("lastIndexOf", () => {
        const buf = Buffer.from("this buffer is a buffer");

        expect(buf.lastIndexOf("this")).toBe(0);
        expect(buf.lastIndexOf("this", 0)).toBe(0);
        expect(buf.lastIndexOf("this", -1000)).toBe(-1);
        expect(buf.lastIndexOf("buffer")).toBe(17);
        expect(buf.lastIndexOf(Buffer.from("buffer"))).toBe(17);
        expect(buf.lastIndexOf(97)).toBe(15);
        expect(buf.lastIndexOf(Buffer.from("yolo"))).toBe(-1);
        expect(buf.lastIndexOf("buffer", 5)).toBe(5);
        expect(buf.lastIndexOf("buffer", 4)).toBe(-1);

        const utf16Buffer = Buffer.from("\u039a\u0391\u03a3\u03a3\u0395", "utf16le");

        expect(utf16Buffer.lastIndexOf("\u03a3", undefined, "utf16le")).toBe(6);
        expect(utf16Buffer.lastIndexOf("\u03a3", -5, "utf16le")).toBe(4);

        const b = Buffer.from("abcdef");

        // Passing a value that's a number, but not a valid byte.
        // Prints: 2, equivalent to searching for 99 or 'c'.
        expect(b.lastIndexOf(99.9)).toBe(2);
        expect(b.lastIndexOf(256 + 99)).toBe(2);

        // Passing a byteOffset that coerces to NaN or 0.
        // Prints: 1, searching the whole buffer.
        expect(b.lastIndexOf("b", undefined)).toBe(1);
        expect(b.lastIndexOf("b", {})).toBe(1);

        // Passing a byteOffset that coerces to 0.
        // Prints: -1, equivalent to passing 0.
        expect(b.lastIndexOf("b", null)).toBe(-1);
        expect(b.lastIndexOf("b", [])).toBe(-1);
      });

      for (let fn of [Buffer.prototype.slice, Buffer.prototype.subarray]) {
        it(`Buffer.${fn.name}`, () => {
          const buf = new Buffer("buffer");
          const slice = fn.call(buf, 1, 3);
          expect(slice.toString()).toBe("uf");
          const slice2 = fn.call(slice, 100);
          expect(slice2.toString()).toBe("");

          const slice3 = fn.call(slice, -1);
          expect(slice3.toString()).toBe("f");
        });
      }

      it("Buffer.from(base64)", () => {
        const buf = Buffer.from("aGVsbG8gd29ybGQ=", "base64");
        expect(buf.toString()).toBe("hello world");

        expect(Buffer.from(btoa('console.log("hello world")\n'), "base64").toString()).toBe(
          'console.log("hello world")\n',
        );
      });

      it("Buffer.swap16", () => {
        const examples = [
          ["", ""],
          ["a1", "1a"],
          ["a1b2", "1a2b"],
        ];

        for (let i = 0; i < examples.length; i++) {
          const input = examples[i][0];
          const output = examples[i][1];
          const buf = Buffer.from(input, "utf-8");

          const ref = buf.swap16();
          expect(ref instanceof Buffer).toBe(true);
          expect(buf.toString()).toBe(output);
        }

        const buf = Buffer.from("123", "utf-8");
        try {
          buf.swap16();
          expect.unreachable();
        } catch (exception) {
          expect(exception.message).toBe("Buffer size must be a multiple of 16-bits");
        }
      });

      it("Buffer.swap32", () => {
        const examples = [
          ["", ""],
          ["a1b2", "2b1a"],
          ["a1b2c3d4", "2b1a4d3c"],
        ];

        for (let i = 0; i < examples.length; i++) {
          const input = examples[i][0];
          const output = examples[i][1];
          const buf = Buffer.from(input, "utf-8");

          const ref = buf.swap32();
          expect(ref instanceof Buffer).toBe(true);
          expect(buf.toString()).toBe(output);
        }

        const buf = Buffer.from("12345", "utf-8");
        try {
          buf.swap32();
          expect.unreachable();
        } catch (exception) {
          expect(exception.message).toBe("Buffer size must be a multiple of 32-bits");
        }
      });

      it("Buffer.swap64", () => {
        const examples = [
          ["", ""],
          ["a1b2c3d4", "4d3c2b1a"],
          ["a1b2c3d4e5f6g7h8", "4d3c2b1a8h7g6f5e"],
        ];

        for (let i = 0; i < examples.length; i++) {
          const input = examples[i][0];
          const output = examples[i][1];
          const buf = Buffer.from(input, "utf-8");

          const ref = buf.swap64();
          expect(ref instanceof Buffer).toBe(true);
          expect(buf.toString()).toBe(output);
        }

        const buf = Buffer.from("123456789", "utf-8");
        try {
          buf.swap64();
          expect.unreachable();
        } catch (exception) {
          expect(exception.message).toBe("Buffer size must be a multiple of 64-bits");
        }
      });

      it("Buffer.toString regessions", () => {
        expect(
          Buffer.from([65, 0])
            .toString("utf16le")
            .split("")
            .map(x => x.charCodeAt(0)),
        ).toEqual([65]);
        expect(Buffer.from([65, 0]).toString("base64")).toBe("QQA=");
        expect(Buffer.from('{"alg":"RS256","typ":"JWT"}', "latin1").toString("latin1")).toBe(
          '{"alg":"RS256","typ":"JWT"}',
        );
        expect(Buffer.from('{"alg":"RS256","typ":"JWT"}', "utf8").toString("utf8")).toBe('{"alg":"RS256","typ":"JWT"}');
      });

      it("Buffer.toString(utf16le)", () => {
        const buf = Buffer.from("hello world", "utf16le");
        expect(buf.toString("utf16le")).toBe("hello world");
        expect(buf.toString("utf16le", 0, 5)).toBe("he");
      });

      it("Buffer.toString(binary)", () => {
        var x = Buffer.from("<?xm", "binary");
        expect(x.toString("binary")).toBe("<?xm");
      });

      it("Buffer.toString(base64)", () => {
        {
          const buf = Buffer.from("hello world");
          expect(buf.toString("base64")).toBe("aGVsbG8gd29ybGQ=");
        }

        {
          expect(Buffer.from(`console.log("hello world")\n`).toString("base64")).toBe(
            btoa('console.log("hello world")\n'),
          );
        }
      });

      it("Buffer can be mocked", () => {
        function MockBuffer() {
          const noop = function () {};
          const res = Buffer.alloc(0);
          for (const op in Buffer.prototype) {
            if (typeof res[op] === "function") {
              res[op] = noop;
            }
          }
          return res;
        }

        const buf = MockBuffer();

        expect(() => {
          buf.write("hello world");
          buf.writeUint16BE(0);
          buf.writeUint32BE(0);
          buf.writeBigInt64BE(0);
          buf.writeBigUInt64BE(0);
          buf.writeBigInt64LE(0);
          buf.writeBigUInt64LE(0);
        }).not.toThrow();
      });

      it("constants", () => {
        expect(BufferModule.constants.MAX_LENGTH).toBe(4294967296);
        expect(BufferModule.constants.MAX_STRING_LENGTH).toBe(4294967295);
        expect(BufferModule.default.constants.MAX_LENGTH).toBe(4294967296);
        expect(BufferModule.default.constants.MAX_STRING_LENGTH).toBe(4294967295);
      });

      it("File", () => {
        expect(BufferModule.File).toBe(File);
      });

      it("transcode", () => {
        expect(typeof BufferModule.transcode).toBe("undefined");

        // This is a masqueradesAsUndefined function
        expect(() => BufferModule.transcode()).toThrow("Not implemented");
      });

      it("Buffer.from (Node.js test/test-buffer-from.js)", () => {
        const checkString = "test";

        const check = Buffer.from(checkString);

        class MyString extends String {
          constructor() {
            super(checkString);
          }
        }

        class MyPrimitive {
          [Symbol.toPrimitive]() {
            return checkString;
          }
        }

        class MyBadPrimitive {
          [Symbol.toPrimitive]() {
            return 1;
          }
        }

        expect(Buffer.from(new String(checkString))).toStrictEqual(check);
        expect(Buffer.from(new MyString())).toStrictEqual(check);
        expect(Buffer.from(new MyPrimitive())).toStrictEqual(check);

        [
          {},
          new Boolean(true),
          {
            valueOf() {
              return null;
            },
          },
          {
            valueOf() {
              return undefined;
            },
          },
          { valueOf: null },
          Object.create(null),
          new Number(true),
          new MyBadPrimitive(),
          Symbol(),
          5n,
          (one, two, three) => {},
          undefined,
          null,
        ].forEach(input => {
          expect(() => Buffer.from(input)).toThrow();
          expect(() => Buffer.from(input, "hex")).toThrow();
        });

        expect(() => Buffer.allocUnsafe(10)).not.toThrow(); // Should not throw.
        expect(() => Buffer.from("deadbeaf", "hex")).not.toThrow(); // Should not throw.
      });

      it("new Buffer() (Node.js test/test-buffer-new.js)", () => {
        const LENGTH = 16;

        const ab = new ArrayBuffer(LENGTH);
        const dv = new DataView(ab);
        const ui = new Uint8Array(ab);
        const buf = Buffer.from(ab);

        expect(buf instanceof Buffer).toBe(true);
        // expect(buf.parent, buf.buffer);
        expect(buf.buffer).toBe(ab);
        expect(buf.length).toBe(ab.byteLength);

        buf.fill(0xc);
        for (let i = 0; i < LENGTH; i++) {
          expect(ui[i]).toBe(0xc);
          ui[i] = 0xf;
          expect(buf[i]).toBe(0xf);
        }

        buf.writeUInt32LE(0xf00, 0);
        buf.writeUInt32BE(0xb47, 4);
        buf.writeDoubleLE(3.1415, 8);
        expect(dv.getUint32(0, true)).toBe(0xf00);
        expect(dv.getUint32(4)).toBe(0xb47);
        expect(dv.getFloat64(8, true)).toBe(3.1415);

        // Now test protecting users from doing stupid things

        // expect(function () {
        //   function AB() {}
        //   Object.setPrototypeOf(AB, ArrayBuffer);
        //   Object.setPrototypeOf(AB.prototype, ArrayBuffer.prototype);
        //   // Buffer.from(new AB());
        // }).toThrow();
        // console.log(origAB !== ab);

        // Test the byteOffset and length arguments
        {
          const ab = new Uint8Array(5);
          ab[0] = 1;
          ab[1] = 2;
          ab[2] = 3;
          ab[3] = 4;
          ab[4] = 5;
          const buf = Buffer.from(ab.buffer, 1, 3);
          expect(buf.length).toBe(3);
          expect(buf[0]).toBe(2);
          expect(buf[1]).toBe(3);
          expect(buf[2]).toBe(4);
          buf[0] = 9;
          expect(ab[1]).toBe(9);

          expect(() => Buffer.from(ab.buffer, 6)).toThrow();
          expect(() => Buffer.from(ab.buffer, 3, 6)).toThrow();
        }

        // Test the deprecated Buffer() version also
        {
          const ab = new Uint8Array(5);
          ab[0] = 1;
          ab[1] = 2;
          ab[2] = 3;
          ab[3] = 4;
          ab[4] = 5;
          const buf = Buffer(ab.buffer, 1, 3);
          expect(buf.length).toBe(3);
          expect(buf[0]).toBe(2);
          expect(buf[1]).toBe(3);
          expect(buf[2]).toBe(4);
          buf[0] = 9;
          expect(ab[1]).toBe(9);

          expect(() => Buffer(ab.buffer, 6)).toThrow();
          expect(() => Buffer(ab.buffer, 3, 6)).toThrow();
        }

        {
          // If byteOffset is not numeric, it defaults to 0.
          const ab = new ArrayBuffer(10);
          const expected = Buffer.from(ab, 0);
          expect(Buffer.from(ab, "fhqwhgads")).toStrictEqual(expected);
          expect(Buffer.from(ab, NaN)).toStrictEqual(expected);
          expect(Buffer.from(ab, {})).toStrictEqual(expected);
          expect(Buffer.from(ab, [])).toStrictEqual(expected);

          // If byteOffset can be converted to a number, it will be.
          expect(Buffer.from(ab, [1])).toStrictEqual(Buffer.from(ab, 1));

          // If byteOffset is Infinity, throw.
          expect(() => {
            Buffer.from(ab, Infinity);
          }).toThrow();
        }

        {
          // If length is not numeric, it defaults to 0.
          const ab = new ArrayBuffer(10);
          const expected = Buffer.from(ab, 0, 0);
          expect(Buffer.from(ab, 0, "fhqwhgads")).toStrictEqual(expected);
          expect(Buffer.from(ab, 0, NaN)).toStrictEqual(expected);
          expect(Buffer.from(ab, 0, {})).toStrictEqual(expected);
          expect(Buffer.from(ab, 0, [])).toStrictEqual(expected);

          // If length can be converted to a number, it will be.
          expect(Buffer.from(ab, 0, [1])).toStrictEqual(Buffer.from(ab, 0, 1));

          // If length is Infinity, throw.
          expect(() => Buffer.from(ab, 0, Infinity)).toThrow();
        }

        // Test an array like entry with the length set to NaN.
        expect(Buffer.from({ length: NaN })).toStrictEqual(Buffer.alloc(0));
      });

      it("Buffer.fill (Node.js tests)", () => {
        "use strict";
        const SIZE = 28;

        const buf1 = Buffer.allocUnsafe(SIZE);
        const buf2 = Buffer.allocUnsafe(SIZE);

        function bufReset() {
          buf1.fill(0);
          buf2.fill(0);
        }

        // This is mostly accurate. Except write() won't write partial bytes to the
        // string while fill() blindly copies bytes into memory. To account for that an
        // error will be thrown if not all the data can be written, and the SIZE has
        // been massaged to work with the input characters.
        function writeToFill(string, offset, end, encoding) {
          if (typeof offset === "string") {
            encoding = offset;
            offset = 0;
            end = buf2.length;
          } else if (typeof end === "string") {
            encoding = end;
            end = buf2.length;
          } else if (end === undefined) {
            end = buf2.length;
          }

          // Should never be reached.
          if (offset < 0 || end > buf2.length) throw new ERR_OUT_OF_RANGE();

          if (end <= offset) return buf2;

          offset >>>= 0;
          end >>>= 0;
          expect(offset <= buf2.length).toBe(true);

          // Convert "end" to "length" (which write understands).
          const length = end - offset < 0 ? 0 : end - offset;

          let wasZero = false;
          do {
            const written = buf2.write(string, offset, length, encoding);
            offset += written;
            // Safety check in case write falls into infinite loop.
            if (written === 0) {
              if (wasZero) throw new Error("Could not write all data to Buffer at " + offset);
              else wasZero = true;
            }
          } while (offset < buf2.length);

          return buf2;
        }

        function testBufs(string, offset, length, encoding) {
          bufReset();
          buf1.fill.apply(buf1, arguments);
          // Swap bytes on BE archs for ucs2 encoding.
          expect(buf1.fill.apply(buf1, arguments)).toStrictEqual(writeToFill.apply(null, arguments));
        }

        // Default encoding
        testBufs("abc");
        testBufs("\u0222aa");
        testBufs("a\u0234b\u0235c\u0236");
        testBufs("abc", 4);
        testBufs("abc", 5);
        testBufs("abc", SIZE);
        testBufs("\u0222aa", 2);
        testBufs("\u0222aa", 8);
        testBufs("a\u0234b\u0235c\u0236", 4);
        testBufs("a\u0234b\u0235c\u0236", 12);
        testBufs("abc", 4, 1);
        testBufs("abc", 5, 1);
        testBufs("\u0222aa", 8, 1);
        testBufs("a\u0234b\u0235c\u0236", 4, 1);
        testBufs("a\u0234b\u0235c\u0236", 12, 1);

        // UTF8
        testBufs("abc", "utf8");
        testBufs("\u0222aa", "utf8");
        testBufs("a\u0234b\u0235c\u0236", "utf8");
        testBufs("abc", 4, "utf8");
        testBufs("abc", 5, "utf8");
        testBufs("abc", SIZE, "utf8");
        testBufs("\u0222aa", 2, "utf8");
        testBufs("\u0222aa", 8, "utf8");
        testBufs("a\u0234b\u0235c\u0236", 4, "utf8");
        testBufs("a\u0234b\u0235c\u0236", 12, "utf8");
        testBufs("abc", 4, 1, "utf8");
        testBufs("abc", 5, 1, "utf8");
        testBufs("\u0222aa", 8, 1, "utf8");
        testBufs("a\u0234b\u0235c\u0236", 4, 1, "utf8");
        testBufs("a\u0234b\u0235c\u0236", 12, 1, "utf8");
        expect(Buffer.allocUnsafe(1).fill(0).fill("\u0222")[0]).toBe(0xc8);

        // BINARY
        testBufs("abc", "binary");
        testBufs("\u0222aa", "binary");
        testBufs("a\u0234b\u0235c\u0236", "binary");
        testBufs("abc", 4, "binary");
        testBufs("abc", 5, "binary");
        testBufs("abc", SIZE, "binary");
        testBufs("\u0222aa", 2, "binary");
        testBufs("\u0222aa", 8, "binary");
        testBufs("a\u0234b\u0235c\u0236", 4, "binary");
        testBufs("a\u0234b\u0235c\u0236", 12, "binary");
        testBufs("abc", 4, 1, "binary");
        testBufs("abc", 5, 1, "binary");
        testBufs("\u0222aa", 8, 1, "binary");
        testBufs("a\u0234b\u0235c\u0236", 4, 1, "binary");
        testBufs("a\u0234b\u0235c\u0236", 12, 1, "binary");

        // LATIN1
        testBufs("abc", "latin1");
        testBufs("\u0222aa", "latin1");
        testBufs("a\u0234b\u0235c\u0236", "latin1");
        testBufs("abc", 4, "latin1");
        testBufs("abc", 5, "latin1");
        testBufs("abc", SIZE, "latin1");
        testBufs("\u0222aa", 2, "latin1");
        testBufs("\u0222aa", 8, "latin1");
        testBufs("a\u0234b\u0235c\u0236", 4, "latin1");
        testBufs("a\u0234b\u0235c\u0236", 12, "latin1");
        testBufs("abc", 4, 1, "latin1");
        testBufs("abc", 5, 1, "latin1");
        testBufs("\u0222aa", 8, 1, "latin1");
        testBufs("a\u0234b\u0235c\u0236", 4, 1, "latin1");
        testBufs("a\u0234b\u0235c\u0236", 12, 1, "latin1");

        // UCS2
        testBufs("abc", "ucs2");
        testBufs("\u0222aa", "ucs2");
        testBufs("a\u0234b\u0235c\u0236", "ucs2");
        testBufs("abc", 4, "ucs2");
        testBufs("abc", SIZE, "ucs2");
        testBufs("\u0222aa", 2, "ucs2");
        testBufs("\u0222aa", 8, "ucs2");
        testBufs("a\u0234b\u0235c\u0236", 4, "ucs2");
        testBufs("a\u0234b\u0235c\u0236", 12, "ucs2");
        testBufs("abc", 4, 1, "ucs2");
        testBufs("abc", 5, 1, "ucs2");
        testBufs("\u0222aa", 8, 1, "ucs2");
        testBufs("a\u0234b\u0235c\u0236", 4, 1, "ucs2");
        testBufs("a\u0234b\u0235c\u0236", 12, 1, "ucs2");
        expect(Buffer.allocUnsafe(1).fill("\u0222", "ucs2")[0]).toBe(0x22);

        // HEX
        testBufs("616263", "hex");
        testBufs("c8a26161", "hex");
        testBufs("61c8b462c8b563c8b6", "hex");
        testBufs("616263", 4, "hex");
        testBufs("616263", 5, "hex");
        testBufs("616263", SIZE, "hex");
        testBufs("c8a26161", 2, "hex");
        testBufs("c8a26161", 8, "hex");
        testBufs("61c8b462c8b563c8b6", 4, "hex");
        testBufs("61c8b462c8b563c8b6", 12, "hex");
        testBufs("616263", 4, 1, "hex");
        testBufs("616263", 5, 1, "hex");
        testBufs("c8a26161", 8, 1, "hex");
        testBufs("61c8b462c8b563c8b6", 4, 1, "hex");
        testBufs("61c8b462c8b563c8b6", 12, 1, "hex");

        expect(() => {
          const buf = Buffer.allocUnsafe(SIZE);

          buf.fill("yKJh", "hex");
        }).toThrow();

        expect(() => {
          const buf = Buffer.allocUnsafe(SIZE);

          buf.fill("\u0222", "hex");
        }).toThrow();

        // BASE64
        testBufs("YWJj", "base64");
        testBufs("yKJhYQ==", "base64");
        testBufs("Yci0Ysi1Y8i2", "base64");
        testBufs("YWJj", 4, "base64");
        testBufs("YWJj", SIZE, "base64");
        testBufs("yKJhYQ==", 2, "base64");
        testBufs("yKJhYQ==", 8, "base64");
        testBufs("Yci0Ysi1Y8i2", 4, "base64");
        testBufs("Yci0Ysi1Y8i2", 12, "base64");
        testBufs("YWJj", 4, 1, "base64");
        testBufs("YWJj", 5, 1, "base64");
        testBufs("yKJhYQ==", 8, 1, "base64");
        testBufs("Yci0Ysi1Y8i2", 4, 1, "base64");
        testBufs("Yci0Ysi1Y8i2", 12, 1, "base64");

        // BASE64URL
        testBufs("YWJj", "base64url");
        testBufs("yKJhYQ", "base64url");
        testBufs("Yci0Ysi1Y8i2", "base64url");
        testBufs("YWJj", 4, "base64url");
        testBufs("YWJj", SIZE, "base64url");
        testBufs("yKJhYQ", 2, "base64url");
        testBufs("yKJhYQ", 8, "base64url");
        testBufs("Yci0Ysi1Y8i2", 4, "base64url");
        testBufs("Yci0Ysi1Y8i2", 12, "base64url");
        testBufs("YWJj", 4, 1, "base64url");
        testBufs("YWJj", 5, 1, "base64url");
        testBufs("yKJhYQ", 8, 1, "base64url");
        testBufs("Yci0Ysi1Y8i2", 4, 1, "base64url");
        testBufs("Yci0Ysi1Y8i2", 12, 1, "base64url");
      });

      it("fill() repeat pattern", () => {
        function genBuffer(size, args) {
          const b = Buffer.allocUnsafe(size);
          return b.fill(0).fill.apply(b, args);
        }

        const buf2Fill = Buffer.allocUnsafe(1).fill(2);
        expect(genBuffer(4, [buf2Fill])).toStrictEqual(Buffer.from([2, 2, 2, 2]));
        expect(genBuffer(4, [buf2Fill, 1])).toStrictEqual(Buffer.from([0, 2, 2, 2]));
        expect(genBuffer(4, [buf2Fill, 1, 3])).toStrictEqual(Buffer.from([0, 2, 2, 0]));
        expect(genBuffer(4, [buf2Fill, 1, 1])).toStrictEqual(Buffer.from([0, 0, 0, 0]));
        const hexBufFill = Buffer.allocUnsafe(2).fill(0).fill("0102", "hex");
        expect(genBuffer(4, [hexBufFill])).toStrictEqual(Buffer.from([1, 2, 1, 2]));
        expect(genBuffer(4, [hexBufFill, 1])).toStrictEqual(Buffer.from([0, 1, 2, 1]));
        expect(genBuffer(4, [hexBufFill, 1, 3])).toStrictEqual(Buffer.from([0, 1, 2, 0]));
        expect(genBuffer(4, [hexBufFill, 1, 1])).toStrictEqual(Buffer.from([0, 0, 0, 0]));
      });

      it("fill() should throw on invalid arguments", () => {
        // Check exceptions
        const buf = Buffer.allocUnsafe(16);
        expect(() => buf.fill(0, -1)).toThrow(RangeError);
        expect(() => buf.fill(0, 0, buf.length + 1)).toThrow(RangeError);
        expect(() => buf.fill("", -1)).toThrow(RangeError);
        expect(() => buf.fill("", 0, buf.length + 1)).toThrow(RangeError);
        expect(() => buf.fill("", 1, -1)).toThrow(RangeError);
        expect(() => buf.fill("a", 0, buf.length, "node rocks!")).toThrow(TypeError);
        expect(() => buf.fill("a", 0, 0, NaN)).toThrow(TypeError);
        expect(() => buf.fill("a", 0, 0, false)).toThrow(TypeError);
        expect(() => buf.fill("a", 0, 0, "foo")).toThrow(TypeError);

        // Make sure these throw.
        expect(() => Buffer.allocUnsafe(8).fill("a", -1)).toThrow();
        expect(() => Buffer.allocUnsafe(8).fill("a", 0, 9)).toThrow();
      });

      it("fill() should not hang indefinitely", () => {
        // Make sure this doesn't hang indefinitely.
        Buffer.allocUnsafe(8).fill("");
        Buffer.alloc(8, "");
      });

      it("fill() repeat byte", () => {
        const buf = Buffer.alloc(64, 10);
        for (let i = 0; i < buf.length; i++) expect(buf[i]).toBe(10);

        buf.fill(11, 0, buf.length >> 1);
        for (let i = 0; i < buf.length >> 1; i++) expect(buf[i]).toBe(11);
        for (let i = (buf.length >> 1) + 1; i < buf.length; i++) expect(buf[i]).toBe(10);

        buf.fill("h");
        for (let i = 0; i < buf.length; i++) expect(buf[i]).toBe("h".charCodeAt(0));

        buf.fill(0);
        for (let i = 0; i < buf.length; i++) expect(buf[i]).toBe(0);

        buf.fill(null);
        for (let i = 0; i < buf.length; i++) expect(buf[i]).toBe(0);

        buf.fill(1, 16, 32);
        for (let i = 0; i < 16; i++) expect(buf[i]).toBe(0);
        for (let i = 16; i < 32; i++) expect(buf[i]).toBe(1);
        for (let i = 32; i < buf.length; i++) expect(buf[i]).toBe(0);
      });

      it("alloc() repeat pattern", () => {
        const buf = Buffer.alloc(10, "abc");
        expect(buf.toString()).toBe("abcabcabca");
        buf.fill("է");
        expect(buf.toString()).toBe("էէէէէ");
      });

      it("fill() should properly check `start` & `end`", () => {
        // // Testing process.binding. Make sure "start" is properly checked for range
        // // errors.
        // expect(() => internalBinding("buffer").fill(Buffer.alloc(1), 1, -1, 0, 1)).toThrow(RangeError);

        // Make sure "end" is properly checked, even if it's magically mangled using
        // Symbol.toPrimitive.
        expect(() => {
          const end = {
            [Symbol.toPrimitive]() {
              return 1;
            },
          };
          Buffer.alloc(1).fill(Buffer.alloc(1), 0, end);
        }).toThrow(TypeError);

        // Testing process.binding. Make sure "end" is properly checked for range
        // errors.
        // expect(() => internalBinding("buffer").fill(Buffer.alloc(1), 1, 1, -2, 1)).toThrow(RangeError);
      });

      it("bypassing `length` should not cause an abort", () => {
        const buf = Buffer.from("w00t");
        expect(buf).toStrictEqual(Buffer.from([119, 48, 48, 116]));
        Object.defineProperty(buf, "length", {
          value: 1337,
          enumerable: true,
        });
        // Node.js throws here, but we can handle it just fine
        buf.fill("");
        expect(buf).toStrictEqual(Buffer.from([0, 0, 0, 0]));
      });

      it("allocUnsafeSlow().fill()", () => {
        expect(Buffer.allocUnsafeSlow(16).fill("ab", "utf16le")).toStrictEqual(
          Buffer.from("61006200610062006100620061006200", "hex"),
        );

        expect(Buffer.allocUnsafeSlow(15).fill("ab", "utf16le")).toStrictEqual(
          Buffer.from("610062006100620061006200610062", "hex"),
        );

        expect(Buffer.allocUnsafeSlow(16).fill("ab", "utf16le")).toStrictEqual(
          Buffer.from("61006200610062006100620061006200", "hex"),
        );
        expect(Buffer.allocUnsafeSlow(16).fill("a", "utf16le")).toStrictEqual(
          Buffer.from("61006100610061006100610061006100", "hex"),
        );

        expect(Buffer.allocUnsafeSlow(16).fill("a", "utf16le").toString("utf16le")).toBe("a".repeat(8));
        expect(Buffer.allocUnsafeSlow(16).fill("a", "latin1").toString("latin1")).toBe("a".repeat(16));
        expect(Buffer.allocUnsafeSlow(16).fill("a", "utf8").toString("utf8")).toBe("a".repeat(16));

        expect(Buffer.allocUnsafeSlow(16).fill("Љ", "utf16le").toString("utf16le")).toBe("Љ".repeat(8));
        expect(Buffer.allocUnsafeSlow(16).fill("Љ", "latin1").toString("latin1")).toBe("\t".repeat(16));
        expect(Buffer.allocUnsafeSlow(16).fill("Љ", "utf8").toString("utf8")).toBe("Љ".repeat(8));

        expect(() => {
          const buf = Buffer.from("a".repeat(1000));

          buf.fill("This is not correctly encoded", "hex");
        }).toThrow();
      });

      it("ArrayBuffer.isView()", () => {
        expect(ArrayBuffer.isView(new Buffer(10))).toBe(true);
        expect(ArrayBuffer.isView(new SlowBuffer(10))).toBe(true);
        expect(ArrayBuffer.isView(Buffer.alloc(10))).toBe(true);
        expect(ArrayBuffer.isView(Buffer.allocUnsafe(10))).toBe(true);
        expect(ArrayBuffer.isView(Buffer.allocUnsafeSlow(10))).toBe(true);
        expect(ArrayBuffer.isView(Buffer.from(""))).toBe(true);
      });

      it("Buffer.byteLength()", () => {
        expect(() => Buffer.byteLength(32, "latin1")).toThrow(TypeError);
        expect(() => Buffer.byteLength(NaN, "utf8")).toThrow(TypeError);
        expect(() => Buffer.byteLength({}, "latin1")).toThrow(TypeError);
        expect(() => Buffer.byteLength()).toThrow(TypeError);

        expect(Buffer.byteLength("", undefined, true)).toBe(0);

        // buffer
        const incomplete = Buffer.from([0xe4, 0xb8, 0xad, 0xe6, 0x96]);
        expect(Buffer.byteLength(incomplete)).toBe(5);
        const ascii = Buffer.from("abc");
        expect(Buffer.byteLength(ascii)).toBe(3);

        // ArrayBuffer
        const buffer = new ArrayBuffer(8);
        expect(Buffer.byteLength(buffer)).toBe(8);

        // TypedArray
        const int8 = new Int8Array(8);
        expect(Buffer.byteLength(int8)).toBe(8);
        const uint8 = new Uint8Array(8);
        expect(Buffer.byteLength(uint8)).toBe(8);
        const uintc8 = new Uint8ClampedArray(2);
        expect(Buffer.byteLength(uintc8)).toBe(2);
        const int16 = new Int16Array(8);
        expect(Buffer.byteLength(int16)).toBe(16);
        const uint16 = new Uint16Array(8);
        expect(Buffer.byteLength(uint16)).toBe(16);
        const int32 = new Int32Array(8);
        expect(Buffer.byteLength(int32)).toBe(32);
        const uint32 = new Uint32Array(8);
        expect(Buffer.byteLength(uint32)).toBe(32);
        const float16 = new Float16Array(8);
        expect(Buffer.byteLength(float16)).toBe(16);
        const float32 = new Float32Array(8);
        expect(Buffer.byteLength(float32)).toBe(32);
        const float64 = new Float64Array(8);
        expect(Buffer.byteLength(float64)).toBe(64);

        // DataView
        const dv = new DataView(new ArrayBuffer(2));
        expect(Buffer.byteLength(dv)).toBe(2);

        // Special case: zero length string
        expect(Buffer.byteLength("", "ascii")).toBe(0);
        expect(Buffer.byteLength("", "HeX")).toBe(0);

        // utf8
        expect(Buffer.byteLength("∑éllö wørl∂!", "utf-8")).toBe(19);
        expect(Buffer.byteLength("κλμνξο", "utf8")).toBe(12);
        expect(Buffer.byteLength("挵挶挷挸挹", "utf-8")).toBe(15);
        expect(Buffer.byteLength("𠝹𠱓𠱸", "UTF8")).toBe(12);
        // Without an encoding, utf8 should be assumed
        expect(Buffer.byteLength("hey there")).toBe(9);
        expect(Buffer.byteLength("𠱸挶νξ#xx :)")).toBe(17);
        expect(Buffer.byteLength("hello world", "")).toBe(11);
        // It should also be assumed with unrecognized encoding
        expect(Buffer.byteLength("hello world", "abc")).toBe(11);
        expect(Buffer.byteLength("ßœ∑≈", "unkn0wn enc0ding")).toBe(10);

        // base64
        expect(Buffer.byteLength("aGVsbG8gd29ybGQ=", "base64")).toBe(11);
        expect(Buffer.byteLength("aGVsbG8gd29ybGQ=", "BASE64")).toBe(11);
        expect(Buffer.byteLength("bm9kZS5qcyByb2NrcyE=", "base64")).toBe(14);
        expect(Buffer.byteLength("aGkk", "base64")).toBe(3);
        expect(Buffer.byteLength("bHNrZGZsa3NqZmtsc2xrZmFqc2RsZmtqcw==", "base64")).toBe(25);
        // base64url
        expect(Buffer.byteLength("aGVsbG8gd29ybGQ", "base64url")).toBe(11);
        expect(Buffer.byteLength("aGVsbG8gd29ybGQ", "BASE64URL")).toBe(11);
        expect(Buffer.byteLength("bm9kZS5qcyByb2NrcyE", "base64url")).toBe(14);
        expect(Buffer.byteLength("aGkk", "base64url")).toBe(3);
        expect(Buffer.byteLength("bHNrZGZsa3NqZmtsc2xrZmFqc2RsZmtqcw", "base64url")).toBe(25);
        // special padding
        expect(Buffer.byteLength("aaa=", "base64")).toBe(2);
        expect(Buffer.byteLength("aaaa==", "base64")).toBe(3);
        expect(Buffer.byteLength("aaa=", "base64url")).toBe(2);
        expect(Buffer.byteLength("aaaa==", "base64url")).toBe(3);
        expect(Buffer.byteLength("Il était tué", "utf8")).toBe(14);
        expect(Buffer.byteLength("Il était tué")).toBe(14);

        ["ascii", "latin1", "binary"]
          .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
          .forEach(encoding => {
            expect(Buffer.byteLength("Il était tué", encoding)).toBe(12);
          });

        ["ucs2", "ucs-2", "utf16le", "utf-16le"]
          .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
          .forEach(encoding => {
            expect(Buffer.byteLength("Il était tué", encoding)).toBe(24);
          });

        // Test that ArrayBuffer from a different context is detected correctly
        // const arrayBuf = vm.runInNewContext("new ArrayBuffer()");
        // expect(Buffer.byteLength(arrayBuf)).toBe(0);

        // Verify that invalid encodings are treated as utf8
        for (let i = 1; i < 10; i++) {
          const encoding = String(i).repeat(i);

          expect(Buffer.isEncoding(encoding)).toBe(false);
          expect(Buffer.byteLength("foo", encoding)).toBe(Buffer.byteLength("foo", "utf8"));
        }
      });

      it("Buffer.toString(encoding, start, end)", () => {
        const buf = Buffer.from("0123456789", "utf8");

        expect(buf.toString()).toStrictEqual("0123456789");
        expect(buf.toString("utf8")).toStrictEqual("0123456789");
        expect(buf.toString("utf8", 3)).toStrictEqual("3456789");
        expect(buf.toString("utf8", 3, 4)).toStrictEqual("3");

        expect(buf.toString("utf8", 3, 100)).toStrictEqual("3456789");
        expect(buf.toString("utf8", 3, 1)).toStrictEqual("");
        expect(buf.toString("utf8", 100, 200)).toStrictEqual("");
        expect(buf.toString("utf8", 100, 1)).toStrictEqual("");
      });

      it("Buffer.asciiSlice())", () => {
        const buf = Buffer.from("0123456789", "ascii");

        expect(buf.asciiSlice()).toStrictEqual("0123456789");
        expect(buf.asciiSlice(3)).toStrictEqual("3456789");
        expect(buf.asciiSlice(3, 4)).toStrictEqual("3");
      });

      it("Buffer.latin1Slice()", () => {
        const buf = Buffer.from("âéö", "latin1");

        expect(buf.latin1Slice()).toStrictEqual("âéö");
        expect(buf.latin1Slice(1)).toStrictEqual("éö");
        expect(buf.latin1Slice(1, 2)).toStrictEqual("é");

        expect(() => buf.latin1Slice(1, 4)).toThrow(RangeError);
        expect(() => buf.latin1Slice(4, 1)).toThrow(RangeError);
        expect(() => buf.latin1Slice(4, 0)).toThrow(RangeError);

        expect(buf.latin1Slice(3)).toStrictEqual("");
        expect(buf.latin1Slice(3, 1)).toStrictEqual("");
        expect(buf.latin1Slice(2, 1)).toStrictEqual("");
        expect(buf.latin1Slice(1, 1)).toStrictEqual("");
        expect(buf.latin1Slice(1, 0)).toStrictEqual("");
      });

      it("Buffer.latin1Slice() on a Uint8Array", () => {
        const buf = new Uint8Array(Buffer.from("âéö", "latin1"));
        const latin1Slice = Buffer.prototype.latin1Slice;

        expect(latin1Slice.call(buf)).toStrictEqual("âéö");
        expect(latin1Slice.call(buf, 1)).toStrictEqual("éö");
        expect(latin1Slice.call(buf, 1, 2)).toStrictEqual("é");

        expect(() => latin1Slice.call(buf, 1, 4)).toThrow(RangeError);
        expect(() => latin1Slice.call(buf, 4, 1)).toThrow(RangeError);
        expect(() => latin1Slice.call(buf, 4, 0)).toThrow(RangeError);
        expect(() => latin1Slice.call(buf, 3, 999999)).toThrow(RangeError);

        expect(latin1Slice.call(buf, 3)).toStrictEqual("");
        expect(latin1Slice.call(buf, 3, 1)).toStrictEqual("");
        expect(latin1Slice.call(buf, 2, 1)).toStrictEqual("");
        expect(latin1Slice.call(buf, 1, 1)).toStrictEqual("");
        expect(latin1Slice.call(buf, 1, 0)).toStrictEqual("");
      });

      it("Buffer.latin1Slice() on non-ArrayBufferView fails", () => {
        const buf = new Array(new Uint8Array(Buffer.from("âéö", "latin1")));
        const latin1Slice = Buffer.prototype.latin1Slice;

        expect(() => latin1Slice.call(buf)).toThrow(TypeError);
        expect(() => latin1Slice.call(buf, 1)).toThrow(TypeError);
        expect(() => latin1Slice.call(Symbol("wat"), 1)).toThrow(TypeError);
      });

      it("Buffer.latin1Write() on a Uint8Array", () => {
        const buf = new Uint8Array(Buffer.from("old mcdonald had a farm é í é í ò", "latin1"));
        const latin1Write = Buffer.prototype.latin1Write;

        expect(latin1Write.call(buf, "é", 22)).toBe(1);
        expect(latin1Write.call(buf, "í", 24)).toBe(1);
        expect(latin1Write.call(buf, "é", 26)).toBe(1);
        expect(latin1Write.call(buf, "í", 28)).toBe(1);
        expect(latin1Write.call(buf, "é", 30)).toBe(1);
        expect(latin1Write.call(buf, "ò", 32)).toBe(1);
        expect(latin1Write.call(buf, "ò", 32, 999999)).toBe(1);

        expect(buf).toStrictEqual(
          new Uint8Array(Buffer.from("6f6c64206d63646f6e616c6420686164206120666172e920ed20e920ed20e920f2", "hex")),
        );
      });

      it("Buffer.utf8Slice()", () => {
        const buf = Buffer.from("あいうえお", "utf8");

        expect(buf.utf8Slice()).toStrictEqual("あいうえお");
        expect(buf.utf8Slice(3)).toStrictEqual("いうえお");
        expect(buf.utf8Slice(3, 6)).toStrictEqual("い");
      });

      it("Buffer.hexSlice()", () => {
        const buf = Buffer.from("0123456789", "utf8");

        expect(buf.hexSlice()).toStrictEqual("30313233343536373839");
        expect(buf.hexSlice(3)).toStrictEqual("33343536373839");
        expect(buf.hexSlice(3, 4)).toStrictEqual("33");
      });

      it("Buffer.ucs2Slice()", () => {
        const buf = Buffer.from("あいうえお", "ucs2");

        expect(buf.ucs2Slice()).toStrictEqual("あいうえお");
        expect(buf.ucs2Slice(2)).toStrictEqual("いうえお");
        expect(buf.ucs2Slice(2, 6)).toStrictEqual("いう");
      });

      it("Buffer.base64Slice()", () => {
        const buf = Buffer.from("0123456789", "utf8");

        expect(buf.base64Slice()).toStrictEqual("MDEyMzQ1Njc4OQ==");
        expect(buf.base64Slice(3)).toStrictEqual("MzQ1Njc4OQ==");
        expect(buf.base64Slice(3, 4)).toStrictEqual("Mw==");
      });

      it("Buffer.base64urlSlice()", () => {
        const buf = Buffer.from("0123456789", "utf8");

        expect(buf.base64urlSlice()).toStrictEqual("MDEyMzQ1Njc4OQ");
        expect(buf.base64urlSlice(3)).toStrictEqual("MzQ1Njc4OQ");
        expect(buf.base64urlSlice(3, 4)).toStrictEqual("Mw");
      });

      it("should not crash on invalid UTF-8 byte sequence", () => {
        const buf = Buffer.from([0xc0, 0xfd]);
        expect(buf.length).toBe(2);
        const str = buf.toString();
        expect(str.length).toBe(2);
        expect(str).toBe("\uFFFD\uFFFD");
      });

      it("should not crash on invalid UTF-8 byte sequence with ASCII head", () => {
        const buf = Buffer.from([0x42, 0xc0, 0xfd]);
        expect(buf.length).toBe(3);
        const str = buf.toString();
        expect(str.length).toBe(3);
        expect(str).toBe("B\uFFFD\uFFFD");
      });

      it("should not perform out-of-bound access on invalid UTF-8 byte sequence", () => {
        const buf = Buffer.from([0x01, 0x9a, 0x84, 0x13, 0x12, 0x11, 0x10, 0x09]).subarray(2);
        expect(buf.length).toBe(6);
        const str = buf.toString();
        expect(str.length).toBe(6);
        expect(str).toBe("\uFFFD\x13\x12\x11\x10\x09");
      });

      it("repro #2063", () => {
        const buf = Buffer.from(
          "eyJlbWFpbCI6Ijg3MTg4NDYxN0BxcS5jb20iLCJpZCI6OCwicm9sZSI6Im5vcm1hbCIsImlhdCI6MTY3NjI4NDQyMSwiZXhwIjoxNjc2ODg5MjIxfQ",
          "base64",
        );
        expect(buf.length).toBe(85);
        expect(buf[82]).toBe(50);
        expect(buf[83]).toBe(49);
        expect(buf[84]).toBe(125);
      });

      it("inspect() should exist", () => {
        expect(Buffer.prototype.inspect).toBeInstanceOf(Function);
        expect(new Buffer("123").inspect()).toBe(Bun.inspect(new Buffer("123")));
      });

      it("read alias", () => {
        var buf = new Buffer(1024);
        var data = new DataView(buf.buffer);

        data.setUint8(0, 200, false);

        expect(buf.readUint8(0)).toBe(buf.readUInt8(0));
        expect(buf.readUintBE(0, 4)).toBe(buf.readUIntBE(0, 4));
        expect(buf.readUintLE(0, 4)).toBe(buf.readUIntLE(0, 4));
        expect(buf.readUint16BE(0)).toBe(buf.readUInt16BE(0));
        expect(buf.readUint16LE(0)).toBe(buf.readUInt16LE(0));
        expect(buf.readUint32BE(0)).toBe(buf.readUInt32BE(0));
        expect(buf.readUint32LE(0)).toBe(buf.readUInt32LE(0));
        expect(buf.readBigUint64BE(0)).toBe(buf.readBigUInt64BE(0));
        expect(buf.readBigUint64LE(0)).toBe(buf.readBigUInt64LE(0));
      });

      it("write alias", () => {
        var buf = new Buffer(1024);
        var buf2 = new Buffer(1024);

        function reset() {
          new Uint8Array(buf.buffer).fill(0);
          new Uint8Array(buf2.buffer).fill(0);
        }

        function shouldBeSame(name, name2, ...args) {
          buf[name].call(buf, ...args);
          buf2[name2].call(buf2, ...args);

          expect(buf).toStrictEqual(buf2);
          reset();
        }

        shouldBeSame("writeUint8", "writeUInt8", 10);
        shouldBeSame("writeUintBE", "writeUIntBE", 10, 0, 4);
        shouldBeSame("writeUintLE", "writeUIntLE", 10, 0, 4);
        shouldBeSame("writeUint16BE", "writeUInt16BE", 1000);
        shouldBeSame("writeUint16LE", "writeUInt16LE", 1000);
        shouldBeSame("writeUint32BE", "writeUInt32BE", 1000);
        shouldBeSame("writeUint32LE", "writeUInt32LE", 1000);
        shouldBeSame("writeBigUint64BE", "writeBigUInt64BE", BigInt(1000));
        shouldBeSame("writeBigUint64LE", "writeBigUInt64LE", BigInt(1000));
      });

      it("construct buffer from UTF16, issue #3914", () => {
        const raw = Buffer.from([0, 104, 0, 101, 0, 108, 0, 108, 0, 111]);
        const data = new Uint16Array(raw);

        const decoder = new TextDecoder("UTF-16");
        const str = decoder.decode(data);
        expect(str).toStrictEqual("\x00h\x00e\x00l\x00l\x00o");

        const buf = Buffer.from(str, "latin1");
        expect(buf).toStrictEqual(raw);
      });

      it("construct buffer from hex, issue #4919", () => {
        const data = "测试63e9f6c4b04fa8c80f3fb0ee";

        const slice1 = data.substring(0, 2);
        const slice2 = data.substring(2);

        const buf1 = Buffer.from(slice1, "hex");
        const buf2 = Buffer.from(slice2, "hex");

        expect(buf1).toStrictEqual(Buffer.from([]));
        expect(buf2).toStrictEqual(
          Buffer.from([0x63, 0xe9, 0xf6, 0xc4, 0xb0, 0x4f, 0xa8, 0xc8, 0x0f, 0x3f, 0xb0, 0xee]),
        );
      });

      it("new Buffer.alloc()", () => {
        const buf = new Buffer.alloc(10);
        expect(buf.length).toBe(10);
        expect(buf[0]).toBe(0);
      });

      it("new Buffer.from()", () => {
        const buf = new Buffer.from("🥶");
        expect(buf.length).toBe(4);
      });
    },
  );
}

export function fillRepeating(dstBuffer, start, end) {
  let len = dstBuffer.length, // important: use indices length, not byte-length
    sLen = end - start,
    p = sLen; // set initial position = source sequence length

  // step 2: copy existing data doubling segment length per iteration
  while (p < len) {
    if (p + sLen > len) sLen = len - p; // if not power of 2, truncate last segment
    dstBuffer.copyWithin(p, start, sLen); // internal copy
    p += sLen; // add current length to offset
    sLen <<= 1; // double length for next segment
  }
}
