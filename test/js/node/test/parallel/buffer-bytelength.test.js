//#FILE: test-buffer-bytelength.js
//#SHA1: bcc75ad2f868ac9414c789c29f23ee9c806c749d
//-----------------
"use strict";

const SlowBuffer = require("buffer").SlowBuffer;
const vm = require("vm");

test("Buffer.byteLength with invalid arguments", () => {
  [[32, "latin1"], [NaN, "utf8"], [{}, "latin1"], []].forEach(args => {
    expect(() => Buffer.byteLength(...args)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.stringContaining(
          'The "string" argument must be of type string or an instance of Buffer or ArrayBuffer.',
        ),
      }),
    );
  });
});

test("ArrayBuffer.isView for various Buffer types", () => {
  expect(ArrayBuffer.isView(new Buffer(10))).toBe(true);
  expect(ArrayBuffer.isView(new SlowBuffer(10))).toBe(true);
  expect(ArrayBuffer.isView(Buffer.alloc(10))).toBe(true);
  expect(ArrayBuffer.isView(Buffer.allocUnsafe(10))).toBe(true);
  expect(ArrayBuffer.isView(Buffer.allocUnsafeSlow(10))).toBe(true);
  expect(ArrayBuffer.isView(Buffer.from(""))).toBe(true);
});

test("Buffer.byteLength for various buffer types", () => {
  const incomplete = Buffer.from([0xe4, 0xb8, 0xad, 0xe6, 0x96]);
  expect(Buffer.byteLength(incomplete)).toBe(5);

  const ascii = Buffer.from("abc");
  expect(Buffer.byteLength(ascii)).toBe(3);

  const buffer = new ArrayBuffer(8);
  expect(Buffer.byteLength(buffer)).toBe(8);
});

test("Buffer.byteLength for TypedArrays", () => {
  expect(Buffer.byteLength(new Int8Array(8))).toBe(8);
  expect(Buffer.byteLength(new Uint8Array(8))).toBe(8);
  expect(Buffer.byteLength(new Uint8ClampedArray(2))).toBe(2);
  expect(Buffer.byteLength(new Int16Array(8))).toBe(16);
  expect(Buffer.byteLength(new Uint16Array(8))).toBe(16);
  expect(Buffer.byteLength(new Int32Array(8))).toBe(32);
  expect(Buffer.byteLength(new Uint32Array(8))).toBe(32);
  expect(Buffer.byteLength(new Float32Array(8))).toBe(32);
  expect(Buffer.byteLength(new Float64Array(8))).toBe(64);
});

test("Buffer.byteLength for DataView", () => {
  const dv = new DataView(new ArrayBuffer(2));
  expect(Buffer.byteLength(dv)).toBe(2);
});

test("Buffer.byteLength for zero length string", () => {
  expect(Buffer.byteLength("", "ascii")).toBe(0);
  expect(Buffer.byteLength("", "HeX")).toBe(0);
});

test("Buffer.byteLength for utf8", () => {
  expect(Buffer.byteLength("∑éllö wørl∂!", "utf-8")).toBe(19);
  expect(Buffer.byteLength("κλμνξο", "utf8")).toBe(12);
  expect(Buffer.byteLength("挵挶挷挸挹", "utf-8")).toBe(15);
  expect(Buffer.byteLength("𠝹𠱓𠱸", "UTF8")).toBe(12);
  expect(Buffer.byteLength("hey there")).toBe(9);
  expect(Buffer.byteLength("𠱸挶νξ#xx :)")).toBe(17);
  expect(Buffer.byteLength("hello world", "")).toBe(11);
  expect(Buffer.byteLength("hello world", "abc")).toBe(11);
  expect(Buffer.byteLength("ßœ∑≈", "unkn0wn enc0ding")).toBe(10);
});

test("Buffer.byteLength for base64", () => {
  expect(Buffer.byteLength("aGVsbG8gd29ybGQ=", "base64")).toBe(11);
  expect(Buffer.byteLength("aGVsbG8gd29ybGQ=", "BASE64")).toBe(11);
  expect(Buffer.byteLength("bm9kZS5qcyByb2NrcyE=", "base64")).toBe(14);
  expect(Buffer.byteLength("aGkk", "base64")).toBe(3);
  expect(Buffer.byteLength("bHNrZGZsa3NqZmtsc2xrZmFqc2RsZmtqcw==", "base64")).toBe(25);
});

test("Buffer.byteLength for base64url", () => {
  expect(Buffer.byteLength("aGVsbG8gd29ybGQ", "base64url")).toBe(11);
  expect(Buffer.byteLength("aGVsbG8gd29ybGQ", "BASE64URL")).toBe(11);
  expect(Buffer.byteLength("bm9kZS5qcyByb2NrcyE", "base64url")).toBe(14);
  expect(Buffer.byteLength("aGkk", "base64url")).toBe(3);
  expect(Buffer.byteLength("bHNrZGZsa3NqZmtsc2xrZmFqc2RsZmtqcw", "base64url")).toBe(25);
});

test("Buffer.byteLength for special padding", () => {
  expect(Buffer.byteLength("aaa=", "base64")).toBe(2);
  expect(Buffer.byteLength("aaaa==", "base64")).toBe(3);
  expect(Buffer.byteLength("aaa=", "base64url")).toBe(2);
  expect(Buffer.byteLength("aaaa==", "base64url")).toBe(3);
});

test("Buffer.byteLength for various encodings", () => {
  expect(Buffer.byteLength("Il était tué")).toBe(14);
  expect(Buffer.byteLength("Il était tué", "utf8")).toBe(14);

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
});

test("Buffer.byteLength for ArrayBuffer from different context", () => {
  const arrayBuf = vm.runInNewContext("new ArrayBuffer()");
  expect(Buffer.byteLength(arrayBuf)).toBe(0);
});

test("Buffer.byteLength for invalid encodings", () => {
  for (let i = 1; i < 10; i++) {
    const encoding = String(i).repeat(i);

    expect(Buffer.isEncoding(encoding)).toBe(false);
    expect(Buffer.byteLength("foo", encoding)).toBe(Buffer.byteLength("foo", "utf8"));
  }
});

//<#END_FILE: test-buffer-bytelength.js
