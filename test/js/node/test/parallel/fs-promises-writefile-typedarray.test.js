//#FILE: test-fs-promises-writefile-typedarray.js
//#SHA1: 718d3827c56ad0b11c59a801bf9529a1e6e5ab89
//-----------------
"use strict";

const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const os = require("os");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));

beforeAll(() => {
  // Ensure the temporary directory is clean
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  // Clean up the temporary directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const dest = path.resolve(tmpDir, "tmp.txt");
// Use a file size larger than `kReadFileMaxChunkSize`.
const buffer = Buffer.from("012".repeat(2 ** 14));

test("fsPromises.writeFile with TypedArrays", async () => {
  const constructors = [Uint8Array, Uint16Array, Uint32Array];

  for (const Constructor of constructors) {
    const array = new Constructor(buffer.buffer);
    await fsPromises.writeFile(dest, array);
    const data = await fsPromises.readFile(dest);
    expect(data).toEqual(buffer);
  }
});

//<#END_FILE: test-fs-promises-writefile-typedarray.js
