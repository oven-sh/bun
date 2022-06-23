import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { gc } from "./gc";

beforeEach(() => gc());
afterEach(() => gc());

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
