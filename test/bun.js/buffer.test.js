import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { gc } from "./gc";

beforeEach(() => gc());
afterEach(() => gc());

it("Buffer.toJSON()", () => {
  expect(JSON.stringify(Buffer.from("hello"))).toBe(
    JSON.stringify({
      type: "Buffer",
      data: [104, 101, 108, 108, 111],
    })
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
    btoa("hello world ")
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
    new TextEncoder().encode("😀😃😄😁😆😅😂🤣☺️😊😊😇").byteLength
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
  Buffer.toBuffer(a);
  gc();
  expect(Buffer.isBuffer(a)).toBe(true);
  gc();
});

it("Buffer.toBuffer throws", () => {
  const checks = [
    [],
    {},
    "foo",
    new Uint16Array(),
    new DataView(new Uint8Array(14).buffer),
  ];
  for (let i = 0; i < checks.length; i++) {
    try {
      Buffer.toBuffer(checks[i]);
      expect(false).toBe(true);
    } catch (exception) {
      expect(exception.message).toBe("Expected Uint8Array");
    }
  }
  expect(true).toBe(true);
});

it("Buffer.toBuffer works", () => {
  var array = new Uint8Array(20);
  expect(array instanceof Buffer).toBe(false);
  var buf = Buffer.toBuffer(array);
  expect(array instanceof Buffer).toBe(true);
  // if this fails or infinitely loops, it means there is a memory issue with the JSC::Structure object
  expect(Object.keys(buf).length > 0).toBe(true);

  expect(buf.write("hello world ")).toBe(12);
  gc();
  expect(buf.toString("utf8", 0, "hello world ".length)).toBe("hello world ");
  gc();
  expect(buf.toString("base64url", 0, "hello world ".length)).toBe(
    btoa("hello world ")
  );
  gc();

  expect(buf instanceof Uint8Array).toBe(true);
  expect(buf instanceof Buffer).toBe(true);
  expect(buf.slice() instanceof Uint8Array).toBe(true);
  expect(buf.slice(0, 1) instanceof Buffer).toBe(true);
  expect(buf.slice(0, 1) instanceof Uint8Array).toBe(true);
  expect(buf.slice(0, 1) instanceof Buffer).toBe(true);
  expect(new Buffer(buf) instanceof Buffer).toBe(true);
  expect(new Buffer(buf.buffer) instanceof Buffer).toBe(true);
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
    "hello world"
  );
  expect(Buffer.from("hello world", "latin1").toString("utf8")).toBe(
    "hello world"
  );
  gc();
  expect(Buffer.from([254]).join(",")).toBe("254");

  expect(Buffer.from([254], "utf8").join(",")).toBe("254");
  expect(Buffer.from([254], "utf-8").join(",")).toBe("254");
  expect(Buffer.from([254], "latin").join(",")).toBe("254");
  expect(Buffer.from([254], "uc2").join(",")).toBe("254");
  expect(Buffer.from([254], "utf16").join(",")).toBe("254");
  expect(Buffer.isBuffer(Buffer.from([254], "utf16"))).toBe(true);

  expect(Buffer.from(123).join(",")).toBe(Uint8Array.from(123).join(","));
  expect(Buffer.from({ length: 124 }).join(",")).toBe(
    Uint8Array.from({ length: 124 }).join(",")
  );

  expect(Buffer.from(new ArrayBuffer(1024), 0, 512).join(",")).toBe(
    new Uint8Array(512).join(",")
  );

  expect(Buffer.from(new Buffer(new ArrayBuffer(1024), 0, 512)).join(",")).toBe(
    new Uint8Array(512).join(",")
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
  Buffer.toBuffer(a);
  Buffer.toBuffer(b);
  expect(a.equals(b)).toBe(true);
  b[2] = 0;
  expect(a.equals(b)).toBe(false);
});

it("Buffer.compare", () => {
  var a = new Uint8Array(10);
  a[2] = 1;
  var b = new Uint8Array(10);
  b[2] = 1;
  Buffer.toBuffer(a);
  Buffer.toBuffer(b);
  expect(a.compare(b)).toBe(0);
  b[2] = 0;
  expect(a.compare(b)).toBe(1);
  expect(b.compare(a)).toBe(-1);
});

it("Buffer.copy", () => {
  var array1 = new Uint8Array(128);
  array1.fill(100);
  Buffer.toBuffer(array1);
  var array2 = new Uint8Array(128);
  array2.fill(200);
  Buffer.toBuffer(array2);
  var array3 = new Uint8Array(128);
  Buffer.toBuffer(array3);
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
    array1.join("") + array2.join("") + array3.join("")
  );
  expect(Buffer.concat([array1, array2, array3], 222).length).toBe(222);
  expect(
    Buffer.concat([array1, array2, array3], 222).subarray(0, 128).join("")
  ).toBe("100".repeat(128));
  expect(
    Buffer.concat([array1, array2, array3], 222).subarray(129, 222).join("")
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

it("write", () => {
  let buf = Buffer.alloc(16);
  function reset() {
    new Uint8Array(buf.buffer).fill(0);
  }

  expect(buf.write("hello", 8, 8)).toBe(5);
  reset();

  expect(buf.write("hello!", 3, 8)).toBe(6);
  reset();

  expect(buf.write("Foo Bar!", 4, 4)).toBe(4);
  reset();

  expect(buf.write("foo", 0, 1)).toBe(1);
  reset();

  expect(buf.write("foo", 0, 2)).toBe(2);
  reset();

  expect(buf.write("foo", 0)).toBe(3);
  reset();

  expect(buf.write("Foo Bar!", 4, 6)).toBe(6);
  reset();

  expect(buf.write("Foo Bar!", 4, 7)).toBe(7);
  reset();
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
