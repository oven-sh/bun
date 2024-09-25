//#FILE: test-zlib-from-gzip-with-trailing-garbage.js
//#SHA1: 8c3ebbede1912a48995aaada3c3e470d48bc01f3
//-----------------
"use strict";
const zlib = require("zlib");

describe("Unzipping a gzip file with trailing garbage", () => {
  test("Should ignore trailing null-bytes", () => {
    const data = Buffer.concat([zlib.gzipSync("abc"), zlib.gzipSync("def"), Buffer.alloc(10)]);

    expect(zlib.gunzipSync(data).toString()).toBe("abcdef");
  });

  test("Should ignore trailing null-bytes (async)", async () => {
    const data = Buffer.concat([zlib.gzipSync("abc"), zlib.gzipSync("def"), Buffer.alloc(10)]);

    const result = await new Promise((resolve, reject) => {
      zlib.gunzip(data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    expect(result.toString()).toBe("abcdef");
  });

  test("Should throw error if trailing garbage looks like a gzip header", () => {
    const data = Buffer.concat([
      zlib.gzipSync("abc"),
      zlib.gzipSync("def"),
      Buffer.from([0x1f, 0x8b, 0xff, 0xff]),
      Buffer.alloc(10),
    ]);

    expect(() => zlib.gunzipSync(data)).toThrow("unknown compression method");
  });

  test("Should throw error if trailing garbage looks like a gzip header (async)", async () => {
    const data = Buffer.concat([
      zlib.gzipSync("abc"),
      zlib.gzipSync("def"),
      Buffer.from([0x1f, 0x8b, 0xff, 0xff]),
      Buffer.alloc(10),
    ]);

    await expect(
      new Promise((resolve, reject) => {
        zlib.gunzip(data, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      }),
    ).rejects.toThrow("unknown compression method");
  });

  test("Should throw error if trailing junk is too short to be a gzip segment", () => {
    const data = Buffer.concat([zlib.gzipSync("abc"), zlib.gzipSync("def"), Buffer.from([0x1f, 0x8b, 0xff, 0xff])]);

    expect(() => zlib.gunzipSync(data)).toThrow("unknown compression method");
  });

  test("Should throw error if trailing junk is too short to be a gzip segment (async)", async () => {
    const data = Buffer.concat([zlib.gzipSync("abc"), zlib.gzipSync("def"), Buffer.from([0x1f, 0x8b, 0xff, 0xff])]);

    await expect(
      new Promise((resolve, reject) => {
        zlib.gunzip(data, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      }),
    ).rejects.toThrow("unknown compression method");
  });
});

//<#END_FILE: test-zlib-from-gzip-with-trailing-garbage.js
