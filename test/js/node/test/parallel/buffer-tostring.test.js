//#FILE: test-buffer-tostring.js
//#SHA1: 0a6490b6dd4c343c01828d1c4ff81b745b6b1552
//-----------------
"use strict";

// utf8, ucs2, ascii, latin1, utf16le
const encodings = ["utf8", "utf-8", "ucs2", "ucs-2", "ascii", "latin1", "binary", "utf16le", "utf-16le"];

test("Buffer.from().toString() with various encodings", () => {
  encodings
    .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
    .forEach(encoding => {
      expect(Buffer.from("foo", encoding).toString(encoding)).toBe("foo");
    });
});

test("Buffer.from().toString() with base64 encoding", () => {
  ["base64", "BASE64"].forEach(encoding => {
    expect(Buffer.from("Zm9v", encoding).toString(encoding)).toBe("Zm9v");
  });
});

test("Buffer.from().toString() with hex encoding", () => {
  ["hex", "HEX"].forEach(encoding => {
    expect(Buffer.from("666f6f", encoding).toString(encoding)).toBe("666f6f");
  });
});

test("Buffer.from().toString() with invalid encodings", () => {
  for (let i = 1; i < 10; i++) {
    const encoding = String(i).repeat(i);
    expect(Buffer.isEncoding(encoding)).toBe(false);
    expect(() => Buffer.from("foo").toString(encoding)).toThrow(
      expect.objectContaining({
        code: "ERR_UNKNOWN_ENCODING",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  }
});

//<#END_FILE: test-buffer-tostring.js
