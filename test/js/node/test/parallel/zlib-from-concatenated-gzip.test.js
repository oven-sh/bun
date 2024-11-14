//#FILE: test-zlib-from-concatenated-gzip.js
//#SHA1: cf8f45097fb201dc583ee154b34585b6a0a0dc34
//-----------------
"use strict";
// Test unzipping a gzip file that contains multiple concatenated "members"

const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const abc = "abc";
const def = "def";

const abcEncoded = zlib.gzipSync(abc);
const defEncoded = zlib.gzipSync(def);

const data = Buffer.concat([abcEncoded, defEncoded]);

test("gunzipSync concatenated gzip members", () => {
  expect(zlib.gunzipSync(data).toString()).toBe(abc + def);
});

test("gunzip concatenated gzip members", async () => {
  const result = await new Promise((resolve, reject) => {
    zlib.gunzip(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
  expect(result.toString()).toBe(abc + def);
});

test("unzip concatenated gzip members", async () => {
  const result = await new Promise((resolve, reject) => {
    zlib.unzip(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
  expect(result.toString()).toBe(abc + def);
});

test("unzip concatenated deflate members", async () => {
  const result = await new Promise((resolve, reject) => {
    zlib.unzip(Buffer.concat([zlib.deflateSync("abc"), zlib.deflateSync("def")]), (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
  expect(result.toString()).toBe(abc);
});

test("pseudo-multimember gzip file", async () => {
  const pmmFileZlib = path.join(__dirname, "../fixtures/pseudo-multimember-gzip.z");
  const pmmFileGz = path.join(__dirname, "../fixtures/pseudo-multimember-gzip.gz");

  const pmmExpected = zlib.inflateSync(fs.readFileSync(pmmFileZlib));
  const pmmResultBuffers = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(pmmFileGz)
      .pipe(zlib.createGunzip())
      .on("error", reject)
      .on("data", data => pmmResultBuffers.push(data))
      .on("finish", resolve);
  });

  // Result should match original random garbage
  expect(Buffer.concat(pmmResultBuffers)).toEqual(pmmExpected);
});

test("gzip member wrapping around input buffer boundary", async () => {
  const offsets = [0, 1, 2, 3, 4, defEncoded.length];

  for (const offset of offsets) {
    const resultBuffers = [];

    await new Promise((resolve, reject) => {
      const unzip = zlib
        .createGunzip()
        .on("error", reject)
        .on("data", data => resultBuffers.push(data))
        .on("finish", resolve);

      // First write: write "abc" + the first bytes of "def"
      unzip.write(Buffer.concat([abcEncoded, defEncoded.slice(0, offset)]));

      // Write remaining bytes of "def"
      unzip.end(defEncoded.slice(offset));
    });

    expect(Buffer.concat(resultBuffers).toString()).toBe(
      "abcdef",
      `result should match original input (offset = ${offset})`,
    );
  }
});

//<#END_FILE: test-zlib-from-concatenated-gzip.js
