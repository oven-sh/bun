import { expect, it } from "bun:test";
const util = require("node:util");
const buffer = require("node:buffer");
buffer.kMaxLength = 64;
const zlib = require("node:zlib");

const data_sync = {
  brotli: ["1b7f00f825c222b1402003", zlib.brotliDecompress, zlib.brotliDecompressSync],
  inflate: ["789c4b4c1c58000039743081", zlib.inflate, zlib.inflateSync],
  gunzip: ["1f8b08000000000000034b4c1c5800008c362bf180000000", zlib.gunzip, zlib.gunzipSync],
  unzip: ["1f8b08000000000000034b4c1c5800008c362bf180000000", zlib.unzip, zlib.unzipSync],
};

for (const method in data_sync) {
  const [encoded_hex, f_async, f_sync] = data_sync[method];
  const encoded = Buffer.from(encoded_hex, "hex");

  it(`decompress synchronous ${method}`, () => {
    expect(() => f_sync(encoded)).toThrow(RangeError);
  });

  it(`decompress asynchronous ${method}`, async () => {
    expect(async () => await util.promisify(f_async)(encoded)).toThrow(RangeError);
  });
}
