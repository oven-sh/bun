//#FILE: test-fs-readv-sync.js
//#SHA1: e9a4527b118e4a814a04c976eaafb5127f7c7c9d
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const expected = "ümlaut. Лорем 運務ホソモ指及 आपको करने विकास 紙読決多密所 أضف";

const exptectedBuff = Buffer.from(expected);
const expectedLength = exptectedBuff.length;

let filename;
let tmpdir;

beforeAll(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "test-fs-readv-sync-"));
  filename = path.join(tmpdir, "readv_sync.txt");
  fs.writeFileSync(filename, exptectedBuff);
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

const allocateEmptyBuffers = combinedLength => {
  const bufferArr = [];
  // Allocate two buffers, each half the size of exptectedBuff
  bufferArr[0] = Buffer.alloc(Math.floor(combinedLength / 2));
  bufferArr[1] = Buffer.alloc(combinedLength - bufferArr[0].length);

  return bufferArr;
};

// fs.readvSync with array of buffers with all parameters
test("fs.readvSync with array of buffers with all parameters", () => {
  const fd = fs.openSync(filename, "r");

  const bufferArr = allocateEmptyBuffers(exptectedBuff.length);

  let read = fs.readvSync(fd, [Buffer.from("")], 0);
  expect(read).toBe(0);

  read = fs.readvSync(fd, bufferArr, 0);
  expect(read).toBe(expectedLength);

  fs.closeSync(fd);

  expect(Buffer.concat(bufferArr)).toEqual(fs.readFileSync(filename));
});

// fs.readvSync with array of buffers without position
test("fs.readvSync with array of buffers without position", () => {
  const fd = fs.openSync(filename, "r");

  const bufferArr = allocateEmptyBuffers(exptectedBuff.length);

  let read = fs.readvSync(fd, [Buffer.from("")]);
  expect(read).toBe(0);

  read = fs.readvSync(fd, bufferArr);
  expect(read).toBe(expectedLength);

  fs.closeSync(fd);

  expect(Buffer.concat(bufferArr)).toEqual(fs.readFileSync(filename));
});

/**
 * Testing with incorrect arguments
 */
const wrongInputs = [false, "test", {}, [{}], ["sdf"], null, undefined];

test("fs.readvSync with incorrect arguments", () => {
  const fd = fs.openSync(filename, "r");

  for (const wrongInput of wrongInputs) {
    expect(() => fs.readvSync(fd, wrongInput, null)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  }

  fs.closeSync(fd);
});

test("fs.readvSync with wrong fd argument", () => {
  for (const wrongInput of wrongInputs) {
    expect(() => fs.readvSync(wrongInput)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  }
});

//<#END_FILE: test-fs-readv-sync.js
