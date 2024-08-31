//#FILE: test-fs-readv-promises.js
//#SHA1: 43d801fa8a2eabf438e98f5aa713eb9680fe798b
//-----------------
"use strict";

const fs = require("fs").promises;
const path = require("path");
const os = require("os");

const expected = "ümlaut. Лорем 運務ホソモ指及 आपको करने विकास 紙読決多密所 أضف";
const expectedBuff = Buffer.from(expected);

let cnt = 0;
function getFileName() {
  return path.join(os.tmpdir(), `readv_promises_${++cnt}.txt`);
}

const allocateEmptyBuffers = combinedLength => {
  const bufferArr = [];
  // Allocate two buffers, each half the size of expectedBuff
  bufferArr[0] = Buffer.alloc(Math.floor(combinedLength / 2));
  bufferArr[1] = Buffer.alloc(combinedLength - bufferArr[0].length);

  return bufferArr;
};

describe("fs.promises.readv", () => {
  beforeEach(() => {
    cnt = 0;
  });

  test("readv with position", async () => {
    const filename = getFileName();
    await fs.writeFile(filename, expectedBuff);
    const handle = await fs.open(filename, "r");
    const bufferArr = allocateEmptyBuffers(expectedBuff.length);
    const expectedLength = expectedBuff.length;

    let { bytesRead, buffers } = await handle.readv([Buffer.from("")], null);
    expect(bytesRead).toBe(0);
    expect(buffers).toEqual([Buffer.from("")]);

    ({ bytesRead, buffers } = await handle.readv(bufferArr, null));
    expect(bytesRead).toBe(expectedLength);
    expect(buffers).toEqual(bufferArr);
    expect(Buffer.concat(bufferArr)).toEqual(await fs.readFile(filename));
    await handle.close();
  });

  test("readv without position", async () => {
    const filename = getFileName();
    await fs.writeFile(filename, expectedBuff);
    const handle = await fs.open(filename, "r");
    const bufferArr = allocateEmptyBuffers(expectedBuff.length);
    const expectedLength = expectedBuff.length;

    let { bytesRead, buffers } = await handle.readv([Buffer.from("")]);
    expect(bytesRead).toBe(0);
    expect(buffers).toEqual([Buffer.from("")]);

    ({ bytesRead, buffers } = await handle.readv(bufferArr));
    expect(bytesRead).toBe(expectedLength);
    expect(buffers).toEqual(bufferArr);
    expect(Buffer.concat(bufferArr)).toEqual(await fs.readFile(filename));
    await handle.close();
  });
});

//<#END_FILE: test-fs-readv-promises.js
