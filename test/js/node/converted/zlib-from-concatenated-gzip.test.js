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

test("gunzipSync concatenated data", () => {
  expect(zlib.gunzipSync(data).toString()).toBe(abc + def);
});

test("gunzip concatenated data", async () => {
  await expect(new Promise(resolve => zlib.gunzip(data, (_, result) => resolve(result)))).resolves.toEqual(
    expect.any(Buffer),
  );
});

test("unzip concatenated data", async () => {
  await expect(new Promise(resolve => zlib.unzip(data, (_, result) => resolve(result)))).resolves.toEqual(
    expect.any(Buffer),
  );
});

test("unzip deflated data", async () => {
  const deflatedData = Buffer.concat([zlib.deflateSync("abc"), zlib.deflateSync("def")]);
  await expect(new Promise(resolve => zlib.unzip(deflatedData, (_, result) => resolve(result)))).resolves.toEqual(
    expect.any(Buffer),
  );
});

test("pseudo-multimember gzip file", async () => {
  const fixturesPath = path.join(__dirname, "..", "fixtures");
  const pmmFileZlib = path.join(fixturesPath, "pseudo-multimember-gzip.z");
  const pmmFileGz = path.join(fixturesPath, "pseudo-multimember-gzip.gz");

  const pmmExpected = zlib.inflateSync(fs.readFileSync(pmmFileZlib));
  const pmmResultBuffers = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(pmmFileGz)
      .pipe(zlib.createGunzip())
      .on("error", reject)
      .on("data", data => pmmResultBuffers.push(data))
      .on("finish", () => {
        expect(Buffer.concat(pmmResultBuffers)).toEqual(pmmExpected);
        resolve();
      });
  });
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
        .on("finish", () => {
          expect(Buffer.concat(resultBuffers).toString()).toBe(
            "abcdef",
            `result should match original input (offset = ${offset})`,
          );
          resolve();
        });

      // First write: write "abc" + the first bytes of "def"
      unzip.write(Buffer.concat([abcEncoded, defEncoded.slice(0, offset)]));

      // Write remaining bytes of "def"
      unzip.end(defEncoded.slice(offset));
    });
  }
});
