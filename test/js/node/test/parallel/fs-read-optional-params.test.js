//#FILE: test-fs-read-optional-params.js
//#SHA1: daea619faa084927d87381fc60aedde3068a13ca
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const filepath = path.join(os.tmpdir(), "x.txt");
const expected = Buffer.from("xyz\n");
const defaultBufferAsync = Buffer.alloc(16384);
const bufferAsOption = Buffer.allocUnsafe(expected.byteLength);

beforeAll(() => {
  fs.writeFileSync(filepath, expected);
});

afterAll(() => {
  fs.unlinkSync(filepath);
});

function testValid(message, ...options) {
  test(`${message} (as params)`, async () => {
    const paramsFilehandle = fs.openSync(filepath, "r");
    await new Promise(resolve => {
      fs.read(paramsFilehandle, ...options, (err, bytesRead, buffer) => {
        expect(err).toBeNull();
        expect(bytesRead).toBe(expected.byteLength);
        expect(buffer.byteLength).toBe(defaultBufferAsync.byteLength);
        fs.closeSync(paramsFilehandle);
        resolve();
      });
    });
  });

  test(`${message} (as options)`, async () => {
    const optionsFilehandle = fs.openSync(filepath, "r");
    await new Promise(resolve => {
      fs.read(optionsFilehandle, bufferAsOption, ...options, (err, bytesRead, buffer) => {
        expect(err).toBeNull();
        expect(bytesRead).toBe(expected.byteLength);
        expect(buffer.byteLength).toBe(bufferAsOption.byteLength);
        fs.closeSync(optionsFilehandle);
        resolve();
      });
    });
  });
}

testValid("Not passing in any object");
testValid("Passing in a null", null);
testValid("Passing in an empty object", {});
testValid("Passing in an object", {
  offset: 0,
  length: bufferAsOption.byteLength,
  position: 0,
});

//<#END_FILE: test-fs-read-optional-params.js
