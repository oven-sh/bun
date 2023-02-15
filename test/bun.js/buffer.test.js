import { describe, it, expect, beforeEach, afterEach, test } from "bun:test";
import { gc } from "./gc";

const BufferModule = await import("buffer");

beforeEach(() => gc());
afterEach(() => gc());

function assert(a) {
  expect(a).toBeTruthy();
}

Object.assign(assert, {
  ok(a) {
    expect(a).toBeTruthy();
  },
  deepStrictEqual(a, b) {
    expect(b).toStrictEqual(a);
  },
  strictEqual(a, b) {
    expect(a).toBe(b);
  },
  throws(a, b) {
    expect(a).toThrow();
  },
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

it("Buffer.alloc", () => {
  // Verify the maximum Uint8Array size. There is no concrete limit by spec. The
  // internal limits should be updated if this fails.
  assert.throws(() => new Uint8Array(2 ** 32 + 1), {
    message: "Invalid typed array length: 4294967297",
  });

  const b = Buffer.allocUnsafe(1024);
  assert.strictEqual(b.length, 1024);

  b[0] = -1;
  assert.strictEqual(b[0], 255);

  for (let i = 0; i < 1024; i++) {
    b[i] = i % 256;
  }

  for (let i = 0; i < 1024; i++) {
    assert.strictEqual(i % 256, b[i]);
  }

  const c = Buffer.allocUnsafe(512);
  assert.strictEqual(c.length, 512);

  const d = Buffer.from([]);
  assert.strictEqual(d.length, 0);

  // Test offset properties
  {
    const b = Buffer.alloc(128);
    assert.strictEqual(b.length, 128);
    assert.strictEqual(b.byteOffset, 0);
    assert.strictEqual(b.offset, 0);
  }

  // Test creating a Buffer from a Uint32Array
  {
    const ui32 = new Uint32Array(4).fill(42);
    const e = Buffer.from(ui32);
    for (const [index, value] of e.entries()) {
      assert.strictEqual(value, ui32[index]);
    }
  }
  // Test creating a Buffer from a Uint32Array (old constructor)
  {
    const ui32 = new Uint32Array(4).fill(42);
    const e = Buffer(ui32);
    for (const [key, value] of e.entries()) {
      assert.deepStrictEqual(value, ui32[key]);
    }
  }

  // Test invalid encoding for Buffer.toString
  assert.throws(() => b.toString("invalid"), /Unknown encoding: invalid/);
  // Invalid encoding for Buffer.write
  assert.throws(() => b.write("test string", 0, 5, "invalid"), /Unknown encoding: invalid/);
  // Unsupported arguments for Buffer.write
  // assert.throws(() => b.write("test", "utf8", 0), {
  // code: "ERR_INVALID_ARG_TYPE",
  // });

  // Try to create 0-length buffers. Should not throw.
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

  const outOfRangeError = {
    code: "ERR_OUT_OF_RANGE",
    name: "RangeError",
  };

  // Try to write a 0-length string beyond the end of b
  // assert.throws(() => b.write("", 2048), outOfRangeError);

  // // Throw when writing to negative offset
  // assert.throws(() => b.write("a", -1), outOfRangeError);

  // // Throw when writing past bounds from the pool
  // assert.throws(() => b.write("a", 2048), outOfRangeError);

  // // Throw when writing to negative offset
  // assert.throws(() => b.write("a", -1), outOfRangeError);

  // Try to copy 0 bytes worth of data into an empty buffer
  b.copy(Buffer.alloc(0), 0, 0, 0);

  // Try to copy 0 bytes past the end of the target buffer
  b.copy(Buffer.alloc(0), 1, 1, 1);
  b.copy(Buffer.alloc(1), 1, 1, 1);

  // Try to copy 0 bytes from past the end of the source buffer
  b.copy(Buffer.alloc(1), 0, 2048, 2048);

  // Testing for smart defaults and ability to pass string values as offset
  {
    const writeTest = Buffer.from("abcdes");
    writeTest.write("n", "ascii");
    assert.throws(() => writeTest.write("o", "1", "ascii"), {
      code: "ERR_INVALID_ARG_TYPE",
    });
    writeTest.write("o", 1, "ascii");
    writeTest.write("d", 2, "ascii");
    writeTest.write("e", 3, "ascii");
    writeTest.write("j", 4, "ascii");
    assert.strictEqual(writeTest.toString(), "nodejs");
  }

  // Offset points to the end of the buffer and does not throw.
  // (see https://github.com/nodejs/node/issues/8127).
  Buffer.alloc(1).write("", 1, 0);

  // ASCII slice test
  {
    const asciiString = "hello world";

    for (let i = 0; i < asciiString.length; i++) {
      b[i] = asciiString.charCodeAt(i);
    }
    const asciiSlice = b.toString("ascii", 0, asciiString.length);
    assert.strictEqual(asciiString, asciiSlice);
  }

  {
    const asciiString = "hello world";
    const offset = 100;

    assert.strictEqual(asciiString.length, b.write(asciiString, offset, "ascii"));
    const asciiSlice = b.toString("ascii", offset, offset + asciiString.length);
    assert.strictEqual(asciiString, asciiSlice);
  }

  {
    const asciiString = "hello world";
    const offset = 100;

    const sliceA = b.slice(offset, offset + asciiString.length);
    const sliceB = b.slice(offset, offset + asciiString.length);
    for (let i = 0; i < asciiString.length; i++) {
      assert.strictEqual(sliceA[i], sliceB[i]);
    }
  }

  // UTF-8 slice test
  {
    const utf8String = "¡hέlló wôrld!";
    const offset = 100;

    b.write(utf8String, 0, Buffer.byteLength(utf8String), "utf8");
    let utf8Slice = b.toString("utf8", 0, Buffer.byteLength(utf8String));
    assert.strictEqual(utf8String, utf8Slice);

    assert.strictEqual(Buffer.byteLength(utf8String), b.write(utf8String, offset, "utf8"));
    utf8Slice = b.toString("utf8", offset, offset + Buffer.byteLength(utf8String));
    assert.strictEqual(utf8String, utf8Slice);

    const sliceA = b.slice(offset, offset + Buffer.byteLength(utf8String));
    const sliceB = b.slice(offset, offset + Buffer.byteLength(utf8String));
    for (let i = 0; i < Buffer.byteLength(utf8String); i++) {
      assert.strictEqual(sliceA[i], sliceB[i]);
    }
  }

  {
    const slice = b.slice(100, 150);
    assert.strictEqual(slice.length, 50);
    for (let i = 0; i < 50; i++) {
      assert.strictEqual(b[100 + i], slice[i]);
    }
  }

  {
    // Make sure only top level parent propagates from allocPool
    const b = Buffer.allocUnsafe(5);
    const c = b.slice(0, 4);
    const d = c.slice(0, 2);
    assert.strictEqual(b.parent, c.parent);
    assert.strictEqual(b.parent, d.parent);
  }

  {
    // Also from a non-pooled instance
    const b = Buffer.allocUnsafeSlow(5);
    const c = b.slice(0, 4);
    const d = c.slice(0, 2);
    assert.strictEqual(c.parent, d.parent);
  }

  {
    // Bug regression test
    const testValue = "\u00F6\u65E5\u672C\u8A9E"; // ö日本語
    const buffer = Buffer.allocUnsafe(32);
    const size = buffer.write(testValue, 0, "utf8");
    const slice = buffer.toString("utf8", 0, size);
    assert.strictEqual(slice, testValue);
  }

  {
    // Test triple  slice
    const a = Buffer.allocUnsafe(8);
    for (let i = 0; i < 8; i++) a[i] = i;
    const b = a.slice(4, 8);
    assert.strictEqual(b[0], 4);
    assert.strictEqual(b[1], 5);
    assert.strictEqual(b[2], 6);
    assert.strictEqual(b[3], 7);
    const c = b.slice(2, 4);
    assert.strictEqual(c[0], 6);
    assert.strictEqual(c[1], 7);
  }

  {
    const d = Buffer.from([23, 42, 255]);
    assert.strictEqual(d.length, 3);
    assert.strictEqual(d[0], 23);
    assert.strictEqual(d[1], 42);
    assert.strictEqual(d[2], 255);
    assert.deepStrictEqual(d, Buffer.from(d));
  }

  {
    // Test for proper UTF-8 Encoding
    const e = Buffer.from("über");
    assert.deepStrictEqual(e, Buffer.from([195, 188, 98, 101, 114]));
  }

  {
    // Test for proper ascii Encoding, length should be 4
    const f = Buffer.from("über", "ascii");
    assert.deepStrictEqual(f, Buffer.from([252, 98, 101, 114]));
  }

  ["ucs2", "ucs-2", "utf16le", "utf-16le"].forEach(encoding => {
    {
      // Test for proper UTF16LE encoding, length should be 8
      const f = Buffer.from("über", encoding);
      assert.deepStrictEqual(f, Buffer.from([252, 0, 98, 0, 101, 0, 114, 0]));
    }

    {
      // Length should be 12
      const f = Buffer.from("привет", encoding);
      assert.deepStrictEqual(f, Buffer.from([63, 4, 64, 4, 56, 4, 50, 4, 53, 4, 66, 4]));
      assert.strictEqual(f.toString(encoding), "привет");
    }

    {
      const f = Buffer.from([0, 0, 0, 0, 0]);
      assert.strictEqual(f.length, 5);
      const size = f.write("あいうえお", encoding);
      assert.strictEqual(size, 4);
      assert.deepStrictEqual(f, Buffer.from([0x42, 0x30, 0x44, 0x30, 0x00]));
    }
  });

  {
    const f = Buffer.from("\uD83D\uDC4D", "utf-16le"); // THUMBS UP SIGN (U+1F44D)
    assert.strictEqual(f.length, 4);
    assert.deepStrictEqual(f, Buffer.from("3DD84DDC", "hex"));
  }

  // Test construction from arrayish object
  {
    const arrayIsh = { 0: 0, 1: 1, 2: 2, 3: 3, length: 4 };
    let g = Buffer.from(arrayIsh);
    assert.deepStrictEqual(g, Buffer.from([0, 1, 2, 3]));
    const strArrayIsh = { 0: "0", 1: "1", 2: "2", 3: "3", length: 4 };
    g = Buffer.from(strArrayIsh);
    assert.deepStrictEqual(g, Buffer.from([0, 1, 2, 3]));
  }

  //
  // Test toString('base64')
  //
  assert.strictEqual(Buffer.from("Man").toString("base64"), "TWFu");
  assert.strictEqual(Buffer.from("Woman").toString("base64"), "V29tYW4=");

  //
  // Test toString('base64url')
  //
  assert.strictEqual(Buffer.from("Man").toString("base64url"), "TWFu");
  assert.strictEqual(Buffer.from("Woman").toString("base64url"), "V29tYW4");

  {
    // Test that regular and URL-safe base64 both work both ways
    const expected = [0xff, 0xff, 0xbe, 0xff, 0xef, 0xbf, 0xfb, 0xef, 0xff];
    assert.deepStrictEqual(Buffer.from("//++/++/++//", "base64"), Buffer.from(expected));
    assert.deepStrictEqual(Buffer.from("__--_--_--__", "base64"), Buffer.from(expected));
    assert.deepStrictEqual(Buffer.from("//++/++/++//", "base64url"), Buffer.from(expected));
    assert.deepStrictEqual(Buffer.from("__--_--_--__", "base64url"), Buffer.from(expected));
  }

  const base64flavors = ["base64", "base64url"];

  {
    // Test that regular and URL-safe base64 both work both ways with padding
    const expected = [0xff, 0xff, 0xbe, 0xff, 0xef, 0xbf, 0xfb, 0xef, 0xff, 0xfb];
    assert.deepStrictEqual(Buffer.from("//++/++/++//+w==", "base64"), Buffer.from(expected));
    assert.deepStrictEqual(Buffer.from("//++/++/++//+w==", "base64"), Buffer.from(expected));
    assert.deepStrictEqual(Buffer.from("//++/++/++//+w==", "base64url"), Buffer.from(expected));
    assert.deepStrictEqual(Buffer.from("//++/++/++//+w==", "base64url"), Buffer.from(expected));
  }

  {
    // big example
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
    assert.strictEqual(Buffer.from(quote).toString("base64"), expected);
    assert.strictEqual(
      Buffer.from(quote).toString("base64url"),
      expected.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""),
    );

    base64flavors.forEach(encoding => {
      let b = Buffer.allocUnsafe(1024);
      let bytesWritten = b.write(expected, 0, encoding);
      assert.strictEqual(quote.length, bytesWritten);
      assert.strictEqual(quote, b.toString("ascii", 0, quote.length));

      // Check that the base64 decoder ignores whitespace
      const expectedWhite =
        `${expected.slice(0, 60)} \n` +
        `${expected.slice(60, 120)} \n` +
        `${expected.slice(120, 180)} \n` +
        `${expected.slice(180, 240)} \n` +
        `${expected.slice(240, 300)}\n` +
        `${expected.slice(300, 360)}\n`;
      b = Buffer.allocUnsafe(1024);
      bytesWritten = b.write(expectedWhite, 0, encoding);
      assert.strictEqual(quote.length, bytesWritten);
      assert.strictEqual(quote, b.toString("ascii", 0, quote.length));

      // Check that the base64 decoder on the constructor works
      // even in the presence of whitespace.
      b = Buffer.from(expectedWhite, encoding);
      assert.strictEqual(quote.length, b.length);
      assert.strictEqual(quote, b.toString("ascii", 0, quote.length));

      // Check that the base64 decoder ignores illegal chars
      const expectedIllegal =
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
      b = Buffer.from(expectedIllegal, encoding);
      assert.strictEqual(quote.length, b.length);
      assert.strictEqual(quote, b.toString("ascii", 0, quote.length));
    });
  }

  base64flavors.forEach(encoding => {
    assert.strictEqual(Buffer.from("", encoding).toString(), "");
    assert.strictEqual(Buffer.from("K", encoding).toString(), "");

    // multiple-of-4 with padding
    assert.strictEqual(Buffer.from("Kg==", encoding).toString(), "*");
    assert.strictEqual(Buffer.from("Kio=", encoding).toString(), "*".repeat(2));
    assert.strictEqual(Buffer.from("Kioq", encoding).toString(), "*".repeat(3));
    assert.strictEqual(Buffer.from("KioqKg==", encoding).toString(), "*".repeat(4));
    assert.strictEqual(Buffer.from("KioqKio=", encoding).toString(), "*".repeat(5));
    assert.strictEqual(Buffer.from("KioqKioq", encoding).toString(), "*".repeat(6));
    assert.strictEqual(Buffer.from("KioqKioqKg==", encoding).toString(), "*".repeat(7));
    assert.strictEqual(Buffer.from("KioqKioqKio=", encoding).toString(), "*".repeat(8));
    assert.strictEqual(Buffer.from("KioqKioqKioq", encoding).toString(), "*".repeat(9));
    assert.strictEqual(Buffer.from("KioqKioqKioqKg==", encoding).toString(), "*".repeat(10));
    assert.strictEqual(Buffer.from("KioqKioqKioqKio=", encoding).toString(), "*".repeat(11));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioq", encoding).toString(), "*".repeat(12));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKg==", encoding).toString(), "*".repeat(13));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKio=", encoding).toString(), "*".repeat(14));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKioq", encoding).toString(), "*".repeat(15));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKioqKg==", encoding).toString(), "*".repeat(16));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKioqKio=", encoding).toString(), "*".repeat(17));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKioqKioq", encoding).toString(), "*".repeat(18));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKioqKioqKg==", encoding).toString(), "*".repeat(19));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKioqKioqKio=", encoding).toString(), "*".repeat(20));

    // No padding, not a multiple of 4
    assert.strictEqual(Buffer.from("Kg", encoding).toString(), "*");
    assert.strictEqual(Buffer.from("Kio", encoding).toString(), "*".repeat(2));
    assert.strictEqual(Buffer.from("KioqKg", encoding).toString(), "*".repeat(4));
    assert.strictEqual(Buffer.from("KioqKio", encoding).toString(), "*".repeat(5));
    assert.strictEqual(Buffer.from("KioqKioqKg", encoding).toString(), "*".repeat(7));
    assert.strictEqual(Buffer.from("KioqKioqKio", encoding).toString(), "*".repeat(8));
    assert.strictEqual(Buffer.from("KioqKioqKioqKg", encoding).toString(), "*".repeat(10));
    assert.strictEqual(Buffer.from("KioqKioqKioqKio", encoding).toString(), "*".repeat(11));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKg", encoding).toString(), "*".repeat(13));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKio", encoding).toString(), "*".repeat(14));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKioqKg", encoding).toString(), "*".repeat(16));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKioqKio", encoding).toString(), "*".repeat(17));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKioqKioqKg", encoding).toString(), "*".repeat(19));
    assert.strictEqual(Buffer.from("KioqKioqKioqKioqKioqKioqKio", encoding).toString(), "*".repeat(20));
  });

  // Handle padding graciously, multiple-of-4 or not
  assert.strictEqual(Buffer.from("72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw==", "base64").length, 32);
  assert.strictEqual(Buffer.from("72INjkR5fchcxk9-VgdGPFJDxUBFR5_rMFsghgxADiw==", "base64url").length, 32);
  assert.strictEqual(Buffer.from("72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw=", "base64").length, 32);
  assert.strictEqual(Buffer.from("72INjkR5fchcxk9-VgdGPFJDxUBFR5_rMFsghgxADiw=", "base64url").length, 32);
  assert.strictEqual(Buffer.from("72INjkR5fchcxk9+VgdGPFJDxUBFR5/rMFsghgxADiw", "base64").length, 32);
  assert.strictEqual(Buffer.from("72INjkR5fchcxk9-VgdGPFJDxUBFR5_rMFsghgxADiw", "base64url").length, 32);
  assert.strictEqual(Buffer.from("w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg==", "base64").length, 31);
  assert.strictEqual(Buffer.from("w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg==", "base64url").length, 31);
  assert.strictEqual(Buffer.from("w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg=", "base64").length, 31);
  assert.strictEqual(Buffer.from("w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg=", "base64url").length, 31);
  assert.strictEqual(Buffer.from("w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg", "base64").length, 31);
  assert.strictEqual(Buffer.from("w69jACy6BgZmaFvv96HG6MYksWytuZu3T1FvGnulPg", "base64url").length, 31);

  {
    // This string encodes single '.' character in UTF-16
    const dot = Buffer.from("//4uAA==", "base64");
    assert.strictEqual(dot[0], 0xff);
    assert.strictEqual(dot[1], 0xfe);
    assert.strictEqual(dot[2], 0x2e);
    assert.strictEqual(dot[3], 0x00);
    assert.strictEqual(dot.toString("base64"), "//4uAA==");
  }

  {
    // This string encodes single '.' character in UTF-16
    const dot = Buffer.from("//4uAA", "base64url");
    assert.strictEqual(dot[0], 0xff);
    assert.strictEqual(dot[1], 0xfe);
    assert.strictEqual(dot[2], 0x2e);
    assert.strictEqual(dot[3], 0x00);
    assert.strictEqual(dot.toString("base64url"), "__4uAA");
  }

  {
    // Writing base64 at a position > 0 should not mangle the result.
    //
    // https://github.com/joyent/node/issues/402
    const segments = ["TWFkbmVzcz8h", "IFRoaXM=", "IGlz", "IG5vZGUuanMh"];
    const b = Buffer.allocUnsafe(64);
    let pos = 0;

    for (let i = 0; i < segments.length; ++i) {
      pos += b.write(segments[i], pos, "base64");
    }
    assert.strictEqual(b.toString("latin1", 0, pos), "Madness?! This is node.js!");
  }

  {
    // Writing base64url at a position > 0 should not mangle the result.
    //
    // https://github.com/joyent/node/issues/402
    const segments = ["TWFkbmVzcz8h", "IFRoaXM", "IGlz", "IG5vZGUuanMh"];
    const b = Buffer.allocUnsafe(64);
    let pos = 0;

    for (let i = 0; i < segments.length; ++i) {
      pos += b.write(segments[i], pos, "base64url");
    }
    assert.strictEqual(b.toString("latin1", 0, pos), "Madness?! This is node.js!");
  }

  // Regression test for https://github.com/nodejs/node/issues/3496.
  assert.strictEqual(Buffer.from("=bad".repeat(1e4), "base64").length, 0);

  // Regression test for https://github.com/nodejs/node/issues/11987.
  assert.deepStrictEqual(Buffer.from("w0  ", "base64"), Buffer.from("w0", "base64"));

  // Regression test for https://github.com/nodejs/node/issues/13657.
  assert.deepStrictEqual(Buffer.from(" YWJvcnVtLg", "base64"), Buffer.from("YWJvcnVtLg", "base64"));

  {
    // Creating buffers larger than pool size.
    const l = Buffer.poolSize + 5;
    const s = "h".repeat(l);
    const b = Buffer.from(s);

    for (let i = 0; i < l; i++) {
      assert.strictEqual(b[i], "h".charCodeAt(0));
    }

    const sb = b.toString();
    assert.strictEqual(sb.length, s.length);
    assert.strictEqual(sb, s);
  }

  {
    // test hex toString
    const hexb = Buffer.allocUnsafe(256);
    for (let i = 0; i < 256; i++) {
      hexb[i] = i;
    }
    const hexStr = hexb.toString("hex");
    assert.strictEqual(
      hexStr,
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
      assert.strictEqual(hexb2[i], hexb[i]);
    }
  }

  // Test single hex character is discarded.
  assert.strictEqual(Buffer.from("A", "hex").length, 0);

  // Test that if a trailing character is discarded, rest of string is processed.
  assert.deepStrictEqual(Buffer.from("Abx", "hex"), Buffer.from("Ab", "hex"));

  // Test single base64 char encodes as 0.
  assert.strictEqual(Buffer.from("A", "base64").length, 0);

  {
    // Test an invalid slice end.
    const b = Buffer.from([1, 2, 3, 4, 5]);
    const b2 = b.toString("hex", 1, 10000);
    const b3 = b.toString("hex", 1, 5);
    const b4 = b.toString("hex", 1);
    assert.strictEqual(b2, b3);
    assert.strictEqual(b2, b4);
  }

  function buildBuffer(data) {
    if (Array.isArray(data)) {
      const buffer = Buffer.allocUnsafe(data.length);
      data.forEach((v, k) => (buffer[k] = v));
      return buffer;
    }
    return null;
  }

  const x = buildBuffer([0x81, 0xa3, 0x66, 0x6f, 0x6f, 0xa3, 0x62, 0x61, 0x72]);

  // assert.strictEqual(x.inspect(), "<Buffer 81 a3 66 6f 6f a3 62 61 72>");

  {
    const z = x.slice(4);
    assert.strictEqual(z.length, 5);
    assert.strictEqual(z[0], 0x6f);
    assert.strictEqual(z[1], 0xa3);
    assert.strictEqual(z[2], 0x62);
    assert.strictEqual(z[3], 0x61);
    assert.strictEqual(z[4], 0x72);
  }

  {
    const z = x.slice(0);
    assert.strictEqual(z.length, x.length);
  }

  {
    const z = x.slice(0, 4);
    assert.strictEqual(z.length, 4);
    assert.strictEqual(z[0], 0x81);
    assert.strictEqual(z[1], 0xa3);
  }

  {
    const z = x.slice(0, 9);
    assert.strictEqual(z.length, 9);
  }

  {
    const z = x.slice(1, 4);
    assert.strictEqual(z.length, 3);
    assert.strictEqual(z[0], 0xa3);
  }

  {
    const z = x.slice(2, 4);
    assert.strictEqual(z.length, 2);
    assert.strictEqual(z[0], 0x66);
    assert.strictEqual(z[1], 0x6f);
  }

  ["ucs2", "ucs-2", "utf16le", "utf-16le"].forEach(encoding => {
    const b = Buffer.allocUnsafe(10);
    b.write("あいうえお", encoding);
    assert.strictEqual(b.toString(encoding), "あいうえお");
  });

  ["ucs2", "ucs-2", "utf16le", "utf-16le"].forEach(encoding => {
    const b = Buffer.allocUnsafe(11);
    b.write("あいうえお", 1, encoding);
    assert.strictEqual(b.toString(encoding, 1), "あいうえお");
  });

  {
    // latin1 encoding should write only one byte per character.
    const b = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    let s = String.fromCharCode(0xffff);
    b.write(s, 0, "latin1");
    assert.strictEqual(b[0], 0xff);
    assert.strictEqual(b[1], 0xad);
    assert.strictEqual(b[2], 0xbe);
    assert.strictEqual(b[3], 0xef);
    s = String.fromCharCode(0xaaee);
    b.write(s, 0, "latin1");
    assert.strictEqual(b[0], 0xee);
    assert.strictEqual(b[1], 0xad);
    assert.strictEqual(b[2], 0xbe);
    assert.strictEqual(b[3], 0xef);
  }

  {
    // Binary encoding should write only one byte per character.
    const b = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    let s = String.fromCharCode(0xffff);
    b.write(s, 0, "latin1");
    assert.strictEqual(b[0], 0xff);
    assert.strictEqual(b[1], 0xad);
    assert.strictEqual(b[2], 0xbe);
    assert.strictEqual(b[3], 0xef);
    s = String.fromCharCode(0xaaee);
    b.write(s, 0, "latin1");
    assert.strictEqual(b[0], 0xee);
    assert.strictEqual(b[1], 0xad);
    assert.strictEqual(b[2], 0xbe);
    assert.strictEqual(b[3], 0xef);
  }

  {
    // https://github.com/nodejs/node-v0.x-archive/pull/1210
    // Test UTF-8 string includes null character
    let buf = Buffer.from("\0");
    assert.strictEqual(buf.length, 1);
    buf = Buffer.from("\0\0");
    assert.strictEqual(buf.length, 2);
  }

  {
    const buf = Buffer.allocUnsafe(2);
    assert.strictEqual(buf.write(""), 0); // 0bytes
    assert.strictEqual(buf.write("\0"), 1); // 1byte (v8 adds null terminator)
    assert.strictEqual(buf.write("a\0"), 2); // 1byte * 2
    assert.strictEqual(buf.write("あ"), 0); // 3bytes
    assert.strictEqual(buf.write("\0あ"), 1); // 1byte + 3bytes
    assert.strictEqual(buf.write("\0\0あ"), 2); // 1byte * 2 + 3bytes
  }

  {
    const buf = Buffer.allocUnsafe(10);
    assert.strictEqual(buf.write("あいう"), 9); // 3bytes * 3 (v8 adds null term.)
    assert.strictEqual(buf.write("あいう\0"), 10); // 3bytes * 3 + 1byte
  }

  {
    // https://github.com/nodejs/node-v0.x-archive/issues/243
    // Test write() with maxLength
    const buf = Buffer.allocUnsafe(4);
    buf.fill(0xff);
    assert.strictEqual(buf.write("abcd", 1, 2, "utf8"), 2);
    assert.strictEqual(buf[0], 0xff);
    assert.strictEqual(buf[1], 0x61);
    assert.strictEqual(buf[2], 0x62);
    assert.strictEqual(buf[3], 0xff);

    buf.fill(0xff);
    assert.strictEqual(buf.write("abcd", 1, 4), 3);
    assert.strictEqual(buf[0], 0xff);
    assert.strictEqual(buf[1], 0x61);
    assert.strictEqual(buf[2], 0x62);
    assert.strictEqual(buf[3], 0x63);

    buf.fill(0xff);
    assert.strictEqual(buf.write("abcd", 1, 2, "utf8"), 2);
    assert.strictEqual(buf[0], 0xff);
    assert.strictEqual(buf[1], 0x61);
    assert.strictEqual(buf[2], 0x62);
    assert.strictEqual(buf[3], 0xff);

    buf.fill(0xff);
    assert.strictEqual(buf.write("abcdef", 1, 2, "hex"), 2);
    assert.strictEqual(buf[0], 0xff);
    assert.strictEqual(buf[1], 0xab);
    assert.strictEqual(buf[2], 0xcd);
    assert.strictEqual(buf[3], 0xff);

    ["ucs2", "ucs-2", "utf16le", "utf-16le"].forEach(encoding => {
      buf.fill(0xff);
      assert.strictEqual(buf.write("abcd", 0, 2, encoding), 2);
      assert.strictEqual(buf[0], 0x61);
      assert.strictEqual(buf[1], 0x00);
      assert.strictEqual(buf[2], 0xff);
      assert.strictEqual(buf[3], 0xff);
    });
  }

  {
    // Test offset returns are correct
    const b = Buffer.allocUnsafe(16);
    assert.strictEqual(b.writeUInt32LE(0, 0), 4);
    assert.strictEqual(b.writeUInt16LE(0, 4), 6);
    assert.strictEqual(b.writeUInt8(0, 6), 7);
    assert.strictEqual(b.writeInt8(0, 7), 8);
    assert.strictEqual(b.writeDoubleLE(0, 8), 16);
  }

  {
    // Test unmatched surrogates not producing invalid utf8 output
    // ef bf bd = utf-8 representation of unicode replacement character
    // see https://codereview.chromium.org/121173009/
    let buf = Buffer.from("ab\ud800cd", "utf8");
    assert.strictEqual(buf[0], 0x61);
    assert.strictEqual(buf[1], 0x62);
    assert.strictEqual(buf[2], 0xef);
    assert.strictEqual(buf[3], 0xbf);
    assert.strictEqual(buf[4], 0xbd);
    assert.strictEqual(buf[5], 0x63);
    assert.strictEqual(buf[6], 0x64);

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
  }

  {
    // Test for buffer overrun
    const buf = Buffer.from([0, 0, 0, 0, 0]); // length: 5
    const sub = buf.slice(0, 4); // length: 4
    assert.strictEqual(sub.write("12345", "latin1"), 4);
    assert.strictEqual(buf[4], 0);
    assert.strictEqual(sub.write("12345", "binary"), 4);
    assert.strictEqual(buf[4], 0);
  }

  {
    // Test alloc with fill option
    const buf = Buffer.alloc(5, "800A", "hex");
    assert.strictEqual(buf[0], 128);
    assert.strictEqual(buf[1], 10);
    assert.strictEqual(buf[2], 128);
    assert.strictEqual(buf[3], 10);
    assert.strictEqual(buf[4], 128);
  }

  // Check for fractional length args, junk length args, etc.
  // https://github.com/joyent/node/issues/1758

  // Call .fill() first, stops valgrind warning about uninitialized memory reads.
  Buffer.allocUnsafe(3.3).fill().toString();
  // Throws bad argument error in commit 43cb4ec
  Buffer.alloc(3.3).fill().toString();
  assert.strictEqual(Buffer.allocUnsafe(3.3).length, 3);
  assert.strictEqual(Buffer.from({ length: 3.3 }).length, 3);
  assert.strictEqual(Buffer.from({ length: "BAM" }).length, 0);

  // Make sure that strings are not coerced to numbers.
  assert.strictEqual(Buffer.from("99").length, 2);
  assert.strictEqual(Buffer.from("13.37").length, 5);

  // Ensure that the length argument is respected.
  ["ascii", "utf8", "hex", "base64", "latin1", "binary"].forEach(enc => {
    assert.strictEqual(Buffer.allocUnsafe(1).write("aaaaaa", 0, 1, enc), 1);
  });

  {
    // Regression test, guard against buffer overrun in the base64 decoder.
    const a = Buffer.allocUnsafe(3);
    const b = Buffer.from("xxx");
    a.write("aaaaaaaa", "base64");
    assert.strictEqual(b.toString(), "xxx");
  }

  // issue GH-3416
  Buffer.from(Buffer.allocUnsafe(0), 0, 0);

  // issue GH-5587
  assert.throws(() => Buffer.alloc(8).writeFloatLE(0, 5), outOfRangeError);
  assert.throws(() => Buffer.alloc(16).writeDoubleLE(0, 9), outOfRangeError);

  // Attempt to overflow buffers, similar to previous bug in array buffers
  assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, 0xffffffff), outOfRangeError);
  assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, 0xffffffff), outOfRangeError);

  // Ensure negative values can't get past offset
  assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, -1), outOfRangeError);
  assert.throws(() => Buffer.allocUnsafe(8).writeFloatLE(0.0, -1), outOfRangeError);

  // Test for common write(U)IntLE/BE
  {
    let buf = Buffer.allocUnsafe(3);
    buf.writeUIntLE(0x123456, 0, 3);
    assert.deepStrictEqual(buf.toJSON().data, [0x56, 0x34, 0x12]);
    assert.strictEqual(buf.readUIntLE(0, 3), 0x123456);

    buf.fill(0xff);
    buf.writeUIntBE(0x123456, 0, 3);
    assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56]);
    assert.strictEqual(buf.readUIntBE(0, 3), 0x123456);

    buf.fill(0xff);
    buf.writeIntLE(0x123456, 0, 3);
    assert.deepStrictEqual(buf.toJSON().data, [0x56, 0x34, 0x12]);
    assert.strictEqual(buf.readIntLE(0, 3), 0x123456);

    buf.fill(0xff);
    buf.writeIntBE(0x123456, 0, 3);
    assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56]);
    assert.strictEqual(buf.readIntBE(0, 3), 0x123456);

    buf.fill(0xff);
    buf.writeIntLE(-0x123456, 0, 3);
    assert.deepStrictEqual(buf.toJSON().data, [0xaa, 0xcb, 0xed]);
    assert.strictEqual(buf.readIntLE(0, 3), -0x123456);

    buf.fill(0xff);
    buf.writeIntBE(-0x123456, 0, 3);
    assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcb, 0xaa]);
    assert.strictEqual(buf.readIntBE(0, 3), -0x123456);

    buf.fill(0xff);
    buf.writeIntLE(-0x123400, 0, 3);
    assert.deepStrictEqual(buf.toJSON().data, [0x00, 0xcc, 0xed]);
    assert.strictEqual(buf.readIntLE(0, 3), -0x123400);

    buf.fill(0xff);
    buf.writeIntBE(-0x123400, 0, 3);
    assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcc, 0x00]);
    assert.strictEqual(buf.readIntBE(0, 3), -0x123400);

    buf.fill(0xff);
    buf.writeIntLE(-0x120000, 0, 3);
    assert.deepStrictEqual(buf.toJSON().data, [0x00, 0x00, 0xee]);
    assert.strictEqual(buf.readIntLE(0, 3), -0x120000);

    buf.fill(0xff);
    buf.writeIntBE(-0x120000, 0, 3);
    assert.deepStrictEqual(buf.toJSON().data, [0xee, 0x00, 0x00]);
    assert.strictEqual(buf.readIntBE(0, 3), -0x120000);

    buf = Buffer.allocUnsafe(5);
    buf.writeUIntLE(0x1234567890, 0, 5);
    assert.deepStrictEqual(buf.toJSON().data, [0x90, 0x78, 0x56, 0x34, 0x12]);
    assert.strictEqual(buf.readUIntLE(0, 5), 0x1234567890);

    buf.fill(0xff);
    buf.writeUIntBE(0x1234567890, 0, 5);
    assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56, 0x78, 0x90]);
    assert.strictEqual(buf.readUIntBE(0, 5), 0x1234567890);

    buf.fill(0xff);
    buf.writeIntLE(0x1234567890, 0, 5);
    assert.deepStrictEqual(buf.toJSON().data, [0x90, 0x78, 0x56, 0x34, 0x12]);
    assert.strictEqual(buf.readIntLE(0, 5), 0x1234567890);

    buf.fill(0xff);
    buf.writeIntBE(0x1234567890, 0, 5);
    assert.deepStrictEqual(buf.toJSON().data, [0x12, 0x34, 0x56, 0x78, 0x90]);
    assert.strictEqual(buf.readIntBE(0, 5), 0x1234567890);

    buf.fill(0xff);
    buf.writeIntLE(-0x1234567890, 0, 5);
    assert.deepStrictEqual(buf.toJSON().data, [0x70, 0x87, 0xa9, 0xcb, 0xed]);
    assert.strictEqual(buf.readIntLE(0, 5), -0x1234567890);

    buf.fill(0xff);
    buf.writeIntBE(-0x1234567890, 0, 5);
    assert.deepStrictEqual(buf.toJSON().data, [0xed, 0xcb, 0xa9, 0x87, 0x70]);
    assert.strictEqual(buf.readIntBE(0, 5), -0x1234567890);

    buf.fill(0xff);
    buf.writeIntLE(-0x0012000000, 0, 5);
    assert.deepStrictEqual(buf.toJSON().data, [0x00, 0x00, 0x00, 0xee, 0xff]);
    assert.strictEqual(buf.readIntLE(0, 5), -0x0012000000);

    buf.fill(0xff);
    buf.writeIntBE(-0x0012000000, 0, 5);
    assert.deepStrictEqual(buf.toJSON().data, [0xff, 0xee, 0x00, 0x00, 0x00]);
    assert.strictEqual(buf.readIntBE(0, 5), -0x0012000000);
  }

  // Regression test for https://github.com/nodejs/node-v0.x-archive/issues/5482:
  // should throw but not assert in C++ land.
  assert.throws(() => Buffer.from("", "buffer"), {
    code: "ERR_UNKNOWN_ENCODING",
    name: "TypeError",
    message: "Unknown encoding: buffer",
  });

  // Regression test for https://github.com/nodejs/node-v0.x-archive/issues/6111.
  // Constructing a buffer from another buffer should a) work, and b) not corrupt
  // the source buffer.
  {
    const a = [...Array(128).keys()]; // [0, 1, 2, 3, ... 126, 127]
    const b = Buffer.from(a);
    const c = Buffer.from(b);
    assert.strictEqual(b.length, a.length);
    assert.strictEqual(c.length, a.length);
    for (let i = 0, k = a.length; i < k; ++i) {
      assert.strictEqual(a[i], i);
      assert.strictEqual(b[i], i);
      assert.strictEqual(c[i], i);
    }
  }

  // if (common.hasCrypto) {
  // eslint-disable-line node-core/crypto-check
  // Test truncation after decode
  const crypto = require("crypto");

  const b1 = Buffer.from("YW55=======", "base64");
  const b2 = Buffer.from("YW55", "base64");

  assert.strictEqual(
    crypto.createHash("sha1").update(b1).digest("hex"),
    crypto.createHash("sha1").update(b2).digest("hex"),
  );
  // } else {
  //   common.printSkipMessage("missing crypto");
  // }

  const ps = Buffer.poolSize;
  Buffer.poolSize = 0;
  assert(Buffer.allocUnsafe(1).parent instanceof ArrayBuffer);
  Buffer.poolSize = ps;

  assert.throws(() => Buffer.allocUnsafe(10).copy(), {
    code: "ERR_INVALID_ARG_TYPE",
    name: "TypeError",
    message: 'The "target" argument must be an instance of Buffer or ' + "Uint8Array. Received undefined",
  });

  assert.throws(() => Buffer.from(), {
    name: "TypeError",
    message:
      "The first argument must be of type string or an instance of " +
      "Buffer, ArrayBuffer, or Array or an Array-like Object. Received undefined",
  });
  assert.throws(() => Buffer.from(null), {
    name: "TypeError",
    message:
      "The first argument must be of type string or an instance of " +
      "Buffer, ArrayBuffer, or Array or an Array-like Object. Received null",
  });

  // Test prototype getters don't throw
  assert.strictEqual(Buffer.prototype.parent, undefined);
  assert.strictEqual(Buffer.prototype.offset, undefined);
  assert.strictEqual(SlowBuffer.prototype.parent, undefined);
  assert.strictEqual(SlowBuffer.prototype.offset, undefined);

  {
    // Test that large negative Buffer length inputs don't affect the pool offset.
    // Use the fromArrayLike() variant here because it's more lenient
    // about its input and passes the length directly to allocate().
    assert.deepStrictEqual(Buffer.from({ length: -Buffer.poolSize }), Buffer.from(""));
    assert.deepStrictEqual(Buffer.from({ length: -100 }), Buffer.from(""));

    // Check pool offset after that by trying to write string into the pool.
    Buffer.from("abc");
  }

  // Test that ParseArrayIndex handles full uint32
  {
    const errMsg = common.expectsError({
      code: "ERR_BUFFER_OUT_OF_BOUNDS",
      name: "RangeError",
      message: '"offset" is outside of buffer bounds',
    });
    assert.throws(() => Buffer.from(new ArrayBuffer(0), -1 >>> 0), errMsg);
  }

  // ParseArrayIndex() should reject values that don't fit in a 32 bits size_t.
  assert.throws(() => {
    const a = Buffer.alloc(1);
    const b = Buffer.alloc(1);
    a.copy(b, 0, 0x100000000, 0x100000001);
  }, outOfRangeError);

  // Unpooled buffer (replaces SlowBuffer)
  {
    const ubuf = Buffer.allocUnsafeSlow(10);
    assert(ubuf);
    assert(ubuf.buffer);
    assert.strictEqual(ubuf.buffer.byteLength, 10);
  }

  // Regression test to verify that an empty ArrayBuffer does not throw.
  Buffer.from(new ArrayBuffer());

  // Test that ArrayBuffer from a different context is detected correctly.
  // const arrayBuf = vm.runInNewContext("new ArrayBuffer()");
  // Buffer.from(arrayBuf);
  // Buffer.from({ buffer: arrayBuf });

  assert.throws(() => Buffer.alloc({ valueOf: () => 1 }), /"size" argument must be of type number/);
  assert.throws(() => Buffer.alloc({ valueOf: () => -1 }), /"size" argument must be of type number/);

  assert.strictEqual(Buffer.prototype.toLocaleString, Buffer.prototype.toString);
  {
    const buf = Buffer.from("test");
    assert.strictEqual(buf.toLocaleString(), buf.toString());
  }

  assert.throws(
    () => {
      Buffer.alloc(0x1000, "This is not correctly encoded", "hex");
    },
    {
      code: "ERR_INVALID_ARG_VALUE",
      name: "TypeError",
    },
  );

  assert.throws(
    () => {
      Buffer.alloc(0x1000, "c", "hex");
    },
    {
      code: "ERR_INVALID_ARG_VALUE",
      name: "TypeError",
    },
  );

  assert.throws(
    () => {
      Buffer.alloc(1, Buffer.alloc(0));
    },
    {
      code: "ERR_INVALID_ARG_VALUE",
      name: "TypeError",
    },
  );

  assert.throws(
    () => {
      Buffer.alloc(40, "x", 20);
    },
    {
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
    },
  );
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

it("Buffer.copy", () => {
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

  {
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
  }

  {
    const buf = Buffer.allocUnsafe(26);

    for (let i = 0; i < 26; i++) {
      // 97 is the decimal ASCII value for 'a'.
      buf[i] = i + 97;
    }

    buf.copy(buf, 0, 4, 10);
    expect(buf.toString()).toBe("efghijghijklmnopqrstuvwxyz");
  }
});

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
  expect(Buffer.concat([array1, array2, array3]).join("")).toBe(array1.join("") + array2.join("") + array3.join(""));
  expect(Buffer.concat([array1, array2, array3], 222).length).toBe(222);
  expect(Buffer.concat([array1, array2, array3], 222).subarray(0, 128).join("")).toBe("100".repeat(128));
  expect(Buffer.concat([array1, array2, array3], 222).subarray(129, 222).join("")).toBe("200".repeat(222 - 129));
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

  expect(Buffer.from(btoa('console.log("hello world")\n'), "base64").toString()).toBe('console.log("hello world")\n');
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
    expect(false).toBe(true);
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
    expect(false).toBe(true);
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
    expect(false).toBe(true);
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
  expect(Buffer.from('{"alg":"RS256","typ":"JWT"}', "latin1").toString("latin1")).toBe('{"alg":"RS256","typ":"JWT"}');
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
    expect(Buffer.from(`console.log("hello world")\n`).toString("base64")).toBe(btoa('console.log("hello world")\n'));
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
  expect(BufferModule.constants.MAX_STRING_LENGTH).toBe(536870888);
  expect(BufferModule.default.constants.MAX_LENGTH).toBe(4294967296);
  expect(BufferModule.default.constants.MAX_STRING_LENGTH).toBe(536870888);
});

it("File", () => {
  expect(BufferModule.File).toBe(Blob);
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

  function assertEqual(a, b) {
    expect(a).toEqual(b);
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
  assertEqual(Buffer.allocUnsafe(1).fill(0).fill("\u0222")[0], 0xc8);

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
  assertEqual(Buffer.allocUnsafe(1).fill("\u0222", "ucs2")[0], 0x22);

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

  // Buffer
  function deepStrictEqualValues(buf, arr) {
    for (const [index, value] of buf.entries()) {
      expect(value).toStrictEqual(arr[index]);
    }
  }

  const buf2Fill = Buffer.allocUnsafe(1).fill(2);
  deepStrictEqualValues(genBuffer(4, [buf2Fill]), [2, 2, 2, 2]);
  deepStrictEqualValues(genBuffer(4, [buf2Fill, 1]), [0, 2, 2, 2]);
  deepStrictEqualValues(genBuffer(4, [buf2Fill, 1, 3]), [0, 2, 2, 0]);
  deepStrictEqualValues(genBuffer(4, [buf2Fill, 1, 1]), [0, 0, 0, 0]);
  const hexBufFill = Buffer.allocUnsafe(2).fill(0).fill("0102", "hex");
  deepStrictEqualValues(genBuffer(4, [hexBufFill]), [1, 2, 1, 2]);
  deepStrictEqualValues(genBuffer(4, [hexBufFill, 1]), [0, 1, 2, 1]);
  deepStrictEqualValues(genBuffer(4, [hexBufFill, 1, 3]), [0, 1, 2, 0]);
  deepStrictEqualValues(genBuffer(4, [hexBufFill, 1, 1]), [0, 0, 0, 0]);

  // Check exceptions
  [
    [0, -1],
    [0, 0, buf1.length + 1],
    ["", -1],
    ["", 0, buf1.length + 1],
    ["", 1, -1],
  ].forEach(args => {
    expect(() => buf1.fill(...args)).toThrow();
  });

  expect(() => buf1.fill("a", 0, buf1.length, "node rocks!")).toThrow();

  [
    ["a", 0, 0, NaN],
    ["a", 0, 0, false],
  ].forEach(args => {
    expect(() => buf1.fill(...args)).toThrow();
  });

  expect(() => buf1.fill("a", 0, 0, "foo")).toThrow();

  function genBuffer(size, args) {
    const b = Buffer.allocUnsafe(size);
    return b.fill(0).fill.apply(b, args);
  }

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

  // Make sure these throw.
  expect(() => Buffer.allocUnsafe(8).fill("a", -1)).toThrow();
  expect(() => Buffer.allocUnsafe(8).fill("a", 0, 9)).toThrow();

  // Make sure this doesn't hang indefinitely.
  Buffer.allocUnsafe(8).fill("");
  Buffer.alloc(8, "");

  {
    const buf = Buffer.alloc(64, 10);
    for (let i = 0; i < buf.length; i++) assertEqual(buf[i], 10);

    buf.fill(11, 0, buf.length >> 1);
    for (let i = 0; i < buf.length >> 1; i++) assertEqual(buf[i], 11);
    for (let i = (buf.length >> 1) + 1; i < buf.length; i++) assertEqual(buf[i], 10);

    buf.fill("h");
    for (let i = 0; i < buf.length; i++) assertEqual(buf[i], "h".charCodeAt(0));

    buf.fill(0);
    for (let i = 0; i < buf.length; i++) assertEqual(buf[i], 0);

    buf.fill(null);
    for (let i = 0; i < buf.length; i++) assertEqual(buf[i], 0);

    buf.fill(1, 16, 32);
    for (let i = 0; i < 16; i++) assertEqual(buf[i], 0);
    for (let i = 16; i < 32; i++) assertEqual(buf[i], 1);
    for (let i = 32; i < buf.length; i++) assertEqual(buf[i], 0);
  }

  {
    const buf = Buffer.alloc(10, "abc");
    assertEqual(buf.toString(), "abcabcabca");
    buf.fill("է");
    assertEqual(buf.toString(), "էէէէէ");
  }

  // // Testing process.binding. Make sure "start" is properly checked for range
  // // errors.
  // assert.throws(
  //   () => {
  //     internalBinding("buffer").fill(Buffer.alloc(1), 1, -1, 0, 1);
  //   },
  //   { code: "ERR_OUT_OF_RANGE" },
  // );

  // Make sure "end" is properly checked, even if it's magically mangled using
  // Symbol.toPrimitive.
  {
    expect(() => {
      const end = {
        [Symbol.toPrimitive]() {
          return 1;
        },
      };
      Buffer.alloc(1).fill(Buffer.alloc(1), 0, end);
    }).toThrow();
  }

  // Testing process.binding. Make sure "end" is properly checked for range
  // errors.
  // assert.throws(
  //   () => {
  //     internalBinding("buffer").fill(Buffer.alloc(1), 1, 1, -2, 1);
  //   },
  //   { code: "ERR_OUT_OF_RANGE" },
  // );

  // Test that bypassing 'length' won't cause an abort.
  expect(() => {
    const buf = Buffer.from("w00t");
    Object.defineProperty(buf, "length", {
      value: 1337,
      enumerable: true,
    });
    buf.fill("");
  }).toThrow();

  assertEqual(Buffer.allocUnsafeSlow(16).fill("ab", "utf16le"), Buffer.from("61006200610062006100620061006200", "hex"));

  assertEqual(Buffer.allocUnsafeSlow(15).fill("ab", "utf16le"), Buffer.from("610062006100620061006200610062", "hex"));

  assertEqual(Buffer.allocUnsafeSlow(16).fill("ab", "utf16le"), Buffer.from("61006200610062006100620061006200", "hex"));
  assertEqual(Buffer.allocUnsafeSlow(16).fill("a", "utf16le"), Buffer.from("61006100610061006100610061006100", "hex"));

  assertEqual(Buffer.allocUnsafeSlow(16).fill("a", "utf16le").toString("utf16le"), "a".repeat(8));
  assertEqual(Buffer.allocUnsafeSlow(16).fill("a", "latin1").toString("latin1"), "a".repeat(16));
  assertEqual(Buffer.allocUnsafeSlow(16).fill("a", "utf8").toString("utf8"), "a".repeat(16));

  assertEqual(Buffer.allocUnsafeSlow(16).fill("Љ", "utf16le").toString("utf16le"), "Љ".repeat(8));
  assertEqual(Buffer.allocUnsafeSlow(16).fill("Љ", "latin1").toString("latin1"), "\t".repeat(16));
  assertEqual(Buffer.allocUnsafeSlow(16).fill("Љ", "utf8").toString("utf8"), "Љ".repeat(8));

  expect(() => {
    const buf = Buffer.from("a".repeat(1000));

    buf.fill("This is not correctly encoded", "hex");
  }).toThrow();
});

test("Buffer.byteLength", () => {
  const SlowBuffer = require("buffer").SlowBuffer;

  [[32, "latin1"], [NaN, "utf8"], [{}, "latin1"], []].forEach(args => {
    assert.throws(() => Buffer.byteLength(...args));
  });

  assert.strictEqual(Buffer.byteLength("", undefined, true), 0);

  assert(ArrayBuffer.isView(new Buffer(10)));
  assert(ArrayBuffer.isView(new SlowBuffer(10)));
  assert(ArrayBuffer.isView(Buffer.alloc(10)));
  assert(ArrayBuffer.isView(Buffer.allocUnsafe(10)));
  assert(ArrayBuffer.isView(Buffer.allocUnsafeSlow(10)));
  assert(ArrayBuffer.isView(Buffer.from("")));

  // buffer
  const incomplete = Buffer.from([0xe4, 0xb8, 0xad, 0xe6, 0x96]);
  assert.strictEqual(Buffer.byteLength(incomplete), 5);
  const ascii = Buffer.from("abc");
  assert.strictEqual(Buffer.byteLength(ascii), 3);

  // ArrayBuffer
  const buffer = new ArrayBuffer(8);
  assert.strictEqual(Buffer.byteLength(buffer), 8);

  // TypedArray
  const int8 = new Int8Array(8);
  assert.strictEqual(Buffer.byteLength(int8), 8);
  const uint8 = new Uint8Array(8);
  assert.strictEqual(Buffer.byteLength(uint8), 8);
  const uintc8 = new Uint8ClampedArray(2);
  assert.strictEqual(Buffer.byteLength(uintc8), 2);
  const int16 = new Int16Array(8);
  assert.strictEqual(Buffer.byteLength(int16), 16);
  const uint16 = new Uint16Array(8);
  assert.strictEqual(Buffer.byteLength(uint16), 16);
  const int32 = new Int32Array(8);
  assert.strictEqual(Buffer.byteLength(int32), 32);
  const uint32 = new Uint32Array(8);
  assert.strictEqual(Buffer.byteLength(uint32), 32);
  const float32 = new Float32Array(8);
  assert.strictEqual(Buffer.byteLength(float32), 32);
  const float64 = new Float64Array(8);
  assert.strictEqual(Buffer.byteLength(float64), 64);

  // DataView
  const dv = new DataView(new ArrayBuffer(2));
  assert.strictEqual(Buffer.byteLength(dv), 2);

  // Special case: zero length string
  assert.strictEqual(Buffer.byteLength("", "ascii"), 0);
  assert.strictEqual(Buffer.byteLength("", "HeX"), 0);

  // utf8
  assert.strictEqual(Buffer.byteLength("∑éllö wørl∂!", "utf-8"), 19);
  assert.strictEqual(Buffer.byteLength("κλμνξο", "utf8"), 12);
  assert.strictEqual(Buffer.byteLength("挵挶挷挸挹", "utf-8"), 15);
  assert.strictEqual(Buffer.byteLength("𠝹𠱓𠱸", "UTF8"), 12);
  // Without an encoding, utf8 should be assumed
  assert.strictEqual(Buffer.byteLength("hey there"), 9);
  assert.strictEqual(Buffer.byteLength("𠱸挶νξ#xx :)"), 17);
  assert.strictEqual(Buffer.byteLength("hello world", ""), 11);
  // It should also be assumed with unrecognized encoding
  assert.strictEqual(Buffer.byteLength("hello world", "abc"), 11);
  assert.strictEqual(Buffer.byteLength("ßœ∑≈", "unkn0wn enc0ding"), 10);

  // base64
  assert.strictEqual(Buffer.byteLength("aGVsbG8gd29ybGQ=", "base64"), 11);
  assert.strictEqual(Buffer.byteLength("aGVsbG8gd29ybGQ=", "BASE64"), 11);
  assert.strictEqual(Buffer.byteLength("bm9kZS5qcyByb2NrcyE=", "base64"), 14);
  assert.strictEqual(Buffer.byteLength("aGkk", "base64"), 3);
  assert.strictEqual(Buffer.byteLength("bHNrZGZsa3NqZmtsc2xrZmFqc2RsZmtqcw==", "base64"), 25);
  // base64url
  assert.strictEqual(Buffer.byteLength("aGVsbG8gd29ybGQ", "base64url"), 11);
  assert.strictEqual(Buffer.byteLength("aGVsbG8gd29ybGQ", "BASE64URL"), 11);
  assert.strictEqual(Buffer.byteLength("bm9kZS5qcyByb2NrcyE", "base64url"), 14);
  assert.strictEqual(Buffer.byteLength("aGkk", "base64url"), 3);
  assert.strictEqual(Buffer.byteLength("bHNrZGZsa3NqZmtsc2xrZmFqc2RsZmtqcw", "base64url"), 25);
  // special padding
  assert.strictEqual(Buffer.byteLength("aaa=", "base64"), 2);
  assert.strictEqual(Buffer.byteLength("aaaa==", "base64"), 3);
  assert.strictEqual(Buffer.byteLength("aaa=", "base64url"), 2);
  assert.strictEqual(Buffer.byteLength("aaaa==", "base64url"), 3);
  assert.strictEqual(Buffer.byteLength("Il était tué", "utf8"), 14);
  assert.strictEqual(Buffer.byteLength("Il était tué"), 14);

  ["ascii", "latin1", "binary"]
    .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
    .forEach(encoding => {
      assert.strictEqual(Buffer.byteLength("Il était tué", encoding), 12);
    });

  ["ucs2", "ucs-2", "utf16le", "utf-16le"]
    .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
    .forEach(encoding => {
      assert.strictEqual(Buffer.byteLength("Il était tué", encoding), 24);
    });

  // Test that ArrayBuffer from a different context is detected correctly
  // const arrayBuf = vm.runInNewContext("new ArrayBuffer()");
  // assert.strictEqual(Buffer.byteLength(arrayBuf), 0);

  // Verify that invalid encodings are treated as utf8
  for (let i = 1; i < 10; i++) {
    const encoding = String(i).repeat(i);

    assert.ok(!Buffer.isEncoding(encoding));
    assert.strictEqual(Buffer.byteLength("foo", encoding), Buffer.byteLength("foo", "utf8"));
  }
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
