//#FILE: test-buffer-tojson.js
//#SHA1: 39b31549a09e67c89316a24c895db2dfab939ec4
//-----------------
"use strict";

test("Buffer JSON serialization", () => {
  expect(JSON.stringify(Buffer.alloc(0))).toBe('{"type":"Buffer","data":[]}');
  expect(JSON.stringify(Buffer.from([1, 2, 3, 4]))).toBe('{"type":"Buffer","data":[1,2,3,4]}');
});

// issue GH-7849
test("Buffer deserialization", () => {
  const buf = Buffer.from("test");
  const json = JSON.stringify(buf);
  const obj = JSON.parse(json);
  const copy = Buffer.from(obj);

  expect(copy).toEqual(buf);
});

// GH-5110
test("Buffer serialization and custom deserialization", () => {
  const buffer = Buffer.from("test");
  const string = JSON.stringify(buffer);

  expect(string).toBe('{"type":"Buffer","data":[116,101,115,116]}');

  function receiver(key, value) {
    return value && value.type === "Buffer" ? Buffer.from(value.data) : value;
  }

  expect(JSON.parse(string, receiver)).toEqual(buffer);
});

//<#END_FILE: test-buffer-tojson.js
