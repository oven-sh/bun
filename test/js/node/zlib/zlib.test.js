import { deflateSync, gunzipSync, gzipSync, inflateSync } from "bun";
import { describe, expect, it } from "bun:test";
import { tmpdirSync } from "harness";
import * as buffer from "node:buffer";
import * as fs from "node:fs";
import { resolve } from "node:path";
import * as stream from "node:stream";
import * as util from "node:util";
import * as zlib from "node:zlib";

describe("zlib", () => {
  for (let library of ["zlib", "libdeflate"]) {
    for (let outputLibrary of ["zlib", "libdeflate"]) {
      describe(`${library} -> ${outputLibrary}`, () => {
        it("should be able to deflate and inflate", () => {
          const data = new TextEncoder().encode("Hello World!".repeat(1));
          const compressed = deflateSync(data, { library });
          console.log(compressed);
          const decompressed = inflateSync(compressed, { library: outputLibrary });
          expect(decompressed.join("")).toBe(data.join(""));
        });

        it("should be able to gzip and gunzip", () => {
          const data = new TextEncoder().encode("Hello World!".repeat(1));
          const compressed = gzipSync(data, { library });
          const decompressed = gunzipSync(compressed, { library: outputLibrary });
          expect(decompressed.join("")).toBe(data.join(""));
        });
      });
    }
  }

  it("should throw on invalid raw deflate data", () => {
    const data = new TextEncoder().encode("Hello World!".repeat(1));
    expect(() => inflateSync(data, { library: "zlib" })).toThrow(new Error("invalid stored block lengths"));
  });

  it("should throw on invalid gzip data", () => {
    const data = new TextEncoder().encode("Hello World!".repeat(1));
    expect(() => gunzipSync(data, { library: "zlib" })).toThrow(new Error("incorrect header check"));
  });
});

function* window(buffer, size, advance = size) {
  let i = 0;
  while (i <= buffer.length) {
    yield buffer.slice(i, i + size);
    i += advance;
  }
}

describe("zlib.gunzip", () => {
  it("should be able to unzip a Buffer and return an unzipped Buffer", async () => {
    const content = fs.readFileSync(import.meta.dir + "/fixture.html.gz");
    return new Promise((resolve, reject) => {
      zlib.gunzip(content, (error, data) => {
        if (error) {
          reject(error);
          return;
        }
        expect(data !== null).toBe(true);
        expect(buffer.Buffer.isBuffer(data)).toBe(true);
        resolve(true);
      });
    });
  });
});

describe("zlib.brotli", () => {
  const inputString =
    "ΩΩLorem ipsum dolor sit amet, consectetur adipiscing eli" +
    "t. Morbi faucibus, purus at gravida dictum, libero arcu " +
    "convallis lacus, in commodo libero metus eu nisi. Nullam" +
    " commodo, neque nec porta placerat, nisi est fermentum a" +
    "ugue, vitae gravida tellus sapien sit amet tellus. Aenea" +
    "n non diam orci. Proin quis elit turpis. Suspendisse non" +
    " diam ipsum. Suspendisse nec ullamcorper odio. Vestibulu" +
    "m arcu mi, sodales non suscipit id, ultrices ut massa. S" +
    "ed ac sem sit amet arcu malesuada fermentum. Nunc sed. ";
  const compressedString =
    "G/gBQBwHdky2aHV5KK9Snf05//1pPdmNw/7232fnIm1IB" +
    "K1AA8RsN8OB8Nb7Lpgk3UWWUlzQXZyHQeBBbXMTQXC1j7" +
    "wg3LJs9LqOGHRH2bj/a2iCTLLx8hBOyTqgoVuD1e+Qqdn" +
    "f1rkUNyrWq6LtOhWgxP3QUwdhKGdZm3rJWaDDBV7+pDk1" +
    "MIkrmjp4ma2xVi5MsgJScA3tP1I7mXeby6MELozrwoBQD" +
    "mVTnEAicZNj4lkGqntJe2qSnGyeMmcFgraK94vCg/4iLu" +
    "Tw5RhKhnVY++dZ6niUBmRqIutsjf5TzwF5iAg8a9UkjF5" +
    "2eZ0tB2vo6v8SqVfNMkBmmhxr0NT9LkYF69aEjlYzj7IE" +
    "KmEUQf1HBogRYhFIt4ymRNEgHAIzOyNEsQM=";
  const compressedBuffer = Buffer.from(compressedString, "base64");

  it("brotliCompress", async () => {
    const compressed = await util.promisify(zlib.brotliCompress)(inputString);
    expect(compressed.toString()).toEqual(compressedBuffer.toString());
  });

  it("brotliDecompress", async () => {
    const roundtrip = await util.promisify(zlib.brotliDecompress)(compressedBuffer);
    expect(roundtrip.toString()).toEqual(inputString);
  });

  it("brotliCompressSync", () => {
    const compressed = zlib.brotliCompressSync(inputString);
    expect(compressed.toString()).toEqual(compressedBuffer.toString());
  });

  it("brotliDecompressSync", () => {
    const roundtrip = zlib.brotliDecompressSync(compressedBuffer);
    expect(roundtrip.toString()).toEqual(inputString);
  });

  it("can compress streaming", () => {
    const encoder = zlib.createBrotliCompress();
    for (const chunk of window(inputString, 55)) {
      encoder._transform(chunk, undefined, (err, data) => {
        expect(err).toBeUndefined();
        expect(data).toEqual(Buffer(0));
      });
    }
    encoder._flush((err, data) => {
      expect(err).toBeUndefined();
      expect(data).toEqual(compressedBuffer);
    });
  });

  it("can decompress streaming", () => {
    const decoder = zlib.createBrotliDecompress();
    for (const chunk of window(compressedBuffer, 10)) {
      decoder._transform(chunk, undefined, (err, data) => {
        expect(err).toBeUndefined();
        expect(data).toEqual(Buffer(0));
      });
    }
    decoder._flush((err, data) => {
      expect(err).toBeUndefined();
      expect(data).toEqual(Buffer.from(inputString));
    });
  });

  it("can roundtrip an empty string", async () => {
    const input = "";
    const compressed = await util.promisify(zlib.brotliCompress)(input);
    const roundtrip = await util.promisify(zlib.brotliDecompress)(compressed);
    expect(roundtrip.toString()).toEqual(input);
  });

  it("can compress streaming big", () => {
    const encoder = zlib.createBrotliCompress();
    // prettier-ignore
    for (const chunk of window(inputString+inputString+inputString+inputString, 65)) {
      encoder._transform(chunk, undefined, (err, data) => {
        expect(err).toBeUndefined();
        expect(data).toEqual(Buffer(0));
      });
    }
    encoder._flush((err, data) => {
      expect(err).toBeUndefined();
      expect(data.length).toBeGreaterThan(0);
    });
  });

  it("fully works as a stream.Transform", async () => {
    const x_dir = tmpdirSync();
    const out_path_c = resolve(x_dir, "this.js.br");
    const out_path_d = resolve(x_dir, "this.js");

    {
      const { resolve, promise } = Promise.withResolvers();
      const readStream = fs.createReadStream(import.meta.filename);
      const writeStream = fs.createWriteStream(out_path_c);
      const brStream = zlib.createBrotliCompress();
      const the_stream = readStream.pipe(brStream).pipe(writeStream);
      the_stream.on("finish", resolve);
      await promise;
    }
    {
      const { resolve, promise } = Promise.withResolvers();
      const readStream = fs.createReadStream(out_path_c);
      const writeStream = fs.createWriteStream(out_path_d);
      const brStream = zlib.createBrotliDecompress();
      const the_stream = readStream.pipe(brStream).pipe(writeStream);
      the_stream.on("finish", resolve);
      await promise;
    }
    {
      const expected = await Bun.file(import.meta.filename).text();
      const actual = await Bun.file(out_path_d).text();
      expect(actual).toEqual(expected);
    }
  });

  it("streaming encode doesn't wait for entire input", async () => {
    const createPRNG = seed => {
      let state = seed ?? Math.floor(Math.random() * 0x7fffffff);
      return () => (state = (1103515245 * state + 12345) % 0x80000000) / 0x7fffffff;
    };
    const readStream = new stream.Readable();
    const brotliStream = zlib.createBrotliCompress();
    const rand = createPRNG(1);
    let all = [];

    brotliStream.on("data", chunk => all.push(chunk.length));
    brotliStream.on("end", () => expect(all).toEqual([11180, 13, 14, 13, 13, 13, 14]));

    for (let i = 0; i < 50; i++) {
      let buf = Buffer.alloc(1024 * 1024);
      for (let j = 0; j < buf.length; j++) buf[j] = (rand() * 256) | 0;
      readStream.push(buf);
    }
    readStream.push(null);
    readStream.pipe(brotliStream);
  }, 15_000);

  it("should accept params", async () => {
    const ZLIB = zlib.constants;
    const inputString2 =
      "ΩΩLorem ipsum dolor sit amet, consectetur adipiscing eli" +
      "t. Morbi faucibus, purus at gravida dictum, libero arcu " +
      "convallis lacus, in commodo libero metus eu nisi. Nullam" +
      " commodo, neque nec porta placerat, nisi est fermentum a" +
      "ugue, vitae gravida tellus sapien sit amet tellus. Aenea" +
      "n non diam orci. Proin quis elit turpis. Suspendisse non" +
      " diam ipsum. Suspendisse nec ullamcorper odio. Vestibulu" +
      "m arcu mi, sodales non suscipit id, ultrices ut massa. S" +
      "ed ac sem sit amet arcu malesuada fermentum. Nunc sed. ";
    const compressedString2 =
      "G/gBQBwHdky2aHV5KK9Snf05//1pPdmNw/7232fnIm1IB" +
      "K1AA8RsN8OB8Nb7Lpgk3UWWUlzQXZyHQeBBbXMTQXC1j7" +
      "wg3LJs9LqOGHRH2bj/a2iCTLLx8hBOyTqgoVuD1e+Qqdn" +
      "f1rkUNyrWq6LtOhWgxP3QUwdhKGdZm3rJWaDDBV7+pDk1" +
      "MIkrmjp4ma2xVi5MsgJScA3tP1I7mXeby6MELozrwoBQD" +
      "mVTnEAicZNj4lkGqntJe2qSnGyeMmcFgraK94vCg/4iLu" +
      "Tw5RhKhnVY++dZ6niUBmRqIutsjf5TzwF5iAg8a9UkjF5" +
      "2eZ0tB2vo6v8SqVfNMkBmmhxr0NT9LkYF69aEjlYzj7IE" +
      "KmEUQf1HBogRYhFIt4ymRNEgHAIzOyNEsQM=";
    const compressedString3 =
      "G/gBAICqqqrq/3RluBvo4R73BQIgAOIuJirhIAAqKhqy+" +
      "PHut0sMwMFYEIlJYoA7bQ5D/H/9v949xKAn2zB9eSC1QC" +
      "Z1gX2ncEl1gKYeTdb9gCytgQ+PW/FLzXp3XjgdnaDCI+i" +
      "pkzCVq+3C0lvCQcEN9v2ktTSxiDsv6Aa7mU/H0lvCYVKd" +
      "kMbW1IHPXosM7GY+/cKWvxZsYRyPIpxFLEF1YWsqJAu/E" +
      "ia72kD9aLnw1CLBI+ipk1CyVieSjspGqh0LVZUYBt5kC2" +
      "1s35hKBg/Wga9w3fhrTUdQQVAdR3Pgu/PInpopugl2ooZ" +
      "SH9vC6LXI2ONIwKf6wI9k6d2rDY4ocKYX0ictSSMmx+xk" +
      "PVrQeaFXhbIkumCUSQPfMkGMFHNzQg2mPy3JpklwIIEc+" +
      "OzNSJkD";

    {
      const compressed = await util.promisify(zlib.brotliCompress)(inputString2, {
        params: {
          [ZLIB.BROTLI_PARAM_MODE]: ZLIB.BROTLI_MODE_TEXT,
          [ZLIB.BROTLI_PARAM_QUALITY]: 11,
        },
      });
      expect(compressed.toString()).toEqual(Buffer.from(compressedString2, "base64").toString());
    }
    {
      const compressed = await util.promisify(zlib.brotliCompress)(inputString2, {
        params: {
          [ZLIB.BROTLI_PARAM_MODE]: ZLIB.BROTLI_MODE_TEXT,
          [ZLIB.BROTLI_PARAM_QUALITY]: 2,
        },
      });
      expect(compressed.toString()).toEqual(Buffer.from(compressedString3, "base64").toString());
    }
  });
});

it.each([
  "BrotliCompress",
  "BrotliDecompress",
  "Deflate",
  "Inflate",
  "DeflateRaw",
  "InflateRaw",
  "Gzip",
  "Gunzip",
  "Unzip",
])("%s should work with and without `new` keyword", constructor_name => {
  const C = zlib[constructor_name];
  expect(C()).toBeInstanceOf(C);
  expect(new C()).toBeInstanceOf(C);
});

describe.each(["Deflate", "DeflateRaw", "Gzip"])("%s", constructor_name => {
  describe.each(["chunkSize", "level", "windowBits", "memLevel", "strategy", "maxOutputLength"])(
    "should throw if options.%s is",
    option_name => {
      // [], // error: Test "-3.4416124249222144e-103" timed out after 5000ms
      it.each(["test", Symbol("bun"), 2n, {}, true])("%p", value => {
        expect(() => new zlib[constructor_name]({ [option_name]: value })).toThrow(TypeError);
      });
      it.each([Number.MIN_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER + 1, Infinity, -Infinity, -2])("%p", value => {
        expect(() => new zlib[constructor_name]({ [option_name]: value })).toThrow(RangeError);
      });
      it.each([undefined])("%p", value => {
        expect(() => new zlib[constructor_name]({ [option_name]: value })).not.toThrow();
      });
    },
  );
});

for (const [compress, decompressor] of [
  [zlib.deflateRawSync, zlib.createInflateRaw],
  [zlib.deflateSync, zlib.createInflate],
  [zlib.brotliCompressSync, zlib.createBrotliDecompress],
  // [zlib.gzipSync, zlib.createGunzip],
  // [zlib.gzipSync, zlib.createUnzip],
]) {
  const input = "0123456789".repeat(4);
  const compressed = compress(input);
  const trailingData = Buffer.from("not valid compressed data");

  const variants = [
    stream => {
      stream.end(compressed);
    },
    // stream => {
    //   stream.write(compressed);
    //   stream.write(trailingData);
    // },
    stream => {
      stream.write(compressed);
      stream.end(trailingData);
    },
    // stream => {
    //   stream.write(Buffer.concat([compressed, trailingData]));
    // },
    stream => {
      stream.end(Buffer.concat([compressed, trailingData]));
    },
  ];
  for (const i in variants) {
    it(`premature end handles bytesWritten properly: ${compress.name} + ${decompressor.name}: variant ${i}`, async () => {
      const variant = variants[i];
      const { promise, resolve, reject } = Promise.withResolvers();
      let output = "";
      const stream = decompressor();
      stream.setEncoding("utf8");
      stream.on("data", chunk => (output += chunk));
      stream.on("end", () => {
        try {
          expect(output).toBe(input);
          expect(stream.bytesWritten).toBe(compressed.length);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      variant(stream);
      await promise;
    });
  }
}

const inputString =
  "ΩΩLorem ipsum dolor sit amet, consectetur adipiscing eli" +
  "t. Morbi faucibus, purus at gravida dictum, libero arcu " +
  "convallis lacus, in commodo libero metus eu nisi. Nullam" +
  " commodo, neque nec porta placerat, nisi est fermentum a" +
  "ugue, vitae gravida tellus sapien sit amet tellus. Aenea" +
  "n non diam orci. Proin quis elit turpis. Suspendisse non" +
  " diam ipsum. Suspendisse nec ullamcorper odio. Vestibulu" +
  "m arcu mi, sodales non suscipit id, ultrices ut massa. S" +
  "ed ac sem sit amet arcu malesuada fermentum. Nunc sed. ";

const errMessage = /unexpected end of file/;

it.each([
  ["gzip", "gunzip", "gunzipSync"],
  ["gzip", "unzip", "unzipSync"],
  ["deflate", "inflate", "inflateSync"],
  ["deflateRaw", "inflateRaw", "inflateRawSync"],
])("%s %s should handle truncated input correctly", async (comp, decomp, decompSync) => {
  const comp_p = util.promisify(zlib[comp]);
  const decomp_p = util.promisify(zlib[decomp]);

  const compressed = await comp_p(inputString);

  const truncated = compressed.slice(0, compressed.length / 2);
  const toUTF8 = buffer => buffer.toString("utf-8");

  // sync sanity
  const decompressed = zlib[decompSync](compressed);
  expect(toUTF8(decompressed)).toEqual(inputString);

  // async sanity
  expect(toUTF8(await decomp_p(compressed))).toEqual(inputString);

  // Sync truncated input test
  expect(() => zlib[decompSync](truncated)).toThrow();

  // Async truncated input test
  expect(async () => await decomp_p(truncated)).toThrow();

  const syncFlushOpt = { finishFlush: zlib.constants.Z_SYNC_FLUSH };

  // Sync truncated input test, finishFlush = Z_SYNC_FLUSH
  {
    const result = toUTF8(zlib[decompSync](truncated, syncFlushOpt));
    const expected = inputString.slice(0, result.length);
    expect(result).toBe(expected);
  }

  // Async truncated input test, finishFlush = Z_SYNC_FLUSH
  {
    const result = toUTF8(await decomp_p(truncated, syncFlushOpt));
    const expected = inputString.slice(0, result.length);
    expect(result).toBe(expected);
  }
});
