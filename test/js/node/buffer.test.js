import { Buffer, SlowBuffer, isAscii, isUtf8, kMaxLength } from "buffer";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gc, isASAN, isDebug, nodeExe, withoutAggressiveGC } from "harness";
import { createHash } from "node:crypto";
import os from "node:os";
import { join } from "node:path";
import vm from "node:vm";

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
 */
const NumberIsInteger = Number.isInteger;
class ERR_INVALID_ARG_TYPE extends TypeError {
  constructor(name, type, value) {
    let inspected;
    if (typeof value === "string") {
      if (value.indexOf("'") === -1) {
        inspected = `'${value}'`;
      } else {
        inspected = `${JSON.stringify(value)}`;
      }
    } else {
      inspected = Bun.inspect(value);
    }
    super(`The "${name}" argument must be of type ${type}. Received type ${typeof value} (${inspected})`);
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
function nodeJSBufferWriteFn(string, offset, length, encoding) {
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

  if (!encoding || encoding === "utf8") return this.utf8Write(string, offset, length);
  if (encoding === "ascii") return this.asciiWrite(string, offset, length);

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
        expect(new isAscii(new Buffer("What did the 🦊 say?"))).toBeFalse();
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
        expect(() => new Uint8Array(2 ** 32 + 1)).toThrow(/Out of memory/);
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
        expect(() => b.write("test", "utf8", 0)).toThrow(
          `The "offset" argument must be of type number. Received type string ('utf8')`,
        );
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

      it("write BigInt beyond 64-bit range", () => {
        const b = Buffer.allocUnsafe(64);
        for (const signedFunction of ["writeBigInt64BE", "writeBigInt64LE"]) {
          expect(() => b[signedFunction](-(2n ** 63n) - 1n)).toThrow(RangeError);
          expect(() => b[signedFunction](2n ** 63n)).toThrow(RangeError);
          expect(() => b[signedFunction](-(2n ** 65n))).toThrow(RangeError);
          expect(() => b[signedFunction](2n ** 65n)).toThrow(RangeError);
        }
        for (const unsignedFunction of ["writeBigUInt64BE", "writeBigUInt64LE"]) {
          expect(() => b[unsignedFunction](-1n)).toThrow(RangeError);
          expect(() => b[unsignedFunction](2n ** 64n)).toThrow(RangeError);
          expect(() => b[unsignedFunction](-(2n ** 65n))).toThrow(RangeError);
          expect(() => b[unsignedFunction](2n ** 65n)).toThrow(RangeError);
        }
      });

      it("write BigInt64 with insufficient buffer space", () => {
        // Test for bounds check fix - prevent unsigned integer underflow
        // when byteLength < 8, the check `offset > byteLength - 8` would underflow
        const buf = Buffer.from("Hello World");
        const slice = buf.slice(0, 5); // 5 bytes

        for (const fn of ["writeBigInt64LE", "writeBigInt64BE", "writeBigUInt64LE", "writeBigUInt64BE"]) {
          // Should throw because we need 8 bytes but only have 5
          expect(() => slice[fn](4096n, 0)).toThrow(RangeError);
          // Should also throw with large invalid offset
          expect(() => slice[fn](4096n, 10000)).toThrow(RangeError);
        }

        // Test exact boundary - 8 bytes should work at offset 0
        const buf8 = Buffer.allocUnsafe(8);
        for (const fn of ["writeBigInt64LE", "writeBigInt64BE", "writeBigUInt64LE", "writeBigUInt64BE"]) {
          expect(buf8[fn](4096n, 0)).toBe(8);
          // But should fail at offset 1 (not enough space)
          expect(() => buf8[fn](4096n, 1)).toThrow(RangeError);
        }

        // Test very small buffers
        const buf7 = Buffer.allocUnsafe(7);
        for (const fn of ["writeBigInt64LE", "writeBigInt64BE", "writeBigUInt64LE", "writeBigUInt64BE"]) {
          expect(() => buf7[fn](0n, 0)).toThrow(RangeError);
        }
      });

      it("write BigInt64 with an out-of-range or non-integer offset throws ERR_OUT_OF_RANGE", () => {
        // Node's boundsError reports a negative offset as ERR_OUT_OF_RANGE
        // (">= 0 and <= max"), not ERR_BUFFER_OUT_OF_BOUNDS.
        const buf = Buffer.alloc(16);
        for (const fn of ["writeBigInt64LE", "writeBigInt64BE", "writeBigUInt64LE", "writeBigUInt64BE"]) {
          expect(() => buf[fn](1n, -1)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              message: 'The value of "offset" is out of range. It must be >= 0 and <= 8. Received -1',
            }),
          );
          // A fractional or NaN offset reports "an integer", even when negative.
          expect(() => buf[fn](1n, -1.5)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              message: 'The value of "offset" is out of range. It must be an integer. Received -1.5',
            }),
          );
          expect(() => buf[fn](1n, NaN)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              message: 'The value of "offset" is out of range. It must be an integer. Received NaN',
            }),
          );
          // +-Infinity are NOT "an integer" to Node's boundsError (its
          // Math.floor(value) !== value test is false for them), so they
          // get the range message instead.
          expect(() => buf[fn](1n, Infinity)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              message: 'The value of "offset" is out of range. It must be >= 0 and <= 8. Received Infinity',
            }),
          );
          expect(() => buf[fn](1n, -Infinity)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              message: 'The value of "offset" is out of range. It must be >= 0 and <= 8. Received -Infinity',
            }),
          );
          // The too-large path is unchanged.
          expect(() => buf[fn](1n, 9)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              message: 'The value of "offset" is out of range. It must be >= 0 and <= 8. Received 9',
            }),
          );
          // A too-short buffer is still ERR_BUFFER_OUT_OF_BOUNDS (matches Node's
          // boundsError when `length < 0`).
          expect(() => Buffer.alloc(7)[fn](1n, 0)).toThrow(
            expect.objectContaining({ code: "ERR_BUFFER_OUT_OF_BOUNDS" }),
          );
          // On a too-short buffer Node still reports the offset's type and
          // integer-ness FIRST, and only then the buffer length.
          expect(() => Buffer.alloc(7)[fn](1n, "x")).toThrow(
            expect.objectContaining({
              name: "TypeError",
              code: "ERR_INVALID_ARG_TYPE",
              message: `The "offset" argument must be of type number. Received type string ('x')`,
            }),
          );
          expect(() => Buffer.alloc(7)[fn](1n, 1.5)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              message: 'The value of "offset" is out of range. It must be an integer. Received 1.5',
            }),
          );
          expect(() => Buffer.alloc(7)[fn](1n, NaN)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              message: 'The value of "offset" is out of range. It must be an integer. Received NaN',
            }),
          );
          // An integer (or +-Infinity) offset on a too-short buffer is still
          // the buffer error: Node's `length < 0` test beats the range message.
          expect(() => Buffer.alloc(7)[fn](1n, -1)).toThrow(
            expect.objectContaining({ code: "ERR_BUFFER_OUT_OF_BOUNDS" }),
          );
          expect(() => Buffer.alloc(7)[fn](1n, Infinity)).toThrow(
            expect.objectContaining({ code: "ERR_BUFFER_OUT_OF_BOUNDS" }),
          );
        }
      });

      it("copy() beyond end of buffer", () => {
        const b = Buffer.allocUnsafe(64);
        // Try to copy 0 bytes worth of data into an empty buffer
        b.copy(Buffer.alloc(0), 0, 0, 0);
        // Try to copy 0 bytes past the end of the target buffer
        b.copy(Buffer.alloc(0), 1, 1, 1);
        b.copy(Buffer.alloc(1), 1, 1, 1);
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

      // https://github.com/oven-sh/bun/issues/31083
      // Per Node docs, `'ascii'` on encode is equivalent to `'latin1'`
      // (verbatim byte copy, not 7-bit masking). Covers write / fill / alloc.
      it("'ascii' encoding preserves high-bit bytes on encode (Node parity)", () => {
        // write()
        const buf = Buffer.alloc(4, 0);
        buf.write(String.fromCharCode(128), 0, "ascii");
        buf.write(String.fromCharCode(129), 1, "ascii");
        buf.write(String.fromCharCode(128), 2, "latin1");
        buf.write(String.fromCharCode(129), 3, "latin1");
        expect([buf[0], buf[1], buf[2], buf[3]]).toEqual([128, 129, 128, 129]);

        // write() with multi-byte Latin-1 input
        const buf2 = Buffer.alloc(4, 0);
        buf2.write(String.fromCharCode(128, 129, 250, 255), 0, "ascii");
        expect([buf2[0], buf2[1], buf2[2], buf2[3]]).toEqual([128, 129, 250, 255]);

        // fill()
        const buf3 = Buffer.alloc(4).fill(String.fromCharCode(128), "ascii");
        expect([buf3[0], buf3[1], buf3[2], buf3[3]]).toEqual([128, 128, 128, 128]);

        // alloc() with fill string
        const buf4 = Buffer.alloc(4, String.fromCharCode(129), "ascii");
        expect([buf4[0], buf4[1], buf4[2], buf4[3]]).toEqual([129, 129, 129, 129]);
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
          console.log(c.toString(encoding), { encoding });
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

      describe("writing with offset undefined", () => {
        [
          ["writeUInt8", "readUInt8", 8, 1],
          ["writeInt8", "readInt8", 8, 1],
          ["writeUInt16LE", "readUInt16LE", 8, 2],
          ["writeInt16LE", "readInt16LE", 8, 2],
          ["writeUInt16BE", "readUInt16BE", 8, 2],
          ["writeInt16BE", "readInt16BE", 8, 2],
          ["writeUInt32LE", "readUInt32LE", 8, 4],
          ["writeInt32LE", "readInt32LE", 8, 4],
          ["writeUInt32BE", "readUInt32BE", 8, 4],
          ["writeInt32BE", "readInt32BE", 8, 4],
          ["writeFloatLE", "readFloatLE", 8, 4],
          ["writeFloatBE", "readFloatBE", 8, 4],
          ["writeDoubleLE", "readDoubleLE", 8, 8],
          ["writeDoubleBE", "readDoubleBE", 8, 8],
        ].forEach(([method, read, value, size]) => {
          it(`${method} (implicit offset)`, () => {
            const b = Buffer.alloc(10, 42);
            expect(b[method](value)).toBe(size);
            expect(b[read]()).toBe(value);
          });

          it(`${method} (explicit offset)`, () => {
            const b = Buffer.alloc(10, 42);
            expect(b[method](value, 0)).toBe(size);
            expect(b[read]()).toBe(value);
          });
        });
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

      // Like Node.js, the base64 and base64url decoders are lenient: both
      // alphabets are accepted, whitespace and any other non-alphabet
      // characters are ignored, and decoding stops at the first '='.
      forEachBase64("lenient decoding skips non-alphabet characters", encoding => {
        expect(Buffer.from("Zm9v\x80YmFy", encoding).toString("latin1")).toBe("foobar");
        expect(Buffer.from("Zm9v*YmFy", encoding).toString("latin1")).toBe("foobar");
        expect(Buffer.from("Zm9v\x00YmFy", encoding).toString("latin1")).toBe("foobar");
        expect(Buffer.from("\xffZm9vYmFy\x03", encoding).toString("latin1")).toBe("foobar");
        expect(Buffer.from(" Z m 9\tv\nY\rm F y ", encoding).toString("latin1")).toBe("foobar");
        expect(Buffer.from(" \n\t ", encoding).length).toBe(0);
        // two-byte strings: code units whose low byte is not in the alphabet are skipped too
        expect(Buffer.from("Zm9v\u0100YmFy", encoding).toString("latin1")).toBe("foobar");
        expect(Buffer.from("Zm9vYmFy\u3000", encoding).toString("latin1")).toBe("foobar");
      });

      // Like Node.js, two-byte (UTF-16) strings are decoded from the low byte
      // of each code unit: a unit like U+013D acts like '=', U+1234 acts like
      // '4', and units whose low byte is not in the alphabet are skipped.
      forEachBase64("two-byte strings decode from the low byte of each code unit", encoding => {
        // \uD83D (first unit of 😀) narrows to 0x3D ('='), which stops decoding
        expect(Buffer.from("QUJD\u{1F600}REVG", encoding).toString("latin1")).toBe("ABC");
        expect(Buffer.from("\u{1F600}QUJDREVG", encoding).length).toBe(0);
        expect(Buffer.from("QUJD\uD83D", encoding).toString("latin1")).toBe("ABC");
        expect(Buffer.from("\u013DZm9v", encoding).length).toBe(0);
        expect(Buffer.from("Zm9vYmFy\u013D", encoding).toString("latin1")).toBe("foobar");

        // U+1234 narrows to 0x34 ('4'), U+0441 narrows to 0x41 ('A'): they contribute data
        expect(Array.from(Buffer.from("\u1234QUJDREVG", encoding))).toStrictEqual([0xe1, 0x05, 0x09, 0x0d, 0x11, 0x15]);
        expect(Buffer.from("Zm9v\u0441YmFy", encoding)).toStrictEqual(Buffer.from("Zm9vAYmFy", encoding));

        // write() and fill() narrow the same way
        {
          const b = Buffer.alloc(8, 0xaa);
          expect(b.write("QUJD\u{1F600}REVG", 0, encoding)).toBe(3);
          expect(b.toString("hex")).toBe("414243aaaaaaaaaa");
        }
        {
          const b = Buffer.alloc(1, 0xaa);
          expect(b.write("YWJj\u3000", 0, encoding)).toBe(1);
          expect(b.toString("hex")).toBe("61");
        }
        expect(Buffer.alloc(6, "QUJD\u{1F600}REVG", encoding).toString("latin1")).toBe("ABCABC");
      });

      forEachBase64("lenient decoding accepts both alphabets in the same input", encoding => {
        expect(Array.from(Buffer.from("-_+/", encoding))).toStrictEqual([0xfb, 0xff, 0xbf]);
        expect(Buffer.from("PDw/Pz8+Pg==", encoding).toString("latin1")).toBe("<<???>>");
        expect(Buffer.from("PDw_Pz8-Pg", encoding).toString("latin1")).toBe("<<???>>");
      });

      forEachBase64("lenient decoding stops at the first '='", encoding => {
        expect(Buffer.from("Zm9v=YmFy", encoding).toString("latin1")).toBe("foo");
        expect(Buffer.from("=Zm9vYmFy", encoding).length).toBe(0);
        expect(Buffer.from("YW55=======", encoding).toString("latin1")).toBe("any");
        expect(Buffer.from("Zm9vYmFy=", encoding).toString("latin1")).toBe("foobar");
        expect(Buffer.from("Zg=", encoding).toString("latin1")).toBe("f");
        // a single leftover character contributes nothing
        expect(Buffer.from("Zm9vYmFyA", encoding).toString("latin1")).toBe("foobar");
      });

      forEachBase64("lenient decoding of long inputs", encoding => {
        const expected = Buffer.alloc(6 * 1024, "foobar").toString("latin1");
        const b64 = Buffer.alloc(8 * 1024, "Zm9vYmFy").toString("latin1");
        expect(Buffer.from(b64, encoding).toString("latin1")).toBe(expected);
        expect(Buffer.from(b64.replace(/(.{64})/g, "$1\n"), encoding).toString("latin1")).toBe(expected);
        expect(Buffer.from(b64.replace(/(.{64})/g, "$1\x85"), encoding).toString("latin1")).toBe(expected);
      });

      forEachBase64("write() only reports bytes actually written", encoding => {
        {
          const b = Buffer.alloc(3, 0xaa);
          expect(b.write("Zm9vYmFy", 0, encoding)).toBe(3);
          expect(b.toString("latin1")).toBe("foo");
        }
        {
          const b = Buffer.alloc(8, 0xaa);
          expect(b.write("Zm9vYmFy", 2, 3, encoding)).toBe(3);
          expect(Array.from(b)).toStrictEqual([0xaa, 0xaa, 0x66, 0x6f, 0x6f, 0xaa, 0xaa, 0xaa]);
        }
        {
          // '=' early in the string: nothing is decoded and nothing is written
          const b = Buffer.alloc(8, 0xaa);
          expect(b.write("Z=m9vYmFy", 0, 3, encoding)).toBe(0);
          expect(Array.from(b)).toStrictEqual(Array(8).fill(0xaa));
        }
        {
          const b = Buffer.alloc(4, 0xaa);
          expect(b.write("QQ==QUJD", 0, encoding)).toBe(1);
          expect(Array.from(b)).toStrictEqual([0x41, 0xaa, 0xaa, 0xaa]);
        }
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

      it("hex input containing byte 0xFF is treated as invalid", () => {
        // hex_table is indexed by the full u8 range; 0xFF must not read out of bounds.
        // latin1 (8-bit) string path
        expect(Buffer.from("\xff\xff", "hex")).toEqual(Buffer.alloc(0));
        expect(Buffer.from("ab\xff\xffcd", "hex")).toEqual(Buffer.from([0xab]));
        // 16-bit string path (U+0100 forces two-byte storage, U+00FF still <= 0xFF)
        expect(Buffer.from("ab\xff\xff\u0100", "hex")).toEqual(Buffer.from([0xab]));

        const buf = Buffer.alloc(4);
        expect(buf.write("ab\xff\xffcd", "hex")).toBe(1);
        expect(buf).toEqual(Buffer.from([0xab, 0, 0, 0]));
      });

      // The hex decoder takes a SIMD path once the input has at least 16 byte
      // pairs and falls back to scalar code for short inputs, vector tails and
      // the block containing the first invalid character. These tests sweep the
      // boundaries of those blocks against a plain JS reference decoder.
      describe("hex decoding around SIMD block boundaries", () => {
        const hexDigitValue = c => {
          if (c >= 0x30 && c <= 0x39) return c - 0x30;
          if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
          if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
          return -1;
        };
        const referenceHexDecode = (str, maxBytes = Infinity) => {
          const out = [];
          for (let i = 0; i + 1 < str.length && out.length < maxBytes; i += 2) {
            const hi = hexDigitValue(str.charCodeAt(i));
            const lo = hexDigitValue(str.charCodeAt(i + 1));
            if (hi < 0 || lo < 0) break;
            out.push((hi << 4) | lo);
          }
          return Buffer.from(out);
        };
        // deterministic pattern covering all byte values, with mixed case
        const patternHex = pairs => {
          let s = "";
          for (let i = 0; i < pairs; i++) {
            const byte = (i * 7 + 13) & 0xff;
            const hex = byte.toString(16).padStart(2, "0");
            s += i % 3 === 0 ? hex.toUpperCase() : hex;
          }
          return s;
        };
        // keeps only ASCII hex characters but forces two-byte string storage
        const toUTF16 = s => (s + "\u0100").slice(0, -1);

        it("decodes valid input at every length around the vector widths", () => {
          for (const pairs of [15, 16, 17, 31, 32, 33, 48, 63, 64, 65, 127, 128, 129, 255, 256, 1024]) {
            for (const extraChar of ["", "a"]) {
              // `extraChar` leaves a trailing lone digit that must be ignored
              const hex = patternHex(pairs) + extraChar;
              const expected = referenceHexDecode(hex);
              expect(expected.length).toBe(pairs);

              const fromLatin1 = Buffer.from(hex, "hex");
              expect(fromLatin1).toEqual(expected);

              const fromUTF16 = Buffer.from(toUTF16(hex), "hex");
              expect(fromUTF16).toEqual(expected);
            }
          }
        });

        it("stops at an invalid character at any position", () => {
          const pairs = 80; // several vector blocks on every target
          for (const bad of ["x", "g", "G", ":", "@", "/", " ", "\x00", "\x80", "\xff"]) {
            for (let pos = 0; pos < pairs * 2; pos += 7) {
              const chars = patternHex(pairs).split("");
              chars[pos] = bad;
              const hex = chars.join("");
              const expected = referenceHexDecode(hex);
              expect(expected.length).toBe(Math.floor(pos / 2));
              expect(Buffer.from(hex, "hex")).toEqual(expected);
              expect(Buffer.from(toUTF16(hex), "hex")).toEqual(expected);
            }
          }
        });

        it("treats UTF-16 code units above 0xFF as invalid even when their low byte is a hex digit", () => {
          // U+0130, U+0141, U+3061, U+FF41 truncate to '0', 'A', 'a', 'A' — the
          // decoder must reject them rather than decode the truncated byte.
          const pairs = 64;
          for (const bad of ["\u0130", "\u0141", "\u3061", "\uff41"]) {
            for (const pos of [0, 1, 31, 32, 63, 64, 97, 126, 127]) {
              const chars = patternHex(pairs).split("");
              chars[pos] = bad;
              const hex = chars.join("");
              const expected = referenceHexDecode(hex);
              expect(expected.length).toBe(Math.floor(pos / 2));
              expect(Buffer.from(hex, "hex")).toEqual(expected);
            }
          }
        });

        it("buf.write() with long hex input respects the destination length", () => {
          const pairs = 100;
          const hex = patternHex(pairs);
          const expected = referenceHexDecode(hex);

          // exact fit
          const exact = Buffer.alloc(pairs);
          expect(exact.write(hex, "hex")).toBe(pairs);
          expect(exact).toEqual(expected);

          // destination smaller than the input: truncated, remaining bytes untouched
          const small = Buffer.alloc(40, 0xaa);
          expect(small.write(hex, 3, "hex")).toBe(37);
          expect(small.subarray(0, 3)).toEqual(Buffer.from([0xaa, 0xaa, 0xaa]));
          expect(small.subarray(3)).toEqual(expected.subarray(0, 37));

          // destination larger than the input
          const large = Buffer.alloc(pairs + 10, 0xbb);
          expect(large.write(hex, "hex")).toBe(pairs);
          expect(large.subarray(0, pairs)).toEqual(expected);
          expect(large.subarray(pairs)).toEqual(Buffer.alloc(10, 0xbb));

          // 16-bit string path
          const utf16Target = Buffer.alloc(pairs);
          expect(utf16Target.write(toUTF16(hex), "hex")).toBe(pairs);
          expect(utf16Target).toEqual(expected);
        });
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

      it("slice() with fractional offsets truncates toward zero", () => {
        const buf = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

        // -0.1 should truncate to 0, not -1
        const a = buf.slice(-0.1);
        expect(a.length).toBe(10);
        expect(a[0]).toBe(0);

        // -1.9 should truncate to -1, not -2
        const b = buf.slice(-1.9);
        expect(b.length).toBe(1);
        expect(b[0]).toBe(9);

        // 1.9 should truncate to 1
        const c = buf.slice(1.9, 4.1);
        expect(c.length).toBe(3);
        expect(c[0]).toBe(1);
        expect(c[1]).toBe(2);
        expect(c[2]).toBe(3);

        // NaN should be treated as 0
        const d = buf.slice(NaN, NaN);
        expect(d.length).toBe(0);

        const e = buf.slice(NaN);
        expect(e.length).toBe(10);
      });

      it("slice() on detached buffer throws TypeError", () => {
        const ab = new ArrayBuffer(10);
        const buf = Buffer.from(ab);
        // Detach the ArrayBuffer by transferring it
        structuredClone(ab, { transfer: [ab] });
        expect(() => buf.slice(0, 5)).toThrow(TypeError);
      });

      it("subarray() on detached buffer throws TypeError", () => {
        const ab = new ArrayBuffer(10);
        const buf = Buffer.from(ab);
        structuredClone(ab, { transfer: [ab] });
        expect(() => buf.subarray(0, 5)).toThrow(TypeError);
      });

      it("slice() on resizable ArrayBuffer returns fixed-length view", () => {
        const rab = new ArrayBuffer(10, { maxByteLength: 20 });
        const buf = Buffer.from(rab);
        buf[0] = 1;
        buf[1] = 2;
        buf[2] = 3;
        buf[3] = 4;
        buf[4] = 5;

        const sliced = buf.slice(0, 5);
        expect(sliced.length).toBe(5);
        expect(sliced[0]).toBe(1);
        expect(sliced[4]).toBe(5);

        // Growing the buffer should NOT change the slice length
        rab.resize(20);
        expect(sliced.length).toBe(5);
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
        expect(b.writeInt8(0, 2)).toBe(3);
        expect(b.writeUInt8(0, 2)).toBe(3);
        expect(b.writeInt16LE(0, 2)).toBe(4);
        expect(b.writeInt16BE(0, 2)).toBe(4);
        expect(b.writeUInt16LE(0, 2)).toBe(4);
        expect(b.writeUInt16BE(0, 2)).toBe(4);
        expect(b.writeInt32LE(0, 2)).toBe(6);
        expect(b.writeInt32BE(0, 2)).toBe(6);
        expect(b.writeUInt32LE(0, 2)).toBe(6);
        expect(b.writeUInt32BE(0, 2)).toBe(6);
        expect(b.writeFloatLE(0, 2)).toBe(6);
        expect(b.writeFloatBE(0, 2)).toBe(6);
        expect(b.writeDoubleLE(0, 2)).toBe(10);
        expect(b.writeDoubleBE(0, 2)).toBe(10);
        expect(b.writeBigInt64LE(0n, 2)).toBe(10);
        expect(b.writeBigInt64BE(0n, 2)).toBe(10);
        expect(b.writeBigUInt64LE(0n, 2)).toBe(10);
        expect(b.writeBigUInt64BE(0n, 2)).toBe(10);
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

      it("fill(N, empty string) should be the same as fill(N) and not include any uninitialized bytes", () => {
        expect(Buffer.alloc(100, "")).toEqual(Buffer.alloc(100));
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
        const a = Buffer.alloc(1);
        const b = Buffer.alloc(1);
        expect(() => a.copy(b, 0, 0x100000000, 0x100000001)).toThrowWithCode(RangeError, "ERR_OUT_OF_RANGE");
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
        expect(Buffer.prototype.toLocaleString).toBe(Buffer.prototype.toString);
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

      it("Buffer.byteLength matches the encoder for unpaired surrogates", () => {
        // byteLength used simdutf's non-validating UTF-16 length, which charges
        // an unpaired surrogate 2 bytes; the encoder writes U+FFFD (3 bytes).
        // byteLength(s) === Buffer.from(s).length must hold by definition.
        const cases = [
          "\ud800",
          "\udfff",
          "\ud800a",
          "a\ud800",
          "\ud800a".repeat(17),
          "\ud800\udc00",
          "a\udc00\ud800b",
        ];
        expect(cases.map(s => ({ input: JSON.stringify(s), byteLength: Buffer.byteLength(s, "utf8") }))).toEqual(
          cases.map(s => ({ input: JSON.stringify(s), byteLength: Buffer.from(s, "utf8").length })),
        );
        expect(Buffer.byteLength("\ud800a".repeat(17), "utf8")).toBe(68);
        // TextEncoder shares the same length helper and must agree.
        expect(new TextEncoder().encode("\ud800a".repeat(17)).byteLength).toBe(68);
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

        // Node copies min(encodedLength, fillLength) raw bytes of the
        // pattern's encoding (node_buffer.cc `Fill`): a pattern longer than
        // the destination is cut mid code unit, not restarted on a boundary.
        it("byte-truncates a ucs2 pattern longer than the destination", () => {
          // "abc" encodes to 61 00 62 00 63 00
          expect(Array.from(Buffer.alloc(3, "abc", "ucs2"))).toEqual([0x61, 0x00, 0x62]);
          expect(Array.from(Buffer.alloc(5, "abc", "ucs2"))).toEqual([0x61, 0x00, 0x62, 0x00, 0x63]);
          expect(Array.from(Buffer.alloc(1, "abc", "ucs2"))).toEqual([0x61]);
          expect(Array.from(Buffer.alloc(3, "abc", "utf16le"))).toEqual([0x61, 0x00, 0x62]);
          expect(Array.from(Buffer.alloc(3).fill("abc", "ucs2"))).toEqual([0x61, 0x00, 0x62]);
          // an odd start offset exercises the unaligned destination path
          expect(Array.from(Buffer.alloc(6).fill("abc", 1, 6, "ucs2"))).toEqual([0x00, 0x61, 0x00, 0x62, 0x00, 0x63]);
          // a two-byte source string (U+0101 forces UTF-16 storage) agrees
          expect(Array.from(Buffer.alloc(3, "\u0101bc", "ucs2"))).toEqual([0x01, 0x01, 0x62]);
          // when the pattern fits, it still repeats
          expect(Array.from(Buffer.alloc(7, "abc", "ucs2"))).toEqual([0x61, 0x00, 0x62, 0x00, 0x63, 0x00, 0x61]);
          expect(Array.from(Buffer.alloc(8, "ab", "ucs2"))).toEqual([0x61, 0x00, 0x62, 0x00, 0x61, 0x00, 0x62, 0x00]);
        });

        it("byte-truncates a utf8 pattern longer than the destination", () => {
          // "a\xe9" encodes to 61 c3 a9
          expect(Array.from(Buffer.alloc(2, "a\xe9"))).toEqual([0x61, 0xc3]);
          expect(Array.from(Buffer.alloc(1, "\xe9\xe9"))).toEqual([0xc3]);
          // when the pattern fits, it still repeats
          expect(Array.from(Buffer.alloc(3, "a\xe9"))).toEqual([0x61, 0xc3, 0xa9]);
          expect(Array.from(Buffer.alloc(4, "a\xe9"))).toEqual([0x61, 0xc3, 0xa9, 0x61]);
        });

        // A lone high surrogate encodes as U+FFFD (ef bf bd), the same as
        // every other UTF-16 -> UTF-8 path in Node. It is not an error.
        it("encodes a lone high surrogate as U+FFFD in fill and write", () => {
          expect(Array.from(Buffer.alloc(4, "\ud800"))).toEqual([0xef, 0xbf, 0xbd, 0xef]);
          expect(Array.from(Buffer.alloc(3, "\ud800"))).toEqual([0xef, 0xbf, 0xbd]);
          expect(Array.from(Buffer.alloc(2, "\ud800"))).toEqual([0xef, 0xbf]);
          expect(Array.from(Buffer.alloc(4).fill("\ud800"))).toEqual([0xef, 0xbf, 0xbd, 0xef]);
          const b = Buffer.alloc(4);
          expect(b.write("\ud800")).toBe(3);
          expect(Array.from(b)).toEqual([0xef, 0xbf, 0xbd, 0x00]);
        });
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

      it("indexOf/lastIndexOf/includes on an empty buffer", () => {
        // An empty haystack is not an automatic -1: Node still finds an
        // empty needle in it at offset 0.
        const empty = Buffer.alloc(0);
        expect(empty.indexOf(Buffer.alloc(0))).toBe(0);
        expect(empty.lastIndexOf(Buffer.alloc(0))).toBe(0);
        expect(empty.includes(Buffer.alloc(0))).toBe(true);
        expect(empty.indexOf("")).toBe(0);
        expect(empty.lastIndexOf("")).toBe(0);
        expect(empty.includes("")).toBe(true);
        // byteOffset is clamped to [0, length] for an empty needle.
        expect(empty.indexOf("", 5)).toBe(0);
        expect(empty.indexOf("", -5)).toBe(0);
        // A non-empty needle in an empty haystack is still -1.
        expect(empty.indexOf("a")).toBe(-1);
        expect(empty.indexOf(Buffer.from("a"))).toBe(-1);
        expect(empty.indexOf(97)).toBe(-1);
        expect(empty.lastIndexOf(97)).toBe(-1);
        expect(empty.includes(97)).toBe(false);
        // A non-empty haystack with an empty needle was already correct.
        expect(Buffer.from("ab").indexOf(Buffer.alloc(0))).toBe(0);
        expect(Buffer.from("ab").indexOf(Buffer.alloc(0), 5)).toBe(2);
        expect(Buffer.from("ab").lastIndexOf("")).toBe(2);
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

        expect(b.indexOf("f", 5)).toBe(5);
        expect(b.indexOf("d", 2)).toBe(3);
        expect(b.indexOf("f", -1)).toBe(5);
        expect(b.indexOf("f", 6)).toBe(-1);

        expect(b.indexOf(100, 2)).toBe(3);
        expect(b.indexOf(102, 5)).toBe(5);
        expect(b.indexOf(102, -1)).toBe(5);
        expect(b.indexOf(102, 6)).toBe(-1);
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

      it("lastIndexOf/indexOf(Buffer, negativeOffset, 'ucs2') wraps against the raw byte length on odd-length haystacks", () => {
        // Node's IndexOfBuffer wraps a negative byteOffset against the full byte
        // length and only then floors to 16-bit units; truncating to even first
        // makes `-byteLength` land before the start and miss present data.
        const h3 = Buffer.from("bbc", "latin1"); // <62 62 63>
        const n = Buffer.from("bb", "latin1"); // <62 62>
        for (const enc of ["ucs2", "utf16le"]) {
          expect(h3.lastIndexOf(n, -3, enc)).toBe(0);
          expect(h3.lastIndexOf(n, -2, enc)).toBe(0);
          expect(h3.lastIndexOf(n, 0, enc)).toBe(0);
          expect(h3.lastIndexOf(n, -4, enc)).toBe(-1);
          expect(h3.indexOf(n, -3, enc)).toBe(0);
          expect(h3.indexOf(n, -2, enc)).toBe(-1);
          expect(h3.indexOf(n, -1, enc)).toBe(-1);
          expect(h3.indexOf(n, 1, enc)).toBe(-1);
        }

        // Even-length haystack is unchanged.
        expect(Buffer.from("bbcc", "latin1").lastIndexOf(n, -4, "ucs2")).toBe(0);

        // 5-byte haystack: the wrapped offset must also floor to the correct
        // 16-bit unit so the rightmost match is found.
        const h5 = Buffer.from([0x62, 0x62, 0x62, 0x62, 0x63]);
        expect(h5.lastIndexOf(n, -5, "ucs2")).toBe(0);
        expect(h5.lastIndexOf(n, -3, "ucs2")).toBe(2);
        expect(h5.lastIndexOf(n, -6, "ucs2")).toBe(-1);
        // Odd-length needle: only the whole 16-bit unit participates.
        const n3 = Buffer.from([0x62, 0x62, 0x62]);
        expect(h5.lastIndexOf(n3, -5, "ucs2")).toBe(0);
        expect(h5.lastIndexOf(n3, 0, "ucs2")).toBe(0);

        // Empty Buffer needle on an odd-length haystack: the clamped result
        // must reflect the raw-byte wrap, bounded by the even search end.
        const empty = Buffer.alloc(0);
        expect(h3.lastIndexOf(empty, -3, "ucs2")).toBe(0);
        expect(h3.lastIndexOf(empty, -1, "ucs2")).toBe(2);
        expect(h3.lastIndexOf(empty, 3, "ucs2")).toBe(2);
        expect(h3.lastIndexOf(empty, undefined, "ucs2")).toBe(2);

        // 1-byte haystack has no 16-bit units.
        const h1 = Buffer.from([0x62]);
        expect(h1.lastIndexOf(n, 0, "ucs2")).toBe(-1);
        expect(h1.lastIndexOf(n, -1, "ucs2")).toBe(-1);
        expect(h1.lastIndexOf(empty, 0, "ucs2")).toBe(0);

        // String needles: Node's IndexOfString truncates the haystack length to
        // even BEFORE wrapping (unlike IndexOfBuffer), so -byteLength on an
        // odd-length haystack is before the start.
        const sn = "\u6262"; // encodes as <62 62> in ucs2
        expect(h3.lastIndexOf(sn, -3, "ucs2")).toBe(-1);
        expect(h3.lastIndexOf(sn, -2, "ucs2")).toBe(0);
        expect(h5.lastIndexOf(sn, -5, "ucs2")).toBe(-1);
        expect(h5.lastIndexOf(sn, -3, "ucs2")).toBe(0);
      });

      it("lastIndexOf(value, encoding) defaults to searching from the end", () => {
        // When the second argument is an encoding string (no byteOffset), the
        // search must start from the end of the buffer, matching Node.js.
        const b = Buffer.from("ello hello hello");
        expect(b.lastIndexOf("hello", "utf8")).toBe(11);
        expect(b.lastIndexOf("hello", "latin1")).toBe(11);
        expect(b.lastIndexOf("hello", "binary")).toBe(11);

        const b16 = Buffer.from("ello hello hello", "utf16le");
        expect(b16.lastIndexOf("hello", "utf16le")).toBe(22);
        expect(b16.lastIndexOf("hello", "ucs2")).toBe(22);

        const bhex = Buffer.from("aabbccaabbcc", "hex");
        expect(bhex.lastIndexOf("aabb", "hex")).toBe(3);

        const bb64 = Buffer.from("Zm9vYmFyZm9v", "base64");
        expect(bb64.lastIndexOf("Zm9v", "base64")).toBe(6);

        // Forward indexOf with the same overload must remain 0-based.
        expect(b.indexOf("hello", "utf8")).toBe(5);
        expect(b.includes("hello", "utf8")).toBe(true);

        // Explicit byteOffset still works.
        expect(b.lastIndexOf("hello", 8, "utf8")).toBe(5);
      });

      it("indexOf(value, encoding) is unchanged by the lastIndexOf fix", () => {
        // The lastIndexOf fix routes the encoding-as-2nd-arg case through the
        // direction-aware default. For forward indexOf/includes that default is
        // 0, so these must keep returning the FIRST match from offset 0. The
        // buffer repeats "hello" so a regression that searched from the end
        // would return 12 instead of 0.
        const b = Buffer.from("hello world hello");
        expect(b.indexOf("hello", "utf8")).toBe(0);
        expect(b.indexOf("hello", "latin1")).toBe(0);
        expect(b.indexOf("hello", "binary")).toBe(0);
        expect(b.indexOf("hello", "ascii")).toBe(0);
        expect(b.includes("hello", "utf8")).toBe(true);
        expect(b.indexOf("zzz", "utf8")).toBe(-1);
        expect(b.indexOf("o", "utf8")).toBe(4);

        const b16 = Buffer.from("hello world hello", "utf16le");
        expect(b16.indexOf("hello", "utf16le")).toBe(0);
        expect(b16.indexOf("hello", "ucs2")).toBe(0);
        expect(b16.includes("hello", "utf16le")).toBe(true);

        const bhex = Buffer.from("aabbccaabbcc", "hex");
        expect(bhex.indexOf("aabb", "hex")).toBe(0);
        expect(bhex.includes("aabb", "hex")).toBe(true);

        const bb64 = Buffer.from("Zm9vYmFyZm9v", "base64");
        expect(bb64.indexOf("Zm9v", "base64")).toBe(0);
        expect(bb64.includes("Zm9v", "base64")).toBe(true);

        // A 3-arg indexOf(value, byteOffset, encoding) still skips forward.
        expect(b.indexOf("hello", 1, "utf8")).toBe(12);

        // A non-string 2nd arg is a byteOffset, not an encoding: these go
        // through the other branch and must also be unchanged.
        const abc = Buffer.from("abcdef");
        expect(abc.indexOf("b", undefined)).toBe(1);
        expect(abc.indexOf("b", null)).toBe(1);
        expect(abc.indexOf("b", {})).toBe(1);
        expect(abc.indexOf("b", [])).toBe(1);
      });

      it("indexOf/lastIndexOf with an explicit byteOffset are unchanged by the fix", () => {
        // When a numeric byteOffset is supplied (with or without a trailing
        // encoding), both methods take the non-string branch that the fix does
        // NOT touch. The needle repeats ("hello" at 0 and 12, "o" at 4/7/16) so
        // the offset genuinely selects which occurrence is returned.
        const b = Buffer.from("hello world hello");

        // indexOf(value, byteOffset): searches forward from the offset.
        expect(b.indexOf("hello", 0)).toBe(0);
        expect(b.indexOf("hello", 1)).toBe(12);
        expect(b.indexOf("hello", 12)).toBe(12);
        expect(b.indexOf("hello", 13)).toBe(-1);
        expect(b.indexOf("hello", -5)).toBe(12); // negative counts from the end
        expect(b.indexOf("o", 5)).toBe(7);
        expect(b.indexOf("o", 8)).toBe(16);

        // indexOf(value, byteOffset, encoding): same, with an explicit encoding.
        expect(b.indexOf("hello", 1, "utf8")).toBe(12);
        expect(b.indexOf("hello", 0, "latin1")).toBe(0);

        // lastIndexOf(value, byteOffset): searches backward from the offset.
        expect(b.lastIndexOf("hello", -1)).toBe(12);
        expect(b.lastIndexOf("hello", 11)).toBe(0);
        expect(b.lastIndexOf("hello", 12)).toBe(12);
        expect(b.lastIndexOf("hello", 0)).toBe(0);
        expect(b.lastIndexOf("o", 6)).toBe(4);
        expect(b.lastIndexOf("o", 100)).toBe(16); // past the end is clamped

        // lastIndexOf(value, byteOffset, encoding): same, with an encoding.
        expect(b.lastIndexOf("hello", 11, "utf8")).toBe(0);
        expect(b.lastIndexOf("hello", 16, "utf8")).toBe(12);

        // utf16le: the byteOffset is in bytes ("hello" starts at byte 0 and 24).
        const b16 = Buffer.from("hello world hello", "utf16le");
        expect(b16.indexOf("hello", 2, "ucs2")).toBe(24);
        expect(b16.lastIndexOf("hello", 22, "ucs2")).toBe(0);
      });

      it("lastIndexOf with utf16le only matches on a code-unit boundary", () => {
        // UCS2 searches operate on whole uint16_t units (Node's SearchString<uint16_t>),
        // so a raw byte match at an ODD offset is not a real match. The needle
        // "a" is bytes [0x61, 0x00]; they occur here only at byte offset 1.
        const h = Buffer.from([0x00, 0x61, 0x00, 0x00]);
        expect(h.lastIndexOf(Buffer.from("a", "utf16le"), undefined, "utf16le")).toBe(-1);
        expect(h.lastIndexOf("a", undefined, "utf16le")).toBe(-1);
        // The forward search was already uint16-aligned.
        expect(h.indexOf("a", 0, "utf16le")).toBe(-1);
        // An even-offset match is still found.
        const h2 = Buffer.from("ba", "utf16le");
        expect(h2.lastIndexOf("a", undefined, "utf16le")).toBe(2);
        expect(h2.lastIndexOf(Buffer.from("a", "utf16le"), undefined, "utf16le")).toBe(2);
        // byteOffset is floored to a code-unit boundary.
        const h3 = Buffer.from("aaaa", "utf16le");
        expect(h3.lastIndexOf("a", 5, "utf16le")).toBe(4);
        expect(h3.lastIndexOf("a", 3, "utf16le")).toBe(2);
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
          expect(exception.code).toBe("ERR_INVALID_BUFFER_SIZE");
          expect(exception).toBeInstanceOf(RangeError);
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
          expect(exception.code).toBe("ERR_INVALID_BUFFER_SIZE");
          expect(exception).toBeInstanceOf(RangeError);
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
          expect(exception.code).toBe("ERR_INVALID_BUFFER_SIZE");
          expect(exception).toBeInstanceOf(RangeError);
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
        expect(BufferModule.constants.MAX_STRING_LENGTH).toBe(2147483647);
        expect(BufferModule.default.constants.MAX_LENGTH).toBe(4294967296);
        expect(BufferModule.default.constants.MAX_STRING_LENGTH).toBe(2147483647);
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
        expect(buf.parent, buf.buffer);
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

        expect(function () {
          function AB() {}
          Object.setPrototypeOf(AB, ArrayBuffer);
          Object.setPrototypeOf(AB.prototype, ArrayBuffer.prototype);
          Buffer.from(new AB());
        }).toThrow();

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

      it("fill() with a fractional offset or end throws ERR_OUT_OF_RANGE", () => {
        // Node routes offset/end through validateOffset (= validateInteger),
        // so a non-integer throws instead of being silently truncated.
        expect(() => Buffer.alloc(4, "x").fill("a", 1.5)).toThrow(
          expect.objectContaining({
            code: "ERR_OUT_OF_RANGE",
            message: 'The value of "offset" is out of range. It must be an integer. Received 1.5',
          }),
        );
        expect(() => Buffer.alloc(4, "x").fill("a", 0, 1.5)).toThrow(
          expect.objectContaining({
            code: "ERR_OUT_OF_RANGE",
            message: 'The value of "end" is out of range. It must be an integer. Received 1.5',
          }),
        );
        expect(() => Buffer.alloc(4, "x").fill("a", NaN)).toThrow(
          expect.objectContaining({
            code: "ERR_OUT_OF_RANGE",
            message: 'The value of "offset" is out of range. It must be an integer. Received NaN',
          }),
        );
        // Integer offsets still work and still range-check.
        expect(Buffer.alloc(4, "x").fill("a", 3).toString()).toBe("xxxa");
        expect(() => Buffer.alloc(4).fill("a", -1)).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
        expect(() => Buffer.alloc(4).fill("a", 0, 5)).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
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
        const arrayBuf = vm.runInNewContext("new ArrayBuffer()");
        expect(Buffer.byteLength(arrayBuf)).toBe(0);

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

        // start >= end short-circuits to "" before the range check, as in Node.
        expect(buf.latin1Slice(4, 1)).toStrictEqual("");
        expect(buf.latin1Slice(4, 0)).toStrictEqual("");

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
        expect(() => latin1Slice.call(buf, 3, 999999)).toThrow(RangeError);

        expect(latin1Slice.call(buf, 4, 1)).toStrictEqual("");
        expect(latin1Slice.call(buf, 4, 0)).toStrictEqual("");

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

      // Regression test: large buffers that would produce strings exceeding max string length
      it("Buffer.hexSlice() throws for large buffers", () => {
        const { MAX_STRING_LENGTH } = require("buffer").constants;
        // Hex output is 2x input size, so buffer size > MAX_STRING_LENGTH/2 will overflow
        const largeBuffer = Buffer.allocUnsafe(Math.floor(MAX_STRING_LENGTH / 2) + 1);
        expect(() => largeBuffer.hexSlice()).toThrow(
          `Cannot create a string longer than ${MAX_STRING_LENGTH} characters`,
        );
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
        shouldBeSame("writeBigUint64BE", "writeBigUInt64BE", 1000n);
        shouldBeSame("writeBigUint64LE", "writeBigUInt64LE", 1000n);
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

describe("serialization", () => {
  it("json", () => {
    expect(JSON.stringify(Buffer.alloc(0))).toBe('{"type":"Buffer","data":[]}');
    expect(JSON.stringify(Buffer.from([1, 2, 3, 4]))).toBe('{"type":"Buffer","data":[1,2,3,4]}');
  });

  it("and deserialization", () => {
    const buf = Buffer.from("test");
    const json = JSON.stringify(buf);
    const obj = JSON.parse(json);
    const copy = Buffer.from(obj);
    expect(copy).toEqual(buf);
  });

  it("custom", () => {
    const buffer = Buffer.from("test");
    const string = JSON.stringify(buffer);
    expect(string).toBe('{"type":"Buffer","data":[116,101,115,116]}');

    const receiver = (key, value) => (value && value.type === "Buffer" ? Buffer.from(value.data) : value);
    expect(JSON.parse(string, receiver)).toEqual(buffer);
  });
});

it("should not trim utf-8 start bytes at end of string", () => {
  // always worked
  const buf1 = Buffer.from("e136e1", "hex");
  expect(buf1.toString("utf-8")).toEqual("\uFFFD6\uFFFD");
  // bugged
  const buf2 = Buffer.from("36e1", "hex");
  expect(buf2.toString("utf-8")).toEqual("6\uFFFD");
});

it("Buffer.from(arrayBuffer)", () => {
  const ab = Buffer.from([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]).buffer;
  const buf = Buffer.from(ab);
  expect(buf.length).toBe(10);
  expect(buf.buffer).toBe(ab);
  expect(buf.byteOffset).toBe(0);
  expect(buf.byteLength).toBe(10);
  expect(buf[Symbol.iterator]().toArray()).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
});
it("Buffer.from(arrayBuffer, byteOffset)", () => {
  const ab = Buffer.from([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]).buffer;
  const buf = Buffer.from(ab, 2);
  expect(buf.length).toBe(8);
  expect(buf.buffer).toBe(ab);
  expect(buf.byteOffset).toBe(2);
  expect(buf.byteLength).toBe(8);
  expect(buf[Symbol.iterator]().toArray()).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
});
it("Buffer.from(arrayBuffer, byteOffset, length)", () => {
  const ab = Buffer.from([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]).buffer;
  const buf = Buffer.from(ab, 3, 5);
  expect(buf.length).toBe(5);
  expect(buf.buffer).toBe(ab);
  expect(buf.byteOffset).toBe(3);
  expect(buf.byteLength).toBe(5);
  expect(buf[Symbol.iterator]().toArray()).toEqual([13, 14, 15, 16, 17]);
});

describe("Buffer.from(arrayBuffer, byteOffset, length) bounds", () => {
  it("clamps NaN and non-positive lengths to 0", () => {
    const ab = new ArrayBuffer(16);
    const cases = [
      [ab, 4, -1],
      [ab, 4, -100],
      [ab, 0, -Infinity],
      [ab, 0, -0],
      [ab, 0, "-5"],
      [ab, 0, NaN],
      [ab, 16, -1],
      [ab, undefined, -1],
      [ab, 4, { valueOf: () => -1 }],
      [new SharedArrayBuffer(16), 4, -1],
    ];
    const lengths = cases.map(args => {
      try {
        return Buffer.from(...args).length;
      } catch (e) {
        return e.code;
      }
    });
    expect(lengths).toEqual(cases.map(() => 0));
    // the byteOffset is still respected
    expect(Buffer.from(ab, 4, -1).byteOffset).toBe(4);
    // deprecated constructor form takes the same path
    expect(new Buffer(ab, 4, -1).length).toBe(0);
  });

  it("throws ERR_BUFFER_OUT_OF_BOUNDS for positive lengths past the end", () => {
    const ab = new ArrayBuffer(16);
    expect(() => Buffer.from(ab, 0, 17)).toThrowWithCode(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS");
    expect(() => Buffer.from(ab, 8, 9)).toThrowWithCode(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS");
    expect(() => Buffer.from(ab, 0, Infinity)).toThrowWithCode(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS");
    // Node compares the un-truncated length against the remaining capacity
    expect(() => Buffer.from(ab, 0, 16.5)).toThrowWithCode(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS");
    expect(Buffer.from(ab, 0, 16).length).toBe(16);
    expect(Buffer.from(ab, 0, 15.5).length).toBe(15);
    expect(Buffer.from(ab, 8, 8).length).toBe(8);
    // ... and that capacity is computed from the un-truncated offset
    expect(() => Buffer.from(ab, 0.5, 16)).toThrowWithCode(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS");
    expect(() => Buffer.from(ab, 15.5, 1)).toThrowWithCode(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS");
    expect(Buffer.from(ab, 0.5, 15).length).toBe(15);
    const fractional = Buffer.from(ab, 3.5, 12);
    expect([fractional.byteOffset, fractional.length]).toEqual([3, 12]);
  });

  it("throws ERR_BUFFER_OUT_OF_BOUNDS for offsets past the end", () => {
    const ab = new ArrayBuffer(16);
    expect(() => Buffer.from(ab, 17)).toThrowWithCode(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS");
    expect(() => Buffer.from(ab, Infinity)).toThrowWithCode(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS");
    // Node compares the un-truncated offset against byteLength
    expect(() => Buffer.from(ab, 16.5)).toThrowWithCode(RangeError, "ERR_BUFFER_OUT_OF_BOUNDS");
    expect(() => Buffer.from(ab, -1)).toThrow(RangeError);
    expect(Buffer.from(ab, 16).length).toBe(0);
    // (-1, 0] truncates to a zero offset
    expect(Buffer.from(ab, -0.5).length).toBe(16);
  });

  it("honors an explicit length on a resizable ArrayBuffer", () => {
    const rab = new ArrayBuffer(8, { maxByteLength: 32 });
    const fixed = Buffer.from(rab, 0, 4);
    const clamped = Buffer.from(rab, 4, -1);
    const tracking = Buffer.from(rab, 4);
    expect([fixed.length, clamped.length, clamped.byteOffset, tracking.length]).toEqual([4, 0, 4, 4]);
    rab.resize(32);
    // only the no-length form is a length-tracking view
    expect([fixed.length, clamped.length, tracking.length]).toEqual([4, 0, 28]);
  });

  it("honors an explicit length on a growable SharedArrayBuffer", () => {
    const gsab = new SharedArrayBuffer(8, { maxByteLength: 32 });
    const fixed = Buffer.from(gsab, 0, 4);
    const tracking = Buffer.from(gsab);
    gsab.grow(32);
    expect([fixed.length, tracking.length]).toEqual([4, 32]);
  });
});

describe("ERR_BUFFER_OUT_OF_BOUNDS", () => {
  for (const method of ["writeBigInt64BE", "writeBigInt64LE", "writeBigUInt64BE", "writeBigUInt64LE"]) {
    for (const bufferLength of [0, 1, 2, 3, 4, 5, 6]) {
      const buffer = Buffer.allocUnsafe(bufferLength);
      it(`Buffer(${bufferLength}).${method}`, () => {
        expect(() => buffer[method](0n)).toThrow(
          expect.objectContaining({
            code: "ERR_BUFFER_OUT_OF_BOUNDS",
          }),
        );
        expect(() => buffer[method](0n, 0)).toThrow(
          expect.objectContaining({
            code: "ERR_BUFFER_OUT_OF_BOUNDS",
          }),
        );
      });
    }
  }

  for (const method of ["readBigInt64BE", "readBigInt64LE", "readBigUInt64BE", "readBigUInt64LE"]) {
    for (const bufferLength of [0, 1, 2, 3, 4, 5, 6]) {
      const buffer = Buffer.allocUnsafe(bufferLength);
      it(`Buffer(${bufferLength}).${method}`, () => {
        expect(() => buffer[method]()).toThrow(
          expect.objectContaining({
            code: "ERR_BUFFER_OUT_OF_BOUNDS",
          }),
        );
        expect(() => buffer[method](0)).toThrow(
          expect.objectContaining({
            code: "ERR_BUFFER_OUT_OF_BOUNDS",
          }),
        );
      });
    }
  }
});

// Node's _fill (lib/buffer.js) only reinterprets a string `offset`/`end` as
// the encoding when the fill value is itself a string; otherwise they reach
// validateOffset and a non-number throws ERR_INVALID_ARG_TYPE. And `end` is
// only read at all once `offset` is present.
describe("Buffer.fill offset/end argument handling", () => {
  it("rejects a string offset when the fill value is not a string", () => {
    for (const value of [0, true, new Uint8Array([1])]) {
      expect(() => Buffer.alloc(5).fill(value, "1", 3)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
          message: `The "offset" argument must be of type number. Received type string ('1')`,
        }),
      );
      // Two-argument form: a string in the offset slot is not an encoding either.
      expect(() => Buffer.alloc(5).fill(value, "hex")).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          message: `The "offset" argument must be of type number. Received type string ('hex')`,
        }),
      );
    }
    expect(() => Buffer.alloc(5).fill(0, null, 3)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: 'The "offset" argument must be of type number. Received null',
      }),
    );
  });

  it("rejects a string end when the fill value is not a string", () => {
    for (const value of [0, true, new Uint8Array([1])]) {
      expect(() => Buffer.alloc(5).fill(value, 1, "3")).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
          message: `The "end" argument must be of type number. Received type string ('3')`,
        }),
      );
    }
    expect(() => Buffer.alloc(5).fill(0, 1, null)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: 'The "end" argument must be of type number. Received null',
      }),
    );
  });

  it("ignores end entirely when offset is undefined", () => {
    // Node resets end = buf.length when offset === undefined; end is never
    // validated, so even an otherwise invalid value there is accepted.
    expect(Array.from(Buffer.alloc(5, 0xaa).fill(0, undefined, 3))).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(Buffer.alloc(5, 0xaa).fill(0, undefined, "3"))).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(Buffer.alloc(5, 0xaa).fill(0, undefined, -1))).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(Buffer.alloc(5, 0xaa).fill(0, undefined, null))).toEqual([0, 0, 0, 0, 0]);
  });

  it("discards end when a string value's offset slot holds the encoding", () => {
    // fill(value, encoding) has no end slot, so anything there is ignored.
    expect(Buffer.alloc(5, 0xaa).fill("b", "utf8", 3).toString()).toBe("bbbbb");
    expect(Buffer.alloc(5, 0xaa).fill("b", undefined, 3).toString()).toBe("bbbbb");
    // An explicit numeric offset keeps end meaningful.
    expect(Array.from(Buffer.alloc(5, 0xaa).fill("b", 1, 3))).toEqual([0xaa, 0x62, 0x62, 0xaa, 0xaa]);
  });

  it("still treats a string offset/end as the encoding when the value is a string", () => {
    expect(Buffer.alloc(4, 0xaa).fill("ab", "utf16le").toString("hex")).toBe("61006200");
    expect(Buffer.alloc(4, 0xaa).fill("ab", 0, "utf16le").toString("hex")).toBe("61006200");
    expect(() => Buffer.alloc(4).fill("a", "bogus")).toThrow(expect.objectContaining({ code: "ERR_UNKNOWN_ENCODING" }));
    expect(() => Buffer.alloc(4).fill("a", 0, "bogus")).toThrow(
      expect.objectContaining({ code: "ERR_UNKNOWN_ENCODING" }),
    );
  });

  it("never treats the 4-argument encoding as meaningful for a non-string value", () => {
    expect(Array.from(Buffer.alloc(5, 0xaa).fill(0, 1, 3, "bogus"))).toEqual([0xaa, 0, 0, 0xaa, 0xaa]);
  });

  it("zero-fills the whole buffer when called with no arguments", () => {
    // Node forwards the undefined value into the numeric path, which coerces to 0.
    expect(Array.from(Buffer.alloc(3, 0xaa).fill())).toEqual([0, 0, 0]);
    expect(Array.from(Buffer.alloc(3, 0xaa).fill(undefined))).toEqual([0, 0, 0]);
  });

  it("ignores positional arguments past the fourth", () => {
    expect(Array.from(Buffer.alloc(5, 0xaa).fill(0, 1, 3, "utf8", "x"))).toEqual([0xaa, 0, 0, 0xaa, 0xaa]);
    expect(Buffer.alloc(5, 0xaa).fill("ab", 0, 4, "utf16le", "x").toString("hex")).toBe("61006200aa");
  });

  it("lets an undefined offset shadow an explicit 4th-argument encoding, like Node", () => {
    // Node's _fill assigns `encoding = offset` whenever offset is undefined or
    // a string, so fill(str, undefined, ..., encoding) falls back to utf8 and a
    // bogus 4th-argument encoding is never even validated.
    expect(Buffer.alloc(4, 0xaa).fill("ab", undefined, undefined, "utf16le").toString("hex")).toBe("61626162");
    expect(Buffer.alloc(4, 0xaa).fill("a", undefined, undefined, "bogus").toString("hex")).toBe("61616161");
    // With a numeric offset the explicit encoding is honored.
    expect(Buffer.alloc(4, 0xaa).fill("ab", 0, undefined, "utf16le").toString("hex")).toBe("61006200");
    expect(() => Buffer.alloc(4).fill("a", 1, undefined, "bogus")).toThrow(
      expect.objectContaining({ code: "ERR_UNKNOWN_ENCODING" }),
    );
  });

  it("treats a null or empty-string encoding like an absent one, as Node's normalizeEncoding does", () => {
    // normalizeEncoding returns utf8 for exactly undefined, null, and "".
    expect(Buffer.alloc(5, 0xaa).fill("a", 1, 3, null).toString("hex")).toBe("aa6161aaaa");
    expect(Buffer.alloc(5, 0xaa).fill("a", 1, 3, "").toString("hex")).toBe("aa6161aaaa");
    // A string "" in the offset or end slot becomes the encoding first, then
    // that encoding is treated as absent.
    expect(Buffer.alloc(5, 0xaa).fill("a", "").toString("hex")).toBe("6161616161");
    expect(Buffer.alloc(5, 0xaa).fill("a", 1, "").toString("hex")).toBe("aa61616161");
    expect(Buffer.alloc(3, "a", null).toString("hex")).toBe("616161");
    expect(Buffer.alloc(3, "a", "").toString("hex")).toBe("616161");
    // toString goes through Node's getEncodingOps, not normalizeEncoding, so a
    // null or empty-string encoding there is still ERR_UNKNOWN_ENCODING. Pins
    // that the handling lives at the fill/alloc gates, not inside parseEncoding.
    expect(() => Buffer.from("ab").toString(null)).toThrow(expect.objectContaining({ code: "ERR_UNKNOWN_ENCODING" }));
    expect(() => Buffer.from("ab").toString("")).toThrow(expect.objectContaining({ code: "ERR_UNKNOWN_ENCODING" }));
    // A String object is not a string primitive, so it is not "absent".
    expect(() => Buffer.alloc(3, "a", new String(""))).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });

  // Bun coerces an object encoding via toString (Node rejects a non-string
  // encoding up front with ERR_INVALID_ARG_TYPE instead). An exception thrown
  // from that toString must surface, not degrade to an empty or null string.
  it("propagates an exception thrown from an object encoding's toString", () => {
    const boom = {
      toString() {
        throw new Error("boom");
      },
    };
    expect(() => Buffer.alloc(4, 0xaa).fill("a", 0, 4, boom)).toThrow("boom");
    expect(() => Buffer.alloc(4, "a", boom)).toThrow("boom");
  });

  // Differential test: the fixture enumerates every fill() argument shape and
  // prints the resulting bytes or the thrown error class + code. Running it
  // under Node.js and under Bun must produce byte-identical output.
  it.skipIf(!nodeExe())("every fill() argument shape produces the same output in Node.js and Bun", async () => {
    const fixture = join(import.meta.dir, "buffer-fill-args-fixture.js");
    async function run(exe) {
      await using proc = Bun.spawn({ cmd: [exe, fixture], env: bunEnv, stdout: "pipe" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return { stdout, exitCode };
    }
    const [bunRun, nodeRun] = await Promise.all([run(bunExe()), run(nodeExe())]);
    expect(nodeRun.stdout).toContain("fill(");
    expect(bunRun.stdout).toBe(nodeRun.stdout);
    expect(nodeRun.exitCode).toBe(0);
    expect(bunRun.exitCode).toBe(0);
  });
});

describe("*Write methods with NaN/invalid offset and length", () => {
  // Regression test: NaN offset/length values must be handled safely.
  // NaN offset should be treated as 0, and length should be clamped to buffer size.
  // This matches Node.js behavior where V8's IntegerValue converts NaN to 0.
  const writeMethods = [
    "utf8Write",
    "utf16leWrite",
    "latin1Write",
    "asciiWrite",
    "base64Write",
    "base64urlWrite",
    "hexWrite",
  ];

  for (const method of writeMethods) {
    it(`${method} should handle NaN offset and custom length via ToNumber coercion`, () => {
      // F1 is a function - ToNumber(F1) returns NaN, which should be treated as 0
      function F1() {
        if (!new.target) {
          throw "must be called with new";
        }
      }
      // C3 is a class constructor with Symbol.toPrimitive - ToNumber(C3) returns 215
      class C3 {}
      C3[Symbol.toPrimitive] = function () {
        return 215;
      };
      const buf = Buffer.from("string");
      // F1 as offset -> NaN -> 0, C3 as length -> 215 -> clamped to buf.length
      // This should NOT crash, and should write to the buffer starting at offset 0
      const result = buf[method]("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", F1, C3);
      // Result should be clamped to buffer size
      expect(result).toBeLessThanOrEqual(buf.length);
    });
  }

  // Node only put utf8/latin1/ascii behind the strict JS wrapper that rejects an
  // oversized length; the remaining encodings are still the raw C++ binding.
  for (const method of ["utf8Write", "latin1Write", "asciiWrite"]) {
    it(`${method} should throw on length larger than available buffer space`, () => {
      const buf = Buffer.from("string");
      // Length 1000 with valid offset 0 should throw ERR_BUFFER_OUT_OF_BOUNDS
      expect(() => buf[method]("test".repeat(100), 0, 1000)).toThrow(
        expect.objectContaining({
          code: "ERR_BUFFER_OUT_OF_BOUNDS",
        }),
      );
    });
  }

  for (const method of ["utf16leWrite", "ucs2Write", "base64Write", "base64urlWrite", "hexWrite"]) {
    it(`${method} should clamp length larger than available buffer space`, () => {
      const buf = Buffer.from("string");
      const written = buf[method]("test".repeat(100), 0, 1000);
      expect(written).toBeLessThanOrEqual(buf.length);
    });
  }
});

// These raw prototype methods come straight from Node's C++ bindings, not from the
// documented toString()/write() wrappers, and they have looser bounds rules:
// https://github.com/nodejs/node/blob/v26.3.0/src/node_buffer.cc
describe("raw <enc>Slice / <enc>Write bindings match Node", () => {
  const OUT_OF_RANGE = expect.objectContaining({ code: "ERR_OUT_OF_RANGE", message: "Index out of range" });
  const OUT_OF_BOUNDS = expect.objectContaining({ code: "ERR_BUFFER_OUT_OF_BOUNDS" });

  const sliceMethods = [
    "utf8Slice",
    "latin1Slice",
    "asciiSlice",
    "ucs2Slice",
    "utf16leSlice",
    "base64Slice",
    "base64urlSlice",
    "hexSlice",
  ];
  // "hello!", 6 bytes.
  const hello = () => Buffer.from("68656c6c6f21", "hex");

  describe("<enc>Slice", () => {
    it.each(sliceMethods)('%s returns "" when start >= end, without a range check', method => {
      const buf = hello();
      expect(buf[method](6)).toBe("");
      expect(buf[method](7)).toBe("");
      expect(buf[method](7, 3)).toBe("");
      expect(buf[method](7, 7)).toBe("");
      expect(buf[method](3, 1)).toBe("");
      expect(buf[method](1e9)).toBe("");
      expect(buf[method](2 ** 53)).toBe("");
      expect(buf[method](2 ** 64)).toBe("");
      expect(buf[method](Infinity)).toBe("");
      expect(buf[method](0, NaN)).toBe("");
    });

    it.each(sliceMethods)("%s still throws when end is past the end of the buffer", method => {
      const buf = hello();
      expect(() => buf[method](0, 7)).toThrow(OUT_OF_RANGE);
      expect(() => buf[method](2, 1e9)).toThrow(OUT_OF_RANGE);
      expect(() => buf[method](6, 1e9)).toThrow(OUT_OF_RANGE);
      expect(() => buf[method](0, Infinity)).toThrow(OUT_OF_RANGE);
    });

    it.each(sliceMethods)("%s treats NaN as 0 and rejects negative indexes", method => {
      const buf = hello();
      expect(buf[method](NaN)).toBe(buf[method]());
      expect(buf[method](-0)).toBe(buf[method]());
      expect(() => buf[method](-1)).toThrow(OUT_OF_RANGE);
      expect(() => buf[method](-Infinity)).toThrow(OUT_OF_RANGE);
      expect(() => buf[method](0, -1)).toThrow(OUT_OF_RANGE);
    });

    it("decodes the same ranges Node decodes", () => {
      const buf = hello();
      expect(buf.hexSlice()).toBe("68656c6c6f21");
      expect(buf.hexSlice(2)).toBe("6c6c6f21");
      expect(buf.hexSlice(0, 2)).toBe("6865");
      expect(buf.hexSlice(5, 6)).toBe("21");
      expect(buf.utf8Slice(1.9)).toBe("ello!");
      expect(buf.utf8Slice("2", "4")).toBe("ll");
    });

    it("the documented toString() wrapper is unchanged", () => {
      const buf = hello();
      expect(buf.toString("hex", 7)).toBe("");
      expect(buf.toString("hex", 7, 3)).toBe("");
      expect(buf.toString("hex", 0, 1e9)).toBe("68656c6c6f21");
    });

    // Both <enc>Slice and toString() read byteLength before coercing their indexes, so a
    // valueOf() that shrinks a resizable buffer leaves the range stale. Spawned because an
    // unclamped range aborts a debug build rather than throwing.
    it.each(["hexSlice", "toString"])("%s clamps the range when valueOf() shrinks the buffer", async method => {
      const read = method === "toString" ? `buf.toString("hex", 0, shrink)` : `buf.hexSlice(0, shrink)`;
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const ab = new ArrayBuffer(9, { maxByteLength: 9 });
           const buf = Buffer.from(ab);
           buf.fill(0x41);
           const shrink = { valueOf() { ab.resize(2); return 9; } };
           console.log(JSON.stringify({ read: ${read}, length: buf.length }));`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // Surface stderr so an abort diagnostic shows up in the diff if the assert regresses.
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: `{"read":"4141","length":2}`,
        stderr: expect.any(String),
        exitCode: 0,
      });
    });
  });

  describe("<enc>Write", () => {
    // Node's utf8Write/latin1Write/asciiWrite go through a JS wrapper that rejects an
    // out-of-range length; base64/base64url/hex/ucs2 stay on the clamping C++ binding.
    const strict = ["utf8Write", "latin1Write", "asciiWrite"];
    const clamping = ["ucs2Write", "utf16leWrite", "base64Write", "base64urlWrite", "hexWrite"];
    const source = {
      utf8Write: "hello",
      latin1Write: "hello",
      asciiWrite: "hello",
      ucs2Write: "hello",
      utf16leWrite: "hello",
      base64Write: "aGVsbG8=",
      base64urlWrite: "aGVsbG8",
      hexWrite: "68656c6c6f",
    };
    // 9 bytes of 0xcc, so offset 6 leaves 3 bytes of room.
    const dest = () => Buffer.alloc(9, 0xcc);
    const untouched = "cccccccccccccccccc";

    it.each(clamping)("%s clamps an oversized length to the space left", method => {
      const expected = {
        ucs2Write: { written: 2, hex: "cccccccccccc6800cc" },
        utf16leWrite: { written: 2, hex: "cccccccccccc6800cc" },
        base64Write: { written: 3, hex: "cccccccccccc68656c" },
        base64urlWrite: { written: 3, hex: "cccccccccccc68656c" },
        hexWrite: { written: 3, hex: "cccccccccccc68656c" },
      };
      const buf = dest();
      const written = buf[method](source[method], 6, 1000);
      expect({ written, hex: buf.toString("hex") }).toEqual(expected[method]);
    });

    it.each(clamping)("%s writes nothing when no space is left", method => {
      const buf = dest();
      expect(buf[method](source[method], 9, 1)).toBe(0);
      expect(buf.toString("hex")).toBe(untouched);
    });

    it.each(clamping)("%s reports a negative offset or length as ERR_OUT_OF_RANGE", method => {
      const buf = dest();
      expect(() => buf[method](source[method], -1)).toThrow(OUT_OF_RANGE);
      expect(() => buf[method](source[method], -1, 2)).toThrow(OUT_OF_RANGE);
      expect(() => buf[method](source[method], 0, -1)).toThrow(OUT_OF_RANGE);
      expect(buf.toString("hex")).toBe(untouched);
    });

    it.each(strict)("%s rejects an oversized length with ERR_BUFFER_OUT_OF_BOUNDS", method => {
      const buf = dest();
      expect(() => buf[method](source[method], 6, 1000)).toThrow(OUT_OF_BOUNDS);
      expect(() => buf[method](source[method], 9, 1)).toThrow(OUT_OF_BOUNDS);
      expect(() => buf[method](source[method], -1)).toThrow(OUT_OF_BOUNDS);
      expect(() => buf[method](source[method], 0, -1)).toThrow(OUT_OF_BOUNDS);
      expect(buf.toString("hex")).toBe(untouched);
    });

    it.each([...strict, ...clamping])("%s rejects an offset past the end of the buffer", method => {
      const buf = dest();
      expect(() => buf[method](source[method], 10)).toThrow(OUT_OF_BOUNDS);
      expect(() => buf[method](source[method], 10, 1)).toThrow(OUT_OF_BOUNDS);
      expect(() => buf[method](source[method], Infinity)).toThrow(OUT_OF_BOUNDS);
      expect(() => buf[method](source[method], 2 ** 53, 1)).toThrow(OUT_OF_BOUNDS);
      expect(buf.toString("hex")).toBe(untouched);
    });

    it.each(strict)("%s with a NaN offset and no length writes nothing", method => {
      // The wrapper's default length is `byteLength - offset`, i.e. NaN, which truncates to 0.
      const buf = dest();
      expect(buf[method](source[method], NaN)).toBe(0);
      expect(buf.toString("hex")).toBe(untouched);
    });

    it.each(clamping)("%s with a NaN offset and no length writes from offset 0", method => {
      const expected = {
        ucs2Write: { written: 8, hex: "680065006c006c00cc" },
        utf16leWrite: { written: 8, hex: "680065006c006c00cc" },
        base64Write: { written: 5, hex: "68656c6c6fcccccccc" },
        base64urlWrite: { written: 5, hex: "68656c6c6fcccccccc" },
        hexWrite: { written: 5, hex: "68656c6c6fcccccccc" },
      };
      const buf = dest();
      const written = buf[method](source[method], NaN);
      expect({ written, hex: buf.toString("hex") }).toEqual(expected[method]);
    });

    it.each([...strict, ...clamping])("%s with a NaN length writes nothing", method => {
      const buf = dest();
      expect(buf[method](source[method], 0, NaN)).toBe(0);
      expect(buf.toString("hex")).toBe(untouched);
    });

    it("the documented write() wrapper is unchanged", () => {
      const buf = dest();
      expect(() => buf.write("hello", 6, 1000)).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
      expect(buf.write("hello", 6)).toBe(3);
      expect(buf.toString("hex")).toBe("cccccccccccc68656c");
    });

    // A detaching valueOf on the offset or length argument is the one case that runs user JS;
    // the binding re-checks detachment there and must not write into freed memory.
    it.each(["offset", "length"])("%s throws when a detaching valueOf runs mid-coercion", async which => {
      const args = which === "offset" ? `detach, 5` : `0, detach`;
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const buf = Buffer.from(new ArrayBuffer(9));
           const detach = { valueOf() { structuredClone(buf.buffer, { transfer: [buf.buffer] }); return 5; } };
           try { buf.hexWrite("68656c", ${args}); console.log("NO THROW"); }
           catch (e) { console.log(e.constructor.name); }`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: "TypeError",
        stderr: expect.any(String),
        exitCode: 0,
      });
    });

    it("clamps when a length valueOf shrinks a resizable buffer", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const ab = new ArrayBuffer(9, { maxByteLength: 9 });
           const buf = Buffer.from(ab);
           const shrink = { valueOf() { ab.resize(2); return 1000; } };
           const written = buf.hexWrite("68656c6c6f", 0, shrink);
           console.log(JSON.stringify({ written, length: buf.length }));`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // 2 bytes left after the shrink, so only one byte-pair is written.
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: `{"written":2,"length":2}`,
        stderr: expect.any(String),
        exitCode: 0,
      });
    });
  });
});

describe("Buffer.copyBytesFrom", () => {
  it("copies the correct bytes from a Uint8Array view with a non-zero byteOffset", () => {
    const ab = new ArrayBuffer(10);
    const full = new Uint8Array(ab);
    for (let i = 0; i < 10; i++) full[i] = i;

    // byteOffset (2) < byteLength (6)
    const view = new Uint8Array(ab, 2, 6);
    const buf = Buffer.copyBytesFrom(view);
    expect([...buf]).toEqual([2, 3, 4, 5, 6, 7]);

    // ensure it's an independent copy
    full[2] = 0xff;
    expect(buf[0]).toBe(2);
  });

  it("handles a view where byteOffset > byteLength without underflowing", () => {
    const ab = new ArrayBuffer(10);
    const full = new Uint8Array(ab);
    for (let i = 0; i < 10; i++) full[i] = i;

    // byteOffset (6) > byteLength (4) -> previously underflowed to ~SIZE_MAX and threw OOM
    const view = new Uint8Array(ab, 6, 4);
    const buf = Buffer.copyBytesFrom(view);
    expect([...buf]).toEqual([6, 7, 8, 9]);
  });

  it("copies the correct bytes from a multi-byte TypedArray view with a non-zero byteOffset", () => {
    const ab = new ArrayBuffer(16);
    const full = new Uint8Array(ab);
    for (let i = 0; i < 16; i++) full[i] = i;

    const view = new Uint16Array(ab, 8, 4); // bytes 8..15
    const buf = Buffer.copyBytesFrom(view);
    expect([...buf]).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
  });
});

describe("Buffer.prototype.toString binary-to-text encodings", () => {
  // Reference implementations (scalar, independent of Bun's native encoders) so
  // the SIMD/bulk paths for hex and base64 are checked byte-for-byte, including
  // vector-width boundaries and the scalar tail.
  const HEX_PAIRS = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));
  function hexReference(buf) {
    const parts = new Array(buf.length);
    for (let i = 0; i < buf.length; i++) {
      parts[i] = HEX_PAIRS[buf[i]];
    }
    return parts.join("");
  }

  const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function base64Reference(buf) {
    const parts = [];
    let i = 0;
    for (; i + 2 < buf.length; i += 3) {
      const n = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
      parts.push(
        B64_ALPHABET[(n >> 18) & 63] +
          B64_ALPHABET[(n >> 12) & 63] +
          B64_ALPHABET[(n >> 6) & 63] +
          B64_ALPHABET[n & 63],
      );
    }
    const remaining = buf.length - i;
    if (remaining === 1) {
      const n = buf[i] << 16;
      parts.push(B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + "==");
    } else if (remaining === 2) {
      const n = (buf[i] << 16) | (buf[i + 1] << 8);
      parts.push(B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + "=");
    }
    return parts.join("");
  }

  function base64urlReference(buf) {
    return base64Reference(buf).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }

  // Deterministic bytes covering all 256 values with no short repeating period.
  function fillPattern(buf, seed = 0x9e3779b9) {
    let state = seed >>> 0;
    for (let i = 0; i < buf.length; i++) {
      // xorshift32
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      buf[i] = state & 0xff;
    }
    return buf;
  }

  it("toString('hex') matches the reference at SIMD width boundaries", () => {
    withoutAggressiveGC(() => {
      // Cover every length around 8/16/32/64/128-byte chunk boundaries plus the
      // threshold where the bulk kernel takes over from the scalar loop.
      const sizes = [];
      for (let size = 0; size <= 130; size++) sizes.push(size);
      for (const boundary of [192, 256, 512, 1024]) sizes.push(boundary - 1, boundary, boundary + 1);

      for (const size of sizes) {
        const buf = fillPattern(Buffer.alloc(size), 0x12345678 + size);
        expect(buf.toString("hex")).toBe(hexReference(buf));
      }
    });
  });

  it("toString('hex') on unaligned subarray views matches the reference", () => {
    withoutAggressiveGC(() => {
      const parent = fillPattern(Buffer.alloc(4096 + 16));
      for (const offset of [1, 3, 7, 9, 15]) {
        const view = parent.subarray(offset, offset + 4096);
        expect(view.toString("hex")).toBe(hexReference(view));
      }
      // Range arguments go through the same encoder.
      expect(parent.toString("hex", 5, 3000)).toBe(hexReference(parent.subarray(5, 3000)));
    });
  });

  it("toString('hex'/'base64'/'base64url') is byte-exact for a large buffer", () => {
    withoutAggressiveGC(() => {
      // The whole-string SHA-256 digests below were cross-checked against
      // Node.js and against the pure-JS reference encoders above for this
      // exact deterministic buffer.
      const buf = fillPattern(Buffer.alloc(110000));
      const hex = buf.toString("hex");
      const base64 = buf.toString("base64");
      const base64url = buf.toString("base64url");

      expect(hex.length).toBe(220000);
      expect(base64.length).toBe(146668);
      expect(base64url.length).toBe(146667);

      // Head slices compared against the scalar reference give a readable diff
      // if the bulk path breaks; 3000 bytes = 1000 complete base64 blocks.
      expect(hex.slice(0, 2 * 3000)).toBe(hexReference(buf.subarray(0, 3000)));
      expect(base64.slice(0, 4000)).toBe(base64Reference(buf.subarray(0, 3000)));
      expect(base64url.slice(0, 4000)).toBe(base64urlReference(buf.subarray(0, 3000)));
      expect(buf.hexSlice(0, 3000)).toBe(hexReference(buf.subarray(0, 3000)));

      expect(createHash("sha256").update(hex).digest("hex")).toBe(
        "8f48a2a797f617a898da5661349a9279c19107be7341ad6693ab46e627908d6e",
      );
      expect(createHash("sha256").update(base64).digest("hex")).toBe(
        "13b33d6ad0580d09c649be335d52f11f85641beea65ccdac79974bf77b4d19ce",
      );
      expect(createHash("sha256").update(base64url).digest("hex")).toBe(
        "85f9f3844442bfab913e2d15c015a9551b9f5ea958f1fa2cbb528538c0b25894",
      );

      // Round-trips decode back to the original bytes.
      expect(Buffer.from(hex, "hex").equals(buf)).toBe(true);
      expect(Buffer.from(base64, "base64").equals(buf)).toBe(true);
      expect(Buffer.from(base64url, "base64url").equals(buf)).toBe(true);
    });
  });

  // Hex-encoder throughput guard. Baseline is a same-output-size latin1 copy
  // so both sides pay identical allocation costs (allocator-agnostic): scalar
  // hex is ~5x that, SIMD ~1.3x, so 3x separates the regimes. Skip debug/ASAN.
  it.skipIf(isDebug || isASAN)(
    "toString('hex') large-buffer throughput stays within 3x of a same-size latin1 copy",
    async () => {
      const script = `
      const buf = Buffer.alloc(110000);
      const ref = Buffer.alloc(buf.length * 2);
      for (let i = 0; i < ref.length; i++) ref[i] = i & 0x7f;
      let state = 0x9e3779b9 >>> 0;
      for (let i = 0; i < buf.length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        buf[i] = state & 0xff;
      }
      const sample = fn => {
        Bun.gc(true);
        const start = Bun.nanoseconds();
        fn();
        return Bun.nanoseconds() - start;
      };
      const median = times => times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)];
      for (let i = 0; i < 5; i++) {
        buf.toString("hex");
        ref.toString("latin1");
      }
      const hexTimes = [];
      const latin1Times = [];
      for (let i = 0; i < 13; i++) {
        latin1Times.push(sample(() => ref.toString("latin1")));
        hexTimes.push(sample(() => buf.toString("hex")));
      }
      console.log(JSON.stringify({ hex: median(hexTimes), latin1: median(latin1Times) }));
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, BUN_GARBAGE_COLLECTOR_LEVEL: "0" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);

      const { hex, latin1 } = JSON.parse(stdout.trim());
      expect(hex).toBeLessThan(3 * latin1);
    },
  );

  it("toString('base64') and toString('base64url') match the reference for small buffers", () => {
    withoutAggressiveGC(() => {
      // 0..66 covers every `length % 3` padding shape on both sides of the
      // 64-byte boundary.
      for (let size = 0; size <= 66; size++) {
        const buf = fillPattern(Buffer.alloc(size), 0xabcdef01 + size);
        expect(buf.toString("base64")).toBe(base64Reference(buf));
        expect(buf.toString("base64url")).toBe(base64urlReference(buf));
      }
    });
  });
});

// MAX_LENGTH is 2**32 on 64-bit: a buffer of exactly that length must not
// hit the uint32 truncation path that made toString()/write() see length 0.
it.skipIf(os.totalmem() < 10 * 1024 ** 3)(
  "Buffer of length exactly MAX_LENGTH (2**32) supports toString/write without uint32 wrap",
  async () => {
    const script = `
      const assert = require("assert");
      const N = 2 ** 32;
      const b = Buffer.alloc(N);
      assert.strictEqual(b.length, N);
      b.set([0x71, 0x72, 0x73], N - 3);

      const out = {};
      for (const enc of ["latin1", "utf8", "hex", "base64", "ucs2"]) {
        try { b.toString(enc); out["full_" + enc] = "no throw"; }
        catch (e) { out["full_" + enc] = e.code; }
      }
      out.ranged_latin1 = b.toString("latin1", N - 4, N);
      out.ranged_hex = b.toString("hex", N - 4, N);
      out.ranged_utf8_start0 = b.toString("utf8", 0, 3);
      out.write_ret = b.write("xyz", N - 3);
      out.after_write = b.toString("latin1", N - 3, N);
      out.write_enc_ret = b.write("ab", N - 2, "latin1");
      out.after_write_enc = b.toString("latin1", N - 2, N);
      out.write_full = b.write("hi");
      try { b.write("x", N + 1); out.write_oob = "no throw"; }
      catch (e) { out.write_oob = e.code; }
      console.log(JSON.stringify(out));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, BUN_GARBAGE_COLLECTOR_LEVEL: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({
      stdout: JSON.stringify({
        full_latin1: "ERR_STRING_TOO_LONG",
        full_utf8: "ERR_STRING_TOO_LONG",
        full_hex: "ERR_STRING_TOO_LONG",
        full_base64: "ERR_STRING_TOO_LONG",
        full_ucs2: "ERR_STRING_TOO_LONG",
        ranged_latin1: "\x00qrs",
        ranged_hex: "00717273",
        ranged_utf8_start0: "\x00\x00\x00",
        write_ret: 3,
        after_write: "xyz",
        write_enc_ret: 2,
        after_write_enc: "ab",
        write_full: 2,
        write_oob: "ERR_OUT_OF_RANGE",
      }),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);
