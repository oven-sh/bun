//#FILE: test-buffer-fill.js
//#SHA1: 983940aa8a47c4d0985c2c4b4d1bc323a4e7d0f5
//-----------------
"use strict";

const SIZE = 28;

let buf1, buf2;

beforeEach(() => {
  buf1 = Buffer.allocUnsafe(SIZE);
  buf2 = Buffer.allocUnsafe(SIZE);
});

// Helper functions
function genBuffer(size, args) {
  const b = Buffer.allocUnsafe(size);
  return b.fill(0).fill.apply(b, args);
}

function bufReset() {
  buf1.fill(0);
  buf2.fill(0);
}

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

  if (offset < 0 || end > buf2.length) throw new RangeError("ERR_OUT_OF_RANGE");

  if (end <= offset) return buf2;

  offset >>>= 0;
  end >>>= 0;
  expect(offset).toBeLessThanOrEqual(buf2.length);

  const length = end - offset < 0 ? 0 : end - offset;

  let wasZero = false;
  do {
    const written = buf2.write(string, offset, length, encoding);
    offset += written;
    if (written === 0) {
      if (wasZero) throw new Error("Could not write all data to Buffer");
      else wasZero = true;
    }
  } while (offset < buf2.length);

  return buf2;
}

function testBufs(string, offset, length, encoding) {
  bufReset();
  buf1.fill.apply(buf1, arguments);
  expect(buf1.fill.apply(buf1, arguments)).toEqual(writeToFill.apply(null, arguments));
}

// Tests
test("Default encoding", () => {
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
});

test("UTF8 encoding", () => {
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
});

test("BINARY encoding", () => {
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
});

test("LATIN1 encoding", () => {
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
});

test("UCS2 encoding", () => {
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
});

test("HEX encoding", () => {
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
});

test("Invalid HEX encoding", () => {
  expect(() => {
    const buf = Buffer.allocUnsafe(SIZE);
    buf.fill("yKJh", "hex");
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_VALUE",
      name: "TypeError",
    }),
  );

  expect(() => {
    const buf = Buffer.allocUnsafe(SIZE);
    buf.fill("\u0222", "hex");
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_VALUE",
      name: "TypeError",
    }),
  );
});

test("BASE64 encoding", () => {
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
});

test("BASE64URL encoding", () => {
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

test("Buffer fill", () => {
  function deepStrictEqualValues(buf, arr) {
    for (const [index, value] of buf.entries()) {
      expect(value).toBe(arr[index]);
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
});

test("Check exceptions", () => {
  [
    [0, -1],
    [0, 0, buf1.length + 1],
    ["", -1],
    ["", 0, buf1.length + 1],
    ["", 1, -1],
  ].forEach(args => {
    expect(() => buf1.fill(...args)).toThrow(
      expect.objectContaining({
        code: "ERR_OUT_OF_RANGE",
      }),
    );
  });

  expect(() => buf1.fill("a", 0, buf1.length, "node rocks!")).toThrow(
    expect.objectContaining({
      code: "ERR_UNKNOWN_ENCODING",
      name: "TypeError",
      message: "Unknown encoding: node rocks!",
    }),
  );

  [
    ["a", 0, 0, NaN],
    ["a", 0, 0, false],
  ].forEach(args => {
    expect(() => buf1.fill(...args)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining('The "encoding" argument must be of type string'),
      }),
    );
  });

  expect(() => buf1.fill("a", 0, 0, "foo")).toThrow(
    expect.objectContaining({
      code: "ERR_UNKNOWN_ENCODING",
      name: "TypeError",
      message: "Unknown encoding: foo",
    }),
  );
});

test("Out of range errors", () => {
  expect(() => Buffer.allocUnsafe(8).fill("a", -1)).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
    }),
  );
  expect(() => Buffer.allocUnsafe(8).fill("a", 0, 9)).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
    }),
  );
});

test("Empty fill", () => {
  Buffer.allocUnsafe(8).fill("");
  Buffer.alloc(8, "");
});

test("Buffer allocation and fill", () => {
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

test("Buffer fill with string", () => {
  const buf = Buffer.alloc(10, "abc");
  expect(buf.toString()).toBe("abcabcabca");
  buf.fill("է");
  expect(buf.toString()).toBe("էէէէէ");
});

test("Buffer fill with invalid end", () => {
  expect(() => {
    const end = {
      [Symbol.toPrimitive]() {
        return 1;
      },
    };
    Buffer.alloc(1).fill(Buffer.alloc(1), 0, end);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.stringContaining('The "end" argument must be of type number. Received'),
    }),
  );
});

test.todo("Buffer fill with invalid length", () => {
  expect(() => {
    const buf = Buffer.from("w00t");
    Object.defineProperty(buf, "length", {
      value: 1337,
      enumerable: true,
    });
    buf.fill("");
  }).toThrow(
    expect.objectContaining({
      code: "ERR_BUFFER_OUT_OF_BOUNDS",
      name: "RangeError",
      message: "Attempt to access memory outside buffer bounds",
    }),
  );
});

test("Buffer fill with utf16le encoding", () => {
  expect(Buffer.allocUnsafeSlow(16).fill("ab", "utf16le")).toEqual(
    Buffer.from("61006200610062006100620061006200", "hex"),
  );

  expect(Buffer.allocUnsafeSlow(15).fill("ab", "utf16le")).toEqual(
    Buffer.from("610062006100620061006200610062", "hex"),
  );

  expect(Buffer.allocUnsafeSlow(16).fill("ab", "utf16le")).toEqual(
    Buffer.from("61006200610062006100620061006200", "hex"),
  );
  expect(Buffer.allocUnsafeSlow(16).fill("a", "utf16le")).toEqual(
    Buffer.from("61006100610061006100610061006100", "hex"),
  );

  expect(Buffer.allocUnsafeSlow(16).fill("a", "utf16le").toString("utf16le")).toBe("a".repeat(8));
  expect(Buffer.allocUnsafeSlow(16).fill("a", "latin1").toString("latin1")).toBe("a".repeat(16));
  expect(Buffer.allocUnsafeSlow(16).fill("a", "utf8").toString("utf8")).toBe("a".repeat(16));

  expect(Buffer.allocUnsafeSlow(16).fill("Љ", "utf16le").toString("utf16le")).toBe("Љ".repeat(8));
  expect(Buffer.allocUnsafeSlow(16).fill("Љ", "latin1").toString("latin1")).toBe("\t".repeat(16));
  expect(Buffer.allocUnsafeSlow(16).fill("Љ", "utf8").toString("utf8")).toBe("Љ".repeat(8));
});

test("Buffer fill with invalid hex encoding", () => {
  expect(() => {
    const buf = Buffer.from("a".repeat(1000));
    buf.fill("This is not correctly encoded", "hex");
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_VALUE",
      name: "TypeError",
    }),
  );
});

test("Buffer fill with empty values", () => {
  const bufEmptyString = Buffer.alloc(5, "");
  expect(bufEmptyString.toString()).toBe("\x00\x00\x00\x00\x00");

  const bufEmptyArray = Buffer.alloc(5, []);
  expect(bufEmptyArray.toString()).toBe("\x00\x00\x00\x00\x00");

  const bufEmptyBuffer = Buffer.alloc(5, Buffer.alloc(5));
  expect(bufEmptyBuffer.toString()).toBe("\x00\x00\x00\x00\x00");

  const bufZero = Buffer.alloc(5, 0);
  expect(bufZero.toString()).toBe("\x00\x00\x00\x00\x00");
});

//<#END_FILE: test-buffer-fill.js
