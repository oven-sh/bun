//#FILE: test-fs-readv.js
//#SHA1: 07d6fe434017163aea491c98db8127bc2c942b96
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const expected = "ümlaut. Лорем 運務ホソモ指及 आपको करने विकास 紙読決多密所 أضف";

let cnt = 0;
const getFileName = () => path.join(os.tmpdir(), `readv_${++cnt}.txt`);
const expectedBuff = Buffer.from(expected);

const allocateEmptyBuffers = combinedLength => {
  const bufferArr = [];
  // Allocate two buffers, each half the size of expectedBuff
  bufferArr[0] = Buffer.alloc(Math.floor(combinedLength / 2));
  bufferArr[1] = Buffer.alloc(combinedLength - bufferArr[0].length);

  return bufferArr;
};

const getCallback = (fd, bufferArr) => {
  return (err, bytesRead, buffers) => {
    expect(err).toBeNull();
    expect(bufferArr).toEqual(buffers);
    const expectedLength = expectedBuff.length;
    expect(bytesRead).toBe(expectedLength);
    fs.closeSync(fd);

    expect(Buffer.concat(bufferArr).equals(expectedBuff)).toBe(true);
  };
};

beforeEach(() => {
  jest.spyOn(fs, "writeSync");
  jest.spyOn(fs, "writeFileSync");
  jest.spyOn(fs, "openSync");
  jest.spyOn(fs, "closeSync");
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("fs.readv with array of buffers with all parameters", done => {
  const filename = getFileName();
  const fd = fs.openSync(filename, "w+");
  fs.writeSync(fd, expectedBuff);

  const bufferArr = allocateEmptyBuffers(expectedBuff.length);
  const callback = getCallback(fd, bufferArr);

  fs.readv(fd, bufferArr, 0, (err, bytesRead, buffers) => {
    callback(err, bytesRead, buffers);
    done();
  });
});

test("fs.readv with array of buffers without position", done => {
  const filename = getFileName();
  fs.writeFileSync(filename, expectedBuff);
  const fd = fs.openSync(filename, "r");

  const bufferArr = allocateEmptyBuffers(expectedBuff.length);
  const callback = getCallback(fd, bufferArr);

  fs.readv(fd, bufferArr, (err, bytesRead, buffers) => {
    callback(err, bytesRead, buffers);
    done();
  });
});

describe("Testing with incorrect arguments", () => {
  const wrongInputs = [false, "test", {}, [{}], ["sdf"], null, undefined];

  test("fs.readv with wrong buffers argument", () => {
    const filename = getFileName();
    fs.writeFileSync(filename, expectedBuff);
    const fd = fs.openSync(filename, "r");

    for (const wrongInput of wrongInputs) {
      expect(() => fs.readv(fd, wrongInput, null, jest.fn())).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: expect.any(String),
        }),
      );
    }

    fs.closeSync(fd);
  });

  test("fs.readv with wrong fd argument", () => {
    for (const wrongInput of wrongInputs) {
      expect(() => fs.readv(wrongInput, jest.fn())).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: expect.any(String),
        }),
      );
    }
  });
});

//<#END_FILE: test-fs-readv.js
