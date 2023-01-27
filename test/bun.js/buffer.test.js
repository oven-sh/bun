import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { gc } from "./gc";

const BufferModule = await import("buffer");

beforeEach(() => gc());
afterEach(() => gc());

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
  expect(buf.toString("base64url", 0, "hello world ".length)).toBe(
    btoa("hello world "),
  );
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
  var inputs = [
    "hello world",
    "hello world".repeat(100),
    `😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`,
  ];
  var good = inputs.map((a) => new TextEncoder().encode(a));
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
  expect(Buffer.from("hello world", "ascii").toString("utf8")).toBe(
    "hello world",
  );
  expect(Buffer.from("hello world", "latin1").toString("utf8")).toBe(
    "hello world",
  );
  gc();
  expect(Buffer.from([254]).join(",")).toBe("254");

  expect(Buffer.from([254], "utf8").join(",")).toBe("254");
  expect(Buffer.from([254], "utf-8").join(",")).toBe("254");
  expect(Buffer.from([254], "latin").join(",")).toBe("254");
  expect(Buffer.from([254], "uc2").join(",")).toBe("254");
  expect(Buffer.from([254], "utf16").join(",")).toBe("254");
  expect(Buffer.isBuffer(Buffer.from([254], "utf16"))).toBe(true);

  expect(() => Buffer.from(123).join(",")).toThrow();

  expect(Buffer.from({ length: 124 }).join(",")).toBe(
    Uint8Array.from({ length: 124 }).join(","),
  );

  expect(Buffer.from(new ArrayBuffer(1024), 0, 512).join(",")).toBe(
    new Uint8Array(512).join(","),
  );

  expect(Buffer.from(new Buffer(new ArrayBuffer(1024), 0, 512)).join(",")).toBe(
    new Uint8Array(512).join(","),
  );
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
      1, 29, 0, 0, 1, 143, 216, 162, 92, 254, 248, 63, 0, 0, 0, 18, 184, 6, 0,
      175, 29, 0, 8, 11, 1, 0, 0,
    ]);
    const chunk1 = Buffer.from([
      1, 29, 0, 0, 1, 143, 216, 162, 92, 254, 248, 63, 0,
    ]);
    const chunk2 = Buffer.from([
      0, 0, 18, 184, 6, 0, 175, 29, 0, 8, 11, 1, 0, 0,
    ]);
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
  for (let text of [
    "hello world",
    "1234567890",
    "\uD83D\uDE00",
    "😀😃😄😁😆😅😂🤣☺️😊😊😇",
  ]) {
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
  expect(
    Buffer.concat([array1, array2, array3], 222).subarray(0, 128).join(""),
  ).toBe("100".repeat(128));
  expect(
    Buffer.concat([array1, array2, array3], 222).subarray(129, 222).join(""),
  ).toBe("200".repeat(222 - 129));
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
    expect(buf.toString("utf16le", offset, offset + 32)).toBe(
      "😀😃😄😁😆😅😂🤣",
    );
    expect(buf.toString("utf16le", offset, offset + 36)).toBe(
      "😀😃😄😁😆😅😂🤣☺️",
    );
    expect(buf.toString("utf16le", offset, offset + 40)).toBe(
      "😀😃😄😁😆😅😂🤣☺️😊",
    );
    expect(buf.toString("utf16le", offset, offset + 44)).toBe(
      "😀😃😄😁😆😅😂🤣☺️😊😊",
    );
    expect(buf.toString("utf16le", offset, offset + 48)).toBe(
      "😀😃😄😁😆😅😂🤣☺️😊😊😇",
    );
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
  const encodings = [
    "utf8",
    "utf-8",
    "ucs2",
    "ucs-2",
    "ascii",
    "latin1",
    "binary",
    "utf16le",
    "utf-16le",
  ];

  encodings
    .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
    .forEach((encoding) => {
      reset();

      const len = Buffer.byteLength("foo", encoding);
      expect(buf.write("foo", 0, len, encoding)).toBe(len);

      if (encoding.includes("-")) encoding = encoding.replace("-", "");

      expect(buf).toStrictEqual(resultMap.get(encoding.toLowerCase()));
    });

  // base64
  ["base64", "BASE64", "base64url", "BASE64URL"].forEach((encoding) => {
    reset();

    const len = Buffer.byteLength("Zm9v", encoding);

    expect(buf.write("Zm9v", 0, len, encoding)).toBe(len);
    expect(buf).toStrictEqual(resultMap.get(encoding.toLowerCase()));
  });

  // hex
  ["hex", "HEX"].forEach((encoding) => {
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

  expect(
    Buffer.from(btoa('console.log("hello world")\n'), "base64").toString(),
  ).toBe('console.log("hello world")\n');
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
      .map((x) => x.charCodeAt(0)),
  ).toEqual([65]);
  expect(Buffer.from([65, 0]).toString("base64")).toBe("QQA=");
  expect(
    Buffer.from('{"alg":"RS256","typ":"JWT"}', "latin1").toString("latin1"),
  ).toBe('{"alg":"RS256","typ":"JWT"}');
  expect(
    Buffer.from('{"alg":"RS256","typ":"JWT"}', "utf8").toString("utf8"),
  ).toBe('{"alg":"RS256","typ":"JWT"}');
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
  ].forEach((input) => {
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
