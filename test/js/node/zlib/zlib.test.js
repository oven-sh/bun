import { deflateSync, gunzipSync, gzipSync, inflateSync } from "bun";
import * as internalForTesting from "bun:internal-for-testing";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir, tmpdirSync } from "harness";
import * as buffer from "node:buffer";
import { randomFillSync } from "node:crypto";
import * as fs from "node:fs";
import { resolve } from "node:path";
import * as stream from "node:stream";
import * as util from "node:util";
import * as zlib from "node:zlib";

describe("prototype and name and constructor", () => {
  for (let [name, Class] of [
    ["Gzip", zlib.Gzip],
    ["Gunzip", zlib.Gunzip],
    ["Deflate", zlib.Deflate],
    ["Inflate", zlib.Inflate],
    ["DeflateRaw", zlib.DeflateRaw],
  ]) {
    describe(`${name}`, () => {
      it(`${name}.prototype should be instanceof ${name}.__proto__`, () => {
        expect(Class.prototype).toBeInstanceOf(Class.__proto__);
      });
      it(`${name}.prototype.constructor should be ${name}`, () => {
        expect(Class.prototype.constructor).toBe(Class);
      });
      it(`${name}.name should be ${name}`, () => {
        expect(Class.name).toBe(name);
      });
      it(`${name}.prototype.__proto__.constructor.name should be Zlib`, () => {
        expect(Class.prototype.__proto__.constructor.name).toBe("Zlib");
      });
    });
  }

  for (let [name, Class] of [
    ["BrotliCompress", zlib.BrotliCompress],
    ["BrotliDecompress", zlib.BrotliDecompress],
  ]) {
    describe(`${name}`, () => {
      it(`${name}.prototype should be instanceof ${name}.__proto__`, () => {
        expect(Class.prototype).toBeInstanceOf(Class.__proto__);
      });
      it(`${name}.prototype.constructor should be ${name}`, () => {
        expect(Class.prototype.constructor).toBe(Class);
      });
      it(`${name}.name should be ${name}`, () => {
        expect(Class.name).toBe(name);
      });
      it(`${name}.prototype.__proto__.constructor.name should be Brotli`, () => {
        expect(Class.prototype.__proto__.constructor.name).toBe("Brotli");
      });
    });
  }

  for (let [name, Class] of [
    ["ZstdCompress", zlib.ZstdCompress],
    ["ZstdDecompress", zlib.ZstdDecompress],
  ]) {
    describe(`${name}`, () => {
      it(`${name}.prototype should be instanceof ${name}.__proto__`, () => {
        expect(Class.prototype).toBeInstanceOf(Class.__proto__);
      });
      it(`${name}.prototype.constructor should be ${name}`, () => {
        expect(Class.prototype.constructor).toBe(Class);
      });
      it(`${name}.name should be ${name}`, () => {
        expect(Class.name).toBe(name);
      });
      it(`${name}.prototype.__proto__.constructor.name should be Zstd`, () => {
        expect(Class.prototype.__proto__.constructor.name).toBe("Zstd");
      });
    });
  }
});

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

  it("flush() takes a numeric string or a BigInt, and any kind after end()", async () => {
    for (const kind of ["2", 2n]) {
      const gzip = zlib.createGzip();
      expect(Object.keys(gzip)).not.toContain("_flushBoundIdx");
      const chunks = [];
      gzip.on("data", chunk => chunks.push(chunk));
      gzip.write("hello");
      await new Promise(done => gzip.flush(kind, done));
      const flushed = zlib.gunzipSync(Buffer.concat(chunks), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      expect(flushed.toString()).toBe("hello");
      gzip.end();
      await new Promise(done => gzip.flush("none", done));
    }
  });

  describe("libdeflate level validation", () => {
    const data = Buffer.alloc(64, "a");
    // libdeflate_alloc_compressor returns NULL for level outside [0, 12]; that NULL must
    // surface as an invalid-argument error, not "Out of memory".
    for (const fn of [gzipSync, deflateSync]) {
      it(`${fn.name}: out-of-range level throws an argument error, not OOM`, () => {
        for (const level of [-2, -1, 13, 100]) {
          let err;
          try {
            fn(data, { library: "libdeflate", level });
          } catch (e) {
            err = e;
          }
          expect(err).toBeDefined();
          expect(err.message).not.toContain("memory");
          expect(err.message).toContain("Compression level must be between 0 and 12");
        }
      });

      it(`${fn.name}: in-range levels 0..12 succeed and round-trip`, () => {
        const decompress = fn === gzipSync ? gunzipSync : inflateSync;
        for (const level of [0, 1, 6, 9, 12]) {
          const out = fn(data, { library: "libdeflate", level });
          expect(out.length).toBeGreaterThan(0);
          expect(Buffer.from(decompress(out, { library: "libdeflate" }))).toEqual(data);
        }
      });
    }
  });

  describe("libdeflate", () => {
    const library = "libdeflate";
    const digest = bytes => `${bytes.length} ${Bun.SHA1.hash(bytes, "hex").slice(0, 16)}`;

    const stored = (bytes, final) => {
      const header = Buffer.from([final ? 1 : 0, 0, 0, 0, 0]);
      header.writeUInt16LE(bytes.length, 1);
      header.writeUInt16LE(~bytes.length & 0xffff, 3);
      return Buffer.concat([header, bytes]);
    };

    let inputs;
    beforeAll(() => {
      let state = 0x2545f491;
      const next = () => ((state ^= state << 13), (state ^= state >>> 17), (state ^= state << 5), state >>> 0);
      const fourBytesEach = (length, four) => Buffer.from(Uint32Array.from({ length: length / 4 }, four).buffer);
      const noise = length => fourBytesEach(length, next);
      const word = () =>
        next()
          .toString(36)
          .slice(0, 2 + (next() % 6));
      const phrases = Array.from({ length: 300 }, () => Array.from({ length: 1 + (next() % 8) }, word).join(" "));
      const words = length => {
        const text = [];
        for (let size = 0; size < length; size += text.at(-1).length + 1)
          text.push(next() % 4 ? phrases[next() % 300] : word());
        return Buffer.from(text.join(" ")).subarray(0, length);
      };
      const window = noise(32768);
      inputs = {
        // More than one block of the longest kind, and ten windows.
        words: words(330_000),
        // More than one stored block.
        noise: noise(70_000),
        runs: Buffer.concat(Array.from({ length: 300 }, () => Buffer.alloc(1 + (next() % 600), next() % 7))),
        // Blocks end where the statistics change.
        mixed: Buffer.concat([
          words(30_000),
          noise(12_000),
          Buffer.alloc(9_000),
          words(25_000),
          noise(4_000).map(byte => byte & 3),
        ]),
        // Repeats 32768 bytes back, which DEFLATE allows and libdeflate does not look for, then 32767, then 32769.
        far: Buffer.concat([window, window, window.subarray(1), Buffer.alloc(1), window]),
        few: noise(3_000).map(byte => 65 + (byte & 1)),
      };
      // So many matches of 4 bytes that blocks end because levels 1 to 9 can hold no more of them.
      const dictionary = Uint32Array.from({ length: 2000 }, next);
      inputs.shortMatches = fourBytesEach(260_000, () => dictionary[next() % 2000]);
      // So many matches at each position that blocks end because levels 10 to 12 can hold no more of them.
      inputs.coins = fourBytesEach(200_000, () => 0x41414141 + (next() & 0x01010101));
      // Matches are of no use here, so levels 10 to 12 write literals only. In libdeflate 1.16 that could exceed the bound.
      inputs.skewed = fourBytesEach(20_000, () => next() & next());
      // No match for more than 65535 bytes, which libdeflate 0.6 could not count. From its test_litrunlen_overflow.c.
      inputs.noMatches = Buffer.alloc(2 * 250 * 251);
      for (let half = 0, i = 0; half < 2; half++)
        for (let stride = 1; stride < 251; stride++)
          for (let multiple = 0; multiple < 251; multiple++) inputs.noMatches[i++] = (stride * multiple) % 251;
    });

    // What the C library wrote for each input at levels 0 to 12: the length and the start of the SHA-1.
    const writtenByC = {
      words: [
        "330030 d7f84ba13a54f264",
        "56001 279e40bd452f38b9",
        "52945 3279ad997ad1ea08",
        "52813 9aaf9038e77c5a63",
        "52793 12602851035bca5a",
        "52685 0a21221642224d4d",
        "52599 6d4252159200797b",
        "52595 a4f51fd89774bbac",
        "52535 d55a02a78148ff8d",
        "52535 d55a02a78148ff8d",
        "51744 84a84dc45f42eadd",
        "51659 9b29eae17ae31818",
        "51658 84efb6a1781e3b25",
      ],
      noise: Array(13).fill("70010 df587075ba18e4f0"),
      runs: [
        "92917 a07e5a15790a02b3",
        "940 4cbed6a7b703ce5f",
        "913 dcb52a7b32435b7c",
        "938 314644e77893dbd9",
        "987 73833771ceeaf648",
        "589 c47eb9dce2bc7abc",
        "592 9de508dc990de3f2",
        "610 b920162082f236f9",
        "729 8a43b8ea4fbaa668",
        "737 5bd5472cbda2adf9",
        "645 c4698c2139b65835",
        "645 05116e858ff44aa0",
        "646 542621c17a2d4645",
      ],
      mixed: [
        "80010 8f63a5061694c715",
        "29849 efa8f606ddf08e1d",
        "27695 d77f1dc490c0dc7d",
        "27674 15e8e227c94616e0",
        "27674 b2c1a0ca842d3328",
        "27654 93da18acc5424476",
        "27675 54e4d189fae7299b",
        "27674 f192dcd580ec6c62",
        "27640 dd0987a5322b7bff",
        "27640 dd0987a5322b7bff",
        "27315 c79ae225382e228b",
        "27266 eba09b7fea8fa9b4",
        "27255 f1371a191d876c05",
      ],
      far: [
        "131087 df1cfc18ae863631",
        "98774 807f84be16dd8ebf",
        "98751 b03c011b8d7f4d13",
        "98751 b03c011b8d7f4d13",
        "98751 b03c011b8d7f4d13",
        "98755 90c8aac0b27c989a",
        "98755 90c8aac0b27c989a",
        "98755 90c8aac0b27c989a",
        "98755 90c8aac0b27c989a",
        "98755 90c8aac0b27c989a",
        "98756 e5c672b5febbe25d",
        "98756 e5c672b5febbe25d",
        "98756 e5c672b5febbe25d",
      ],
      few: [
        "3005 fee3b57b1f138abb",
        "576 a72c4dd1af074143",
        "555 95e15e610ff00f74",
        "543 ee4249b9ef889ca7",
        "512 dbba362e7c08580d",
        "511 a81bbde0be47a016",
        "522 d61319e936ac24e1",
        "528 9bffac3b67b7eec8",
        "528 b97982fe60f1a345",
        "529 838ea6c49c23e01e",
        "506 a2f53d5e78a9568c",
        "485 909eeb66b020af9e",
        "483 86e9105ce8c087ae",
      ],
      shortMatches: [
        "260020 c025453e35174c60",
        "138614 e8af131b97d62047",
        "133071 f833a3261eee9d02",
        "133176 16abddfc5197fb2b",
        "133177 12b00d9c5196d696",
        "132973 3245e56877325607",
        "132973 3245e56877325607",
        "132973 3245e56877325607",
        "132978 d4093cc70e4a37ae",
        "132978 d4093cc70e4a37ae",
        "131441 76689d18e556e26b",
        "131438 19996b77c9ca60fd",
        "131435 d9781fa23d4153a4",
      ],
      coins: [
        "200020 34ac1cf7829aaa95",
        "36994 780c180280e82e14",
        "35014 acd6fe6943acd4e0",
        "33765 321294b1a669ce0d",
        "32536 83dabf0c27bc5762",
        "32461 44cd2afdb914c63e",
        "32265 64348175f7404cd0",
        "31601 b67e306b8cfdb275",
        "31082 982bb287e68b00d1",
        "30910 bb55b2f8b3d6ac0a",
        "29231 f3791a5f5a9477bc",
        "28591 fa53b93c06cf5b85",
        "28484 ee4045a8538f6798",
      ],
      skewed: [
        "20005 5e2aaec58f604b59",
        "16469 fb9bf5e044313fad",
        ...Array(3).fill("16706 3657cac564bd198c"),
        ...Array(5).fill("16808 06e8a1ba27ee603f"),
        ...Array(3).fill("16428 81e235ce25568523"),
      ],
      noMatches: ["125510 fe85f174af38f0d4", "125309 dedf5d158bed37db", ...Array(11).fill("125279 85be301be4068581")],
    };
    const writtenByCFor0To79Bytes = [
      "3560 c856dc0aca751fee",
      "3336 9670bcd7658c3a2c",
      "3324 a41f274d19e02250",
      "3300 e088ed3ab7e30f22",
      "3276 db171951cb473732",
      "3254 c88822b29e4d5b5f",
      "3234 1c3f04a0b1573d0e",
      "3214 c1fd2601df936153",
      "3194 a1a1909998c1b33b",
      "3182 8bdd54a1b4737b10",
      "3181 f460bea7e788365e",
      "3133 b3e18d69d79534b6",
      "3121 4c15cfd06cab6322",
    ];

    it.each(Object.keys(writtenByC))("compresses %s to the bytes the C library wrote", name => {
      const outputs = writtenByC[name].map((_, level) => deflateSync(inputs[name], { library, level }));
      expect(outputs.map(digest)).toEqual(writtenByC[name]);
      for (const output of outputs) {
        expect(Bun.SHA1.hash(inflateSync(output, { library }), "hex")).toBe(Bun.SHA1.hash(inputs[name], "hex"));
      }
    });

    it("compresses 0 to 79 bytes to the bytes the C library wrote", () => {
      const outputs = writtenByCFor0To79Bytes.map((_, level) =>
        Array.from({ length: 80 }, (_, length) => deflateSync(inputs.words.subarray(0, length), { library, level })),
      );
      expect(outputs.map(output => digest(Buffer.concat(output)))).toEqual(writtenByCFor0To79Bytes);
    });

    // Windows Explorer and old zlibs refuse a code with unused code space, which libdeflate wrote until 1.18.
    it("writes complete Huffman codes, whatever a block uses", () => {
      // How much of its code space each code of the first block uses, out of 1.
      const codeSpaceUsed = stream => {
        let position = 0;
        const bits = count => {
          let value = 0;
          for (let i = 0; i < count; i++, position++) value |= ((stream[position >> 3] >> (position & 7)) & 1) << i;
          return value;
        };
        const blockType = bits(3) >> 1;
        if (blockType !== 2) return { blockType };
        const literalCount = 257 + bits(5);
        const distanceCount = 1 + bits(5);
        const precodeLengths = new Array(19).fill(0);
        for (const symbol of [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15].slice(0, 4 + bits(4)))
          precodeLengths[symbol] = bits(3);
        // Canonical codewords go by length, then by symbol.
        const symbolOf = new Map();
        for (let length = 1, code = 0; length <= 7; length++, code <<= 1)
          precodeLengths.forEach((other, symbol) => other === length && symbolOf.set(`${length} ${code++}`, symbol));
        const lengths = [];
        while (lengths.length < literalCount + distanceCount) {
          let length = 0;
          let code = 0;
          do code = (code << 1) | bits(1);
          while (!symbolOf.has(`${++length} ${code}`));
          const symbol = symbolOf.get(`${length} ${code}`);
          if (symbol < 16) lengths.push(symbol);
          else if (symbol === 16) lengths.push(...new Array(3 + bits(2)).fill(lengths.at(-1)));
          else lengths.push(...new Array(symbol === 17 ? 3 + bits(3) : 11 + bits(7)).fill(0));
        }
        const used = lengths => lengths.reduce((sum, length) => sum + (length && 2 ** -length), 0);
        return {
          precode: used(precodeLengths),
          literals: used(lengths.slice(0, literalCount)),
          distances: used(lengths.slice(literalCount)),
        };
      };
      // Each run of three of its eight symbols comes once, so there is nothing to match.
      const noDistance = [0, 0, 0];
      for (const seen = new Set(["0 0 0"]); ;) {
        const next = [7, 6, 5, 4, 3, 2, 1, 0].find(symbol => !seen.has([...noDistance.slice(-2), symbol].join(" ")));
        if (next === undefined) break;
        seen.add([...noDistance.slice(-2), next].join(" "));
        noDistance.push(next);
      }
      for (const input of [Buffer.from(noDistance), Buffer.alloc(3000, "abcdefg"), Buffer.alloc(3000, "a")]) {
        for (let level = 1; level <= 12; level++) {
          expect(codeSpaceUsed(deflateSync(input, { library, level }))).toEqual({
            precode: 1,
            literals: 1,
            distances: 1,
          });
        }
      }
    });

    it("gzip is a header that tells the level, what deflate writes, the CRC-32 and the length", () => {
      const input = inputs.few;
      const trailer = Buffer.alloc(8);
      trailer.writeUInt32LE(Bun.hash.crc32(input), 0);
      trailer.writeUInt32LE(input.length, 4);
      for (let level = 0; level <= 12; level++) {
        const header = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, level < 2 ? 4 : level < 8 ? 0 : 2, 255]);
        expect(Buffer.from(gzipSync(input, { library, level }))).toEqual(
          Buffer.concat([header, deflateSync(input, { library, level }), trailer]),
        );
      }
    });

    // What the C library made of each stream: the text, or null for "bad data".
    describe.each([
      [
        "inflateSync",
        inflateSync,
        [
          ["no input", "", null],
          ["an empty static block", "0300", ""],
          ["an empty stored block", "010000ffff", ""],
          ["block type 3", "07", null],
          ["a stored block whose lengths disagree", "010100fefe41", null],
          ["a stored block cut short", "010300fcff4142", null],
          ["a stored block header cut short", "010300fc", null],
          ["no final block", "4a0400", null],
          ["three kinds of block", "000200fdff68695228c9482d4a05148007140000000080b0a5ff2743", "hi there!!"],
          ["bytes after the final block", "cbcf06000102030405060708090a0b0c", "ok"],
          ["a run by a match at distance 1", "4b1c0500", Buffer.alloc(259, "a").toString()],
          ["a match of 3 over itself at distance 2", "4b4c024200", "ababa"],
          ["a match of 258 spelled as 227 + 31", "4b1cf90000", Buffer.alloc(259, "a").toString()],
          ["a match from before the start", "4b044200", null],
          ["a match as the first item", "030200", null],
          ["a match into the block before", "4a4c4a4e494d030c420200", "abcdefabcdef"],
          ["length symbol 286", "4b1c0300", Buffer.alloc(259, "a").toString()],
          ["length symbol 287", "4b1c0700", Buffer.alloc(259, "a").toString()],
          ["distance symbol 30", "4b043e00", null],
          ["distance symbol 31", "4b047e00", null],
          ["a static block without its end", "4b4c4a06", null],
          ["a static block cut in a match", "4b4c4a1e00", null],
          ["zeros", "00000000000000000000000000000000", null],
          ["ones", "ffffffffffffffffffffffffffffffff", null],
          [
            "a dynamic block of 8 and 9 bits, no distances",
            "05e001481200000000545555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555558f8425e17f",
            "Hi!",
          ],
          [
            "the same with a match, though no distance has a code",
            "0de001481200000000545555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555d53f12fffd03",
            "HHHH",
          ],
          [
            "one distance code of 1 bit",
            "0de0014c1200000030a8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6ad525fefb07",
            "HHHH",
          ],
          [
            "the unused half of that code",
            "0de0014c1200000030a8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6ad525feff07",
            "HHHH",
          ],
          [
            "one distance code of 2 bits",
            "05e0014c120000c000a8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa7500000000",
            null,
          ],
          [
            "two distance codes of 2 bits",
            "05e1014c120000c000a8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaf50300000000",
            null,
          ],
          [
            "three distance codes of 1 bit",
            "05e2014c1200000030a8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaf51f00000000",
            null,
          ],
          [
            "too few literal codes",
            "05e001481200000000545555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555150f00000000",
            null,
          ],
          [
            "too many literal codes",
            "05e001481200000000545555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555550d00000000",
            null,
          ],
          ["only the end of block has a code, of 1 bit", "05e001050000000020fc7f1d", ""],
          ["no literal has a code", "05e081040000000000fc6f0300000000", null],
          ["no end of block code", "05e001050000000020d4ffd5000000000000000000", null],
          [
            "288 literal codes",
            "fde0014812000000005455555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555fdffffffffffffffffffffffffffffff23f800",
            "A",
          ],
          [
            "length symbol 287 of those",
            "fde0014812000000005455555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555fdffffffffffffffffffffffffffffff23f8ff01",
            null,
          ],
          [
            "32 distance codes",
            "0dff014c1230000000a8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6ad5ffffffffffffffffffffffbfc47ff00f",
            "HHHH",
          ],
          [
            "distance symbol 31 of those",
            "0dff014c1230000000a8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6ad5ffffffffffffffffffffffbfc4ffff0f",
            null,
          ],
          ["a repeat with nothing before it", "05e0032000000000000400000000", null],
          [
            "a repeat past the last length",
            "05e001491000000000a8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa350000000000",
            null,
          ],
          [
            "a repeat from the literals into the distances",
            "05e305410000008000a8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5e230804",
            "A",
          ],
          [
            "a repeat of 6 lengths of 8 bits",
            "05e005481000000000f8ffffffffffffffffffffffffffffffffffffffffaf85d67f",
            "Z",
          ],
          ["too many length codes", "05e0010400000040100000000000", null],
          ["too few length codes", "05e0010800000080200000000000", null],
          [
            "no length codes",
            "05e001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            null,
          ],
          [
            "a dynamic header cut short",
            "05e0014812000000005455555555555555555555555555555555555555555555555501",
            null,
          ],
          ["libdeflate's test of no distance code", "05c0810c0000008030b627cbd9c4", "ABAA"],
          ["libdeflate's test of a literal code of one symbol", "05c08108000000002075f503", ""],
          ["libdeflate's test of a distance code of one symbol", "0dc08100000000802075f43e0b", "\xff\xff\xff\xff"],
          [
            "libdeflate's test of a distance code of one symbol that is not the first",
            "0dc1010900000080a0ebcfab1017",
            "\xfe\xff\xfe\xff\xfe",
          ],
          ["libdeflate's test of too many code lengths, accepted until 1.15", "05c081000000000090f574d603", null],
          // Until 1.9 the zeros that stand in for missing input went on decoding to literals until the output was full.
          ["libdeflate's test of a stream cut off where zeros are literals", "04c081000000000010ebe900", null],
          [
            "codes of 1 to 15 bits",
            "05e081b46ddbb66ddbb2c6944b6d7dccb5cf7ddf3f841042f841bbf7fdfefefdf7bffffb7fffdfffeffff7fffdbffffbdf7ffffe7edfbbe5ff0f",
            "abcdefghijklmnoonmlkjihgfedcba",
          ],
        ],
      ],
      [
        "gunzipSync",
        gunzipSync,
        [
          ["no input", "", null],
          ["a plain member", "1f8b08000000000000ffcbc80400ac2a93d802000000", "hi"],
          ["every optional field", "1f8b081f0000000000ff03000102036e616d65006300deadcbc80400ac2a93d802000000", "hi"],
          ["FTEXT, a time, every XFL bit and another OS", "1f8b0801efbeaddeff03cbc80400ac2a93d802000000", "hi"],
          ["an empty extra field, name and comment", "1f8b081c0000000000ff00000000cbc80400ac2a93d802000000", "hi"],
          ["reserved flag 0x20", "1f8b08200000000000ffcbc80400ac2a93d802000000", null],
          ["reserved flag 0x80", "1f8b08800000000000ffcbc80400ac2a93d802000000", null],
          ["the wrong first byte", "1e8b08000000000000ffcbc80400ac2a93d802000000", null],
          ["the wrong second byte", "1f8c08000000000000ffcbc80400ac2a93d802000000", null],
          ["method 7", "1f8b07000000000000ffcbc80400ac2a93d802000000", null],
          ["an extra field longer than the input", "1f8b08040000000000ffffffcbc80400ac2a93d802000000", null],
          ["an extra field that leaves 7 bytes", "1f8b08040000000000ff0800cbc80400ac2a93d802000000", null],
          ["a name without an end", "1f8b08080000000000ff010101010101010101010101", null],
          ["a comment that ends in the trailer", "1f8b08100000000000ff010101010101010101010001", null],
          ["the wrong checksum", "1f8b08000000000000ffcbc80400998ff03102000000", null],
          ["the wrong length", "1f8b08000000000000ffcbc80400ac2a93d803000000", null],
          ["half a trailer", "1f8b08000000000000ffcbc80400ac2a93d8", null],
          ["17 bytes", "1f8b08000000000000ff0300000000000000", null],
          ["the shortest member", "1f8b08000000000000ff03000000000000000000", ""],
          ["a stream that runs into the trailer", "1f8b08000000000000ffcbc804ac2a93d802000000", null],
          [
            "two members",
            "1f8b08000000000000ffcbc80400ac2a93d8020000001f8b08000000000000ffcbc80400ac2a93d802000000",
            "hi",
          ],
          ["bytes after the member", "1f8b08000000000000ffcbc80400ac2a93d80200000000ff00", "hi"],
        ],
      ],
    ])("%s", (_, decompress, streams) => {
      it.each(streams)("%s", (_, hex, text) => {
        const run = () => Buffer.from(decompress(Buffer.from(hex, "hex"), { library })).toString("latin1");
        if (text === null) expect(run).toThrow(new Error("libdeflate returned an error: bad data"));
        else expect(run()).toBe(text);
      });
    });

    // libdeflate_test.bind.ts is only in a build with assertions: a debug build, CI's ASAN lane.
    const internals = internalForTesting.libdeflate;

    const sizeAndChecksum = bytes => ({ written: bytes.length, crc32: Bun.hash.crc32(bytes) });

    // The end of an output that has to grow is decoded with more care. One with room to spare has no such end.
    const inflateBothWays = stream => {
      const grown = sizeAndChecksum(inflateSync(stream, { library }));
      if (!internals) return { grown };
      const { read, ...roomy } = internals.decompressToSlice(stream, { room: 200_000 });
      return { grown, roomy };
    };
    const bothWays = result => (internals ? { grown: result, roomy: result } : { grown: result });

    describe("streams whose text is too long to spell out", () => {
      // 10000 each of "a", "b" and "c", then "d".
      const thirtyThousand =
        "4b1c05a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a8601481a05a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a8601481e05a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a860148";
      // 8192 each of "a" to "d", then the start of a block whose literals take 11 bits and whose lengths take 15 and 5 more.
      const mostBits =
        "4a1c05a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1900749a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c12818f22079148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805431ea48c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805a360c803407fffb624499224cbb200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d00000080c4a2e69100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005000000000070ce39e79c73ce39e79c0300482c6a";
      // The length and the CRC-32 of what the C library made of each.
      it.each([
        [
          "the largest tables there can be, of 2342 and 402 entries",
          "fdffdb922449922ccbaebdd6da6badbdd65a6bedb5d65e6bedb5d65a6bafb5f65a6bafb5d65a7badb5d75a67adbdd6da6badbdd6a2b5f65a6bafb5f65a4bd7da6badbdd6da6bad596bafb5f65a6bafb5d65a7badb5d75a7badb5d6da6badbdd6da6badb5d65e6bedb5d6596bafb5f65a6bafb578adbdd6da6badbdd69ab5f65a6bafb5f65a6badb5d75a7badb5d75a6badbdd6da6badbdd65a6bedb5d65e6bedb5d65a6bafb5f65a0bd7da6badbdd6da6b2d596bafb5f65a6bafb566617736f56473af6ae9ddad7dbaad4f7736",
          0,
          0,
        ],
        ["distance symbol 30 is 24577", thirtyThousand + "013e000000", 30004, 0x45738059],
        ["distance symbol 31 is 24577", thirtyThousand + "017e000000", 30004, 0x45738059],
        [
          "items of the most bits, with distances of 8 bits and 13 more",
          mostBits +
            "0e0000000000000000000011fffbdfff3ffc9db1fffdefffefff17d2fffef7ffcf7f80e27ffffbff97ffbaf2bffffdffd19fe5f9dffffeffe1df7ffdef7fff7ff0a728fef7bfff3ffadf51fffbdfff7ffcc5abfffdefffeffe11cafffef7ff377f9ce47ffffbffb77f56f31f",
          35630,
          0xe8dfd40e,
        ],
        [
          "items of the most bits, with distances of 15 bits and 13 more",
          mostBits +
            "1e593d6b030000000000009cf3bffffdffddff4fc8ffef7ffffff7ff27b3fffbdfff3ffdff66e5fffef7ff37ffffc1f2bffffdffffff8f0dffef7ffffffaffbfcbfffbdfff3ffcff5ce3fffef7ff9fffff0cf9bffffdffe5ff8f7afeef7fff7ff9ffafb6fffbdfff3ffcff3ac6fffef7ff8fff7f4bf51f",
          35686,
          0x4e60ee20,
        ],
        [
          "items of the most bits, with distances of 9 bits and 13 more",
          mostBits +
            "1e0000000000000000000099fffbdfffbffd4b4cfffbdfff3ffc7f4efffbdfffdffe3b78fffbdfff1fffb790fffbdfff5fff935bfffbdfff9ffdff43fffbdfff9ffe1bfefffbdfff9fff579ffffbdfffdffcabcffffbdfff1ffd6f79fffbdfff5ffe334efffbdfff7ffe8f3eff01",
          35713,
          0xe8f2bd59,
        ],
        [
          "items of the most bits, in a block that starts with 1 bit at hand",
          "4a1c05a360148c8251300a46c1281805a360148c8251300a46c1281805a36014d01c248d8251300a46c1281805a360148c8251300a46c1281805a360148c8251300a680e9247c1281805a360148c8251300a46c1281805a360148c8251300a46c1281805340729a360148c8251300a46c1281805a360148c8251300a46c1281805a360148c029a0300000000fffffdfffd9324499224c9fe413fff01f01ffcf453c34f00482c6a1ef933fc15ffea3ff00714fc0cf0bebf3f00008945cd23ab670f7e80f7fe80fffdefff3fffff8cfef7bfff7ff8ff3ffd0f",
          20478,
          0x4d3005d9,
        ],
        [
          "literals of 15 bits, one after the other",
          "e5e1fd9324499224c9fe8beffbfd8cc4a2e691f5ffff01fd4fbcef870800000000f07ff83ffe9ffecfff97ffebffedfffe7ff83ffe9ffecfff030000000000000000000000000000000000000000000000000000000000000000",
          52,
          0x64150bbe,
        ],
      ])("%s", (_, hex, length, crc32) => {
        // How near the end of the input is decides which loop decodes the last items.
        for (let after = 0; after <= 40; after++) {
          expect(inflateBothWays(Buffer.concat([Buffer.from(hex, "hex"), Buffer.alloc(after, 0xa5)]))).toEqual(
            bothWays({ written: length, crc32 }),
          );
        }
      });
    });

    it("copies matches of all kinds of lengths from every short distance, and some long ones", () => {
      const lengthBases = [
        3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227,
        258,
      ];
      const distanceBases = [
        1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
      ];
      const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
      // A match is copied 40 bytes at a time.
      const lengths = [...range(3, 90), ...[120, 160, 200, 240, 256].flatMap(length => range(length - 2, length + 2))];
      const stream = new Uint8Array(8192);
      const text = new Uint8Array(32768);
      for (const distance of [...range(1, 42), 47, 48, 49, 63, 64, 65, 300, 4000]) {
        // One block of the static codes, and what it stands for.
        let streamLength = 0;
        let textLength = 0;
        let bits = 0;
        let count = 0;
        const put = (value, length) => {
          bits |= value << count;
          for (count += length; count >= 8; count -= 8, bits >>>= 8) stream[streamLength++] = bits & 255;
        };
        const putCode = (code, length) => {
          while (length-- > 0) put((code >> length) & 1, 1);
        };
        const putLiteral = byte => {
          if (byte < 144) putCode(0x30 + byte, 8);
          else putCode(0x190 + byte - 144, 9);
          text[textLength++] = byte;
        };
        put(0b011, 3);
        for (let i = 0; i < distance; i++) putLiteral((i * 7 + distance) & 255);
        const distanceSymbol = distanceBases.findLastIndex(base => base <= distance);
        for (const length of lengths) {
          const lengthSymbol = lengthBases.findLastIndex(base => base <= length);
          if (lengthSymbol < 23) putCode(lengthSymbol + 1, 7);
          else putCode(0xc0 + lengthSymbol - 23, 8);
          put(
            length - lengthBases[lengthSymbol],
            lengthSymbol < 8 || lengthSymbol === 28 ? 0 : (lengthSymbol >> 2) - 1,
          );
          putCode(distanceSymbol, 5);
          put(distance - distanceBases[distanceSymbol], distanceSymbol < 4 ? 0 : (distanceSymbol >> 1) - 1);
          for (const end = textLength + length; textLength < end; textLength++)
            text[textLength] = text[textLength - distance];
          // What the next match repeats is not what this one did.
          putLiteral((length * 5) & 255);
        }
        putCode(0, 7);
        put(0, 7);
        // With bytes after its end, the stream is not near the end of the input, where another loop decodes.
        expect({ distance, ...inflateBothWays(stream.subarray(0, streamLength + 64).fill(0, streamLength)) }).toEqual({
          distance,
          ...bothWays(sizeAndChecksum(text.subarray(0, textLength))),
        });
      }
    });

    it("a match reaches 32768 bytes back and no further", () => {
      const matchOf3At32768 = Buffer.from("03deff0f00", "hex");
      const before = inputs.noise.subarray(0, 32768);
      expect(Buffer.from(inflateSync(Buffer.concat([stored(before), matchOf3At32768]), { library }))).toEqual(
        Buffer.concat([before, before.subarray(0, 3)]),
      );
      expect(() => inflateSync(Buffer.concat([stored(before.subarray(1)), matchOf3At32768]), { library })).toThrow(
        new Error("libdeflate returned an error: bad data"),
      );
    });

    // Capacities, growth, reuse and what an error leaves, which Bun.gzipSync and the like do not show.
    describe.skipIf(!internals)("Compressor and Decompressor", () => {
      const levels = Array.from({ length: 13 }, (_, level) => level);
      const nothing = error => ({ error, written: 0, crc32: 0 });
      // Each ends its `length` bytes of output in another way: a stored block, a long match, literals and short matches.
      const streamsOf = length => {
        const words = inputs.words.subarray(0, length);
        const run = Buffer.alloc(length, "r");
        const blocks = [];
        for (let i = 0; i < length; i += 1000) blocks.push(stored(words.subarray(i, i + 1000)));
        return [
          [Buffer.concat([...blocks, stored(Buffer.alloc(0), true)]), words],
          [deflateSync(run, { library, level: 6 }), run],
          [deflateSync(words, { library, level: 1 }), words],
          [deflateSync(words, { library, level: 9 }), words],
        ];
      };
      // Past its end a stream reads as up to 64 zero bits, and each can be a match of 258.
      const roomForAnything = 64 * 258;
      const withoutTouched = ({ touchedPastEnd, ...outcome }) => outcome;
      const compressToVec = (...args) => withoutTouched(internals.compressToVec(...args));
      const decompressToVec = (...args) => withoutTouched(internals.decompressToVec(...args));

      it("the bound is 5 bytes for each 5000, and the wrapper", () => {
        for (const [length, bound] of [
          [0, 5],
          [1, 6],
          [5000, 5005],
          [5001, 5011],
          [10_000, 10_010],
          [2 ** 20, 2 ** 20 + 5 * 210],
        ]) {
          expect(["deflate", "zlib", "gzip"].map(encoding => internals.maxBytesNeeded(length, encoding))).toEqual([
            bound,
            bound + 6,
            bound + 18,
          ]);
        }
      });

      it("only levels 0 to 12 exist", () => {
        for (const level of [-(2 ** 31), -1, 13, 2 ** 31 - 1]) {
          expect(internals.compressToSlice(inputs.few, { level, room: 4000 })).toEqual(nothing("no such level"));
        }
      });

      it.each(["deflate", "zlib", "gzip"])("%s takes the exact size and not a byte less", encoding => {
        for (const input of [inputs.words.subarray(0, 1200), inputs.noise.subarray(0, 100), Buffer.alloc(0)]) {
          for (const level of levels) {
            const room = internals.maxBytesNeeded(input.length, encoding);
            const whole = internals.compressToSlice(input, { level, encoding, room });
            expect(whole.error).toBeUndefined();
            const size = whole.written;
            for (const room of [size, size + 1, size + 9]) {
              expect(internals.compressToSlice(input, { level, encoding, room })).toEqual(whole);
            }
            for (const room of [0, 1, size >> 1, size - 9, size - 2, size - 1]) {
              if (room < 0) continue;
              expect(internals.compressToSlice(input, { level, encoding, room })).toEqual(
                nothing("insufficient space"),
              );
            }
          }
        }
      });

      it("a compressor appends to a Vec, and leaves one alone that has room for the bound", () => {
        const input = inputs.mixed.subarray(25_000, 35_000);
        const spare = internals.maxBytesNeeded(input.length, "deflate");
        for (const level of levels) {
          const appended = { ...sizeAndChecksum(deflateSync(input, { library, level })), keptWhatItHeld: true };
          expect(compressToVec(input, { level, held: 6, spare })).toEqual({
            ...appended,
            moved: false,
            capacity: 6 + spare,
          });
          expect(compressToVec(input, { level, held: 6, spare: 0 })).toMatchObject({
            ...appended,
            capacity: 6 + spare,
          });
        }
      });

      it("a compressor writes no more than a word past its output in a Vec", () => {
        const input = inputs.words.subarray(0, 100_000);
        const spare = internals.maxBytesNeeded(input.length, "deflate");
        for (const level of levels) {
          expect(internals.compressToVec(input, { level, spare }).touchedPastEnd).toBeLessThanOrEqual(8);
        }
      });

      it("a compressor keeps nothing between inputs", () => {
        const all = [
          inputs.words.subarray(0, 40_000),
          inputs.runs.subarray(0, 2000),
          inputs.noise.subarray(0, 300),
          inputs.few,
        ];
        for (const level of levels) {
          for (const input of all) {
            const alone = sizeAndChecksum(deflateSync(input, { library, level }));
            for (const first of all) {
              expect(internals.compressToSlice(input, { level, room: 50_000 }, first)).toEqual(alone);
            }
          }
        }
      });

      it("a decompressor takes the exact size and not a byte less", () => {
        for (const length of [0, 1, 2, 3, 40, 299, 300, 301, 700]) {
          for (const [stream, plain] of streamsOf(length)) {
            for (let room = 0; room < length; room++) {
              if (room > 3 && room < length - 310) continue;
              expect(internals.decompressToSlice(stream, { room })).toEqual(nothing("insufficient space"));
            }
            for (const room of [length, length + 1, length + 299, length + 300, length + 400]) {
              expect(internals.decompressToSlice(stream, { room })).toEqual({
                read: stream.length,
                ...sizeAndChecksum(plain),
              });
            }
          }
        }
      });

      it("reading stops where the stream ends", () => {
        for (const extra of [1, 7, 8, 9, 40]) {
          for (const [stream, plain] of streamsOf(500)) {
            const more = Buffer.concat([stream, Buffer.alloc(extra, 0xff)]);
            expect(internals.decompressToSlice(more, { room: 500 })).toEqual({
              read: stream.length,
              ...sizeAndChecksum(plain),
            });
          }
        }
      });

      it("reading stops where the first gzip member ends", () => {
        const plain = inputs.words.subarray(0, 5000);
        const member = Buffer.from(gzipSync(plain, { library }));
        const withFields = Buffer.concat([
          Buffer.from("1f8b081f0000000000ff03000102036e616d65006300dead", "hex"),
          member.subarray(10),
        ]);
        for (const first of [member, withFields]) {
          for (const rest of [Buffer.alloc(0), Buffer.alloc(1), Buffer.alloc(30, 0xff), member]) {
            const stream = Buffer.concat([first, rest]);
            const done = { read: first.length, ...sizeAndChecksum(plain) };
            expect(internals.decompressToSlice(stream, { decoding: "gzip", room: 5000 })).toEqual(done);
            expect(decompressToVec(stream, { decoding: "gzip", held: 6, spare: 5000 })).toEqual({
              ...done,
              keptWhatItHeld: true,
              moved: false,
              capacity: 5006,
            });
            expect(decompressToVec(stream, { decoding: "gzip", spare: 0, maxLength: 5000 })).toMatchObject(done);
          }
        }
      });

      it("every stream that is cut off is bad data", () => {
        for (const [stream, plain] of streamsOf(260)) {
          for (let length = 0; length < stream.length; length++) {
            expect(
              internals.decompressToSlice(stream.subarray(0, length), { room: plain.length + roomForAnything }),
            ).toEqual(nothing("bad data"));
          }
        }
      });

      it("a decompressor keeps nothing between streams", () => {
        const staticCodes = Buffer.from("4b4c024200", "hex");
        const dynamicCodes = deflateSync(inputs.words.subarray(0, 600), { library, level: 9 });
        const all = [
          staticCodes,
          dynamicCodes,
          dynamicCodes.subarray(0, 12),
          dynamicCodes.subarray(0, 60),
          Buffer.alloc(0),
        ];
        const room = 600 + roomForAnything;
        expect(internals.decompressToSlice(staticCodes, { room })).toEqual({
          read: 5,
          ...sizeAndChecksum(Buffer.from("ababa")),
        });
        for (const stream of all) {
          const alone = internals.decompressToSlice(stream, { room });
          for (const first of all) expect(internals.decompressToSlice(stream, { room }, first)).toEqual(alone);
        }
      });

      it("a decompressor appends within the spare capacity of a Vec", () => {
        for (const length of [0, 1, 300, 511, 512, 513, 4095, 4096, 4097, 9000]) {
          for (const [stream, plain] of streamsOf(length)) {
            const untouched = spare => ({ keptWhatItHeld: true, moved: false, capacity: 6 + spare });
            for (const spare of [length, length + 1, length + 300, length + 5000]) {
              expect(decompressToVec(stream, { held: 6, spare })).toEqual({
                read: stream.length,
                ...sizeAndChecksum(plain),
                ...untouched(spare),
              });
            }
            if (length === 0) continue;
            expect(decompressToVec(stream, { held: 6, spare: length - 1 })).toEqual({
              ...nothing("insufficient space"),
              ...untouched(length - 1),
            });
            expect(decompressToVec(stream.subarray(0, -1), { held: 6, spare: length + roomForAnything })).toEqual({
              ...nothing("bad data"),
              ...untouched(length + roomForAnything),
            });
          }
        }
      });

      it("a decompressor writes no more than as much again past its output in a Vec", () => {
        for (const length of [0, 1, 300, 5000, 100_000]) {
          for (const [stream] of streamsOf(length)) {
            const { written, touchedPastEnd } = internals.decompressToVec(stream, { spare: 2 ** 20 });
            expect(written).toBe(length);
            // A step is at least 512 bytes, and comes when fewer than 300 are left.
            expect(touchedPastEnd).toBeLessThanOrEqual(Math.max(512, length + 600));
          }
        }
      });

      it("a decompressor makes a Vec grow as far as allowed, to twice what it needs at most, or not at all", () => {
        for (const length of [0, 1, 300, 511, 512, 513, 4095, 4096, 4097, 12_500, 300_000]) {
          for (const [stream, plain] of streamsOf(length)) {
            const done = { read: stream.length, ...sizeAndChecksum(plain), keptWhatItHeld: true };
            for (const maxLength of [length, length + 1, length + 300, Number.MAX_SAFE_INTEGER]) {
              const { moved, capacity, ...grown } = decompressToVec(stream, { held: 6, spare: 0, maxLength });
              expect(grown).toEqual(done);
              expect(capacity).toBeLessThanOrEqual(6 + Math.min(maxLength, Math.max(512, 2 * length + 6)));
              if (length === 0) continue;
              expect(decompressToVec(stream, { spare: length, maxLength })).toEqual({
                ...done,
                moved: false,
                capacity: length,
              });
            }
            for (const maxLength of [0, length >> 1, length - 300, length - 1]) {
              if (maxLength < 0 || maxLength === length) continue;
              expect(decompressToVec(stream, { held: 6, spare: 0, maxLength })).toMatchObject({
                ...nothing("insufficient space"),
                keptWhatItHeld: true,
              });
            }
            if (length === 0) continue;
            expect(
              decompressToVec(stream.subarray(0, -1), {
                held: 6,
                spare: 0,
                maxLength: Number.MAX_SAFE_INTEGER,
              }),
            ).toMatchObject({ ...nothing("bad data"), keptWhatItHeld: true });
          }
        }
      });
    });
  });

  // A block is sized in one pass over the input and written in a second. Whatever the second pass finds, the output
  // stays within what was reserved: the input and 5 bytes, plus 18 for gzip.
  it.concurrent.each(["gzip", "deflate"])(
    "libdeflate %s stays within its bound while another thread writes to the shared input",
    async kind => {
      const fixture = `
        import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

        const size = 4096;
        if (isMainThread) {
          const input = new SharedArrayBuffer(size);
          const worker = new Worker(new URL(import.meta.url), { workerData: input });
          const ready = Promise.withResolvers();
          worker.on("message", ready.resolve);
          await ready.promise;
          worker.unref();

          const raw = process.argv[2] === "deflate";
          const reserved = size + (raw ? 5 : 23);
          const compress = raw ? Bun.deflateSync : Bun.gzipSync;
          const decompress = raw ? Bun.inflateSync : Bun.gunzipSync;
          const view = new Uint8Array(input);
          for (let i = 0; i < 500; i++) {
            const out = compress(view, { library: "libdeflate", level: 1 + (i % 12) });
            if (out.length > reserved) throw new Error("wrote " + out.length + " bytes into " + reserved);
            const back = decompress(out, { library: "libdeflate" });
            if (back.length !== size) throw new Error("round trip returned " + back.length + " bytes");
          }
          console.log("ok");
          process.exit(0);
        } else {
          // Alternate between bytes that encode in a few bits and bytes that need more.
          const view = new Uint8Array(workerData);
          let seed = 88172645;
          const next = () => ((seed ^= seed << 13), (seed ^= seed >>> 17), (seed ^= seed << 5), seed >>> 0);
          const cheap = new Uint8Array(size);
          const costly = new Uint8Array(size);
          for (let i = 0; i < size; i++) {
            cheap[i] = next() & 127;
            costly[i] = 0xf0 + (next() & 15);
          }
          for (let i = 0; i < 16; i++) cheap[next() % size] = 0xf0 + i;
          parentPort.postMessage("ready");
          for (;;) {
            view.set(cheap);
            for (let i = next() % 50000; i > 0; i--);
            view.set(costly);
            for (let i = next() % 5000; i > 0; i--);
          }
        }
      `;
      using dir = tempDir("libdeflate-shared", { "fixture.mjs": fixture });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.mjs", kind],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr }).toEqual({ stdout: "ok\n", stderr: "" });
      expect(exitCode).toBe(0);
    },
  );

  describe("memLevel and strategy", () => {
    const data = Buffer.from(Array.from({ length: 4000 }, (_, i) => Math.imul(i, 2654435761).toString(36)).join(" "));
    for (const [compress, decompress, nodeCompress] of [
      [gzipSync, gunzipSync, zlib.gzipSync],
      [deflateSync, inflateSync, zlib.deflateRawSync],
    ]) {
      it.each([
        { strategy: zlib.constants.Z_FILTERED, level: 9 },
        { strategy: zlib.constants.Z_HUFFMAN_ONLY },
        { strategy: zlib.constants.Z_RLE },
        { strategy: zlib.constants.Z_FIXED },
        { memLevel: 1 },
        { memLevel: 9 },
        { memLevel: 1, strategy: zlib.constants.Z_RLE, level: 9 },
      ])(`${compress.name}: %j gives the bytes node:zlib gives, which are not the default's`, options => {
        const compressed = Buffer.from(compress(data, options));
        expect(compressed).toEqual(nodeCompress(data, options));
        expect(compressed).not.toEqual(Buffer.from(compress(data, { level: options.level })));
        expect(Buffer.from(decompress(compressed))).toEqual(data);
      });

      for (const [options, code] of [
        [{ memLevel: 0 }, "ERR_OUT_OF_RANGE"],
        [{ memLevel: 10 }, "ERR_OUT_OF_RANGE"],
        [{ memLevel: 1.5 }, "ERR_OUT_OF_RANGE"],
        [{ memLevel: "9" }, "ERR_INVALID_ARG_TYPE"],
        [{ memLevel: null }, "ERR_INVALID_ARG_TYPE"],
        [{ strategy: -1 }, "ERR_OUT_OF_RANGE"],
        [{ strategy: 5 }, "ERR_OUT_OF_RANGE"],
        [{ strategy: NaN }, "ERR_OUT_OF_RANGE"],
        [{ strategy: "Z_RLE" }, "ERR_INVALID_ARG_TYPE"],
      ]) {
        it(`${compress.name}: ${util.inspect(options)} is refused`, () => {
          expect(() => compress(data, options)).toThrow(expect.objectContaining({ code }));
        });
      }

      it(`${compress.name}: the defaults are memLevel 8 and Z_DEFAULT_STRATEGY`, () => {
        expect(compress(data, { memLevel: 8, strategy: zlib.constants.Z_DEFAULT_STRATEGY })).toEqual(compress(data));
      });

      it(`${compress.name}: libdeflate has neither`, () => {
        const library = "libdeflate";
        expect(compress(data, { library, memLevel: 1, strategy: 2 })).toEqual(compress(data, { library }));
      });

      // A low memLevel makes many short blocks.
      it(`${compress.name}: what does not compress fits`, () => {
        let state = 1;
        const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 16;
        for (const length of [16, 127 * 32 + 1, 65537]) {
          const noise = Buffer.from(Array.from({ length }, () => next() & 255));
          for (const options of [
            { memLevel: 1 },
            { memLevel: 1, level: 0 },
            { memLevel: 1, level: 1 },
            { memLevel: 1, strategy: 4 },
          ]) {
            const compressed = Buffer.from(compress(noise, options));
            expect(compressed.length).toBeGreaterThan(length);
            // Stored blocks are as long as the room for output allows, so node:zlib gets as much of it.
            expect(compressed).toEqual(nodeCompress(noise, { ...options, chunkSize: 2 * length + 64 }));
            expect(Buffer.from(decompress(compressed))).toEqual(noise);
          }
        }
      });
    }

    // Z_FIXED has no tree of its own, and a block of memLevel 9 that the window slid past is not stored:
    // 9 bits for each byte from 144 up and 10 for each block, where deflateBound() allows 9 bits and 3 bytes in all.
    // The first block is stored, which spares 4092 bytes, and each other uses up less than one: 5120 are the fewest.
    it(
      "an output longer than deflateBound() is whole",
      () => {
        const period = Buffer.alloc(37 * 37 * 38 * 3);
        for (let i = 0; i < period.length; i += 3) {
          const triple = i / 3;
          period[i] = 144 + Math.floor(triple / (37 * 38));
          period[i + 1] = 181 + (Math.floor(triple / 38) % 37);
          period[i + 2] = 218 + (triple % 38);
        }
        const input = Buffer.alloc(5130 * 32768, period);
        // One match in three blocks of 32767 symbols keeps each block starting just before a multiple of the window.
        for (let i = 5 * 32767 + 16000; i + 4 < input.length; i += 3 * 32768) input.copyWithin(i, i - 30000, i - 29996);

        const compressed = deflateSync(input, { memLevel: 9, strategy: zlib.constants.Z_FIXED, level: 2 });
        expect(compressed.length).toBeGreaterThan(input.length + input.length / 8 + 3);
        expect(Buffer.compare(inflateSync(compressed), input)).toBe(0);
      },
      isDebug ? 60_000 : undefined,
    );
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

describe("one-shot results", () => {
  const input = Buffer.alloc(1024, "a");
  const pairs = [
    ["gzip", "gunzip"],
    ["deflate", "inflate"],
    ["deflateRaw", "inflateRaw"],
    ["gzip", "unzip"],
    ["brotliCompress", "brotliDecompress"],
    ["zstdCompress", "zstdDecompress"],
  ];
  const backingStores = (compressed, decompressed) => ({
    compressed: compressed.buffer.byteLength,
    decompressed: decompressed.buffer.byteLength,
  });

  it.each(pairs)("%sSync and %sSync do not keep the 16 KB output chunk alive", (compress, decompress) => {
    const compressed = zlib[`${compress}Sync`](input);
    const decompressed = zlib[`${decompress}Sync`](compressed);
    expect(decompressed).toEqual(input);
    expect(backingStores(compressed, decompressed)).toEqual({
      compressed: compressed.byteLength,
      decompressed: decompressed.byteLength,
    });
  });

  it.each(pairs)("%s and %s do not keep the 16 KB output chunk alive", async (compress, decompress) => {
    const compressed = await util.promisify(zlib[compress])(input);
    const decompressed = await util.promisify(zlib[decompress])(compressed);
    expect(decompressed).toEqual(input);
    expect(backingStores(compressed, decompressed)).toEqual({
      compressed: compressed.byteLength,
      decompressed: decompressed.byteLength,
    });
  });

  // Random bytes do not compress, so both directions produce the same number of chunks.
  // A fractional chunkSize is valid. It makes the offsets into the chunk fractional.
  describe.each([
    ["exactly one chunk", 16 * 1024, undefined],
    ["full chunks and a small rest", 3 * 16 * 1024 + 5, undefined],
    ["a large part of one large chunk", 40_000, 64 * 1024],
    ["many small chunks", 10_000, 64],
    ["a fractional chunkSize", 1000, 100.5],
    ["a fractional chunkSize above the input size", 1000, 16 * 1024 + 0.5],
  ])("%s", (_, size, chunkSize) => {
    const data = randomFillSync(Buffer.alloc(size));
    const options = { chunkSize };

    it("round-trips with the sync functions", () => {
      expect(zlib.inflateRawSync(zlib.deflateRawSync(data, options), options)).toEqual(data);
      expect(zlib.zstdDecompressSync(zlib.zstdCompressSync(data, options), options)).toEqual(data);
    });

    it("round-trips with the callback functions", async () => {
      const deflated = await util.promisify(zlib.deflateRaw)(data, options);
      expect(await util.promisify(zlib.inflateRaw)(deflated, options)).toEqual(data);
      const compressed = await util.promisify(zlib.zstdCompress)(data, options);
      expect(await util.promisify(zlib.zstdDecompress)(compressed, options)).toEqual(data);
    });

    it("round-trips with _processChunk on one engine", () => {
      const deflated = zlib.deflateRawSync(data);
      const engine = new zlib.InflateRaw(options);
      const half = deflated.length >> 1;
      // The sync _processChunk closes the handle when it is done. minizlib keeps it open like this.
      const handle = engine._handle;
      const close = handle.close;
      handle.close = () => {};
      const parts = [];
      try {
        parts.push(Buffer.from(engine._processChunk(deflated.subarray(0, half), zlib.constants.Z_SYNC_FLUSH)));
        engine._handle = handle;
        parts.push(Buffer.from(engine._processChunk(deflated.subarray(half), zlib.constants.Z_SYNC_FLUSH)));
      } finally {
        handle.close = close;
        engine._handle = handle;
        engine.close();
      }
      expect(Buffer.concat(parts)).toEqual(data);
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

  it("can compress streaming", async () => {
    const encoder = zlib.createBrotliCompress();
    for (const chunk of window(inputString, 55)) {
      encoder.push(chunk);
    }
    encoder.push(null);
    const buf = await new Response(encoder).text();
    expect(buf).toEqual(inputString);
  });

  it("can decompress streaming", async () => {
    const decoder = zlib.createBrotliDecompress();
    for (const chunk of window(compressedBuffer, 10)) {
      decoder.push(chunk);
    }
    decoder.push(null);
    const buf = await new Response(decoder).bytes();
    expect(buf).toEqual(compressedBuffer);
  });

  it("can roundtrip an empty string", async () => {
    const input = "";
    const compressed = await util.promisify(zlib.brotliCompress)(input);
    const roundtrip = await util.promisify(zlib.brotliDecompress)(compressed);
    expect(roundtrip.toString()).toEqual(input);
  });

  it("can compress streaming big", async () => {
    const encoder = zlib.createBrotliCompress();
    const input = inputString + inputString + inputString + inputString;
    for (const chunk of window(input, 65)) {
      encoder.push(chunk);
    }
    encoder.push(null);
    const buf = await new Response(encoder).text();
    expect(buf).toEqual(input);
  });

  it("fully works as a stream.Transform", async () => {
    const x_dir = tmpdirSync();
    const out_path_c = resolve(x_dir, "this.js.br");
    const out_path_d = resolve(x_dir, "this.js");

    {
      const { resolve, reject, promise } = Promise.withResolvers();
      const readStream = fs.createReadStream(import.meta.filename);
      const writeStream = fs.createWriteStream(out_path_c);
      const brStream = zlib.createBrotliCompress();
      const the_stream = readStream.pipe(brStream).pipe(writeStream);
      the_stream.on("finish", resolve);
      the_stream.on("error", reject);
      await promise;
    }
    {
      const { resolve, reject, promise } = Promise.withResolvers();
      const readStream = fs.createReadStream(out_path_c);
      const writeStream = fs.createWriteStream(out_path_d);
      const brStream = zlib.createBrotliDecompress();
      const the_stream = readStream.pipe(brStream).pipe(writeStream);
      the_stream.on("finish", resolve);
      the_stream.on("error", reject);
      await promise;
    }
    {
      const expected = await Bun.file(import.meta.filename).text();
      const actual = await Bun.file(out_path_d).text();
      expect(actual).toEqual(expected);
    }
  });

  it("streaming encode doesn't wait for entire input", async () => {
    const readStream = new stream.Readable();
    // Quality 4: the test asserts the transform emits multiple output chunks
    // rather than buffering, which is quality-independent; the default (11)
    // pushes 8 MB of random input past the 15s budget on a contended runner.
    const brotliStream = zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
    let all = [];

    const { promise, resolve, reject } = Promise.withResolvers();
    brotliStream.on("data", chunk => all.push(chunk.length));
    brotliStream.on("end", resolve);
    brotliStream.on("error", reject);

    // Distinct incompressible (random) chunks so the compressor emits many output chunks.
    for (let i = 0; i < 8; i++) {
      readStream.push(randomFillSync(Buffer.alloc(1024 * 1024)));
    }
    readStream.push(null);
    readStream.pipe(brotliStream);
    await promise;
    expect(all.length).toBeGreaterThanOrEqual(7);
  }, 15_000);

  it.each(["createBrotliCompress", "createBrotliDecompress"])(
    "%s().flush() rejects a zlib-only flush value",
    factory => {
      const stream = zlib[factory]();
      stream.write(Buffer.alloc(128, 0x61));
      expect(() => stream.flush(zlib.constants.Z_FINISH)).toThrow(
        expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
      );
      expect(() => stream.flush(zlib.constants.Z_BLOCK)).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
      stream.destroy();
    },
  );

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
  [zlib.zstdCompressSync, zlib.createZstdDecompress],
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
    stream => {
      stream.write(compressed);
      stream.write(trailingData);
    },
    stream => {
      stream.write(compressed);
      stream.end(trailingData);
    },
    stream => {
      stream.write(Buffer.concat([compressed, trailingData]));
    },
    stream => {
      stream.end(Buffer.concat([compressed, trailingData]));
    },
  ];
  for (const i in variants) {
    let should_skip = false;
    if (decompressor === zlib.createZstdDecompress && i == 1) should_skip = true; // fails in node too
    if (decompressor === zlib.createZstdDecompress && i == 2) should_skip = true; // fails in node too
    // prettier-ignore
    it.skipIf(should_skip)(`premature end handles bytesWritten properly: ${compress.name} + ${decompressor.name}: variant ${i}`, async () => {
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

for (const C of [zlib.Deflate, zlib.Inflate, zlib.DeflateRaw, zlib.InflateRaw, zlib.Gzip, zlib.Gunzip, zlib.Unzip]) {
  for (const op of [
    "flush",
    "finishFlush",
    "chunkSize",
    "windowBits",
    "level",
    "memLevel",
    "strategy",
    "dictionary",
    "info",
    "maxOutputLength",
  ]) {
    it(`new ${C.name}({ ${op}: undefined }) doesn't throw`, () => {
      expect(() => new C({ [op]: undefined })).not.toThrow();
    });
  }
}

for (const C of [zlib.BrotliCompress, zlib.BrotliDecompress]) {
  for (const op of ["flush", "finishFlush", "chunkSize", "params", "maxOutputLength"]) {
    it(`new ${C.name}({ ${op}: undefined }) doesn't throw`, () => {
      expect(() => new C({ [op]: undefined })).not.toThrow();
    });
  }
}

describe("zlib.zstd", () => {
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
    "KLUv/WD5AF0JAGbXPCCgJUkH/8+rqgA3KaVsW+6LfK3JLcnP+I/" +
    "Gy1/3Qv9XDTQAMwA0AK+Ch9LCub6tnT62C7QuwrHQHDhhNPcCQl" +
    "tMWOrafGy3KO2D79QZ95omy09vwp/TFEAkEIlHOO99cOlZmfRiz" +
    "XQ79GvDoY9TxrTgBBfR+77Nd7LkOWlHaGW+aEwd2rSeegWaj9Ns" +
    "WAJJ0253u1jQpe3ByWLS5i+24QhTAZygaf4UlqNER3XoAk7QYar" +
    "9tjHHV4yHj+tC108zuqMBJ+X2hlpwUqX6vE3r3N7q5QYntVvn3N" +
    "8zVDb9UfCMCW1790yV3A88pgvkvQAniSWvFxMAELvECFu0tC1R9" +
    "Ijsri5bt2kE/2mLoi2wCpkElnidDMS//DemxlNdHClyl6KeNTCugmAG";
  const compressedBuffer = Buffer.from(compressedString, "base64");

  it("zstdDecompress", async () => {
    const roundtrip = await util.promisify(zlib.zstdDecompress)(compressedBuffer);
    expect(roundtrip.toString()).toEqual(inputString);
  });

  it.each([undefined, null])("zstdCompress accepts explicit %p options", async opts => {
    const { promise, resolve, reject } = Promise.withResolvers();
    zlib.zstdCompress(inputString, opts, (err, out) => (err ? reject(err) : resolve(out)));
    const compressed = await promise;
    expect(compressed.toString("base64")).toEqual(compressedString);
  });

  it("zstdCompressSync", () => {
    const compressed = zlib.zstdCompressSync(inputString);
    expect(compressed.toString("base64")).toEqual(compressedString);
  });

  it("zstdDecompressSync", () => {
    const roundtrip = zlib.zstdDecompressSync(compressedBuffer);
    expect(roundtrip.toString()).toEqual(inputString);
  });

  it("zstdDecompressSync decodes concatenated frames", () => {
    const f1 = zlib.zstdCompressSync(Buffer.from("first\n"));
    const f2 = zlib.zstdCompressSync(Buffer.from("second\n"));
    expect(zlib.zstdDecompressSync(Buffer.concat([f1, f2])).toString()).toBe("first\nsecond\n");
  });

  it("can compress streaming", async () => {
    const encoder = zlib.createZstdCompress();
    for (const chunk of window(inputString, 55)) {
      encoder.push(chunk);
    }
    encoder.push(null);
    const buf = await new Response(encoder).text();
    expect(buf).toEqual(inputString);
  });

  it("can decompress streaming", async () => {
    const decoder = zlib.createZstdDecompress();
    for (const chunk of window(compressedBuffer, 10)) {
      decoder.push(chunk);
    }
    decoder.push(null);
    const buf = await new Response(decoder).bytes();
    expect(buf).toEqual(compressedBuffer);
  });

  it("can roundtrip an empty string", async () => {
    const input = "";
    const compressed = await util.promisify(zlib.zstdCompress)(input);
    const roundtrip = await util.promisify(zlib.zstdDecompress)(compressed);
    expect(roundtrip.toString()).toEqual(input);
  });

  it("can compress streaming big", async () => {
    const encoder = zlib.createZstdCompress();
    const input = inputString + inputString + inputString + inputString;
    for (const chunk of window(input, 65)) {
      encoder.push(chunk);
    }
    encoder.push(null);
    const buf = await new Response(encoder).text();
    expect(buf).toEqual(input);
  });

  it("fully works as a stream.Transform", async () => {
    const x_dir = tmpdirSync();
    const out_path_c = resolve(x_dir, "this.js.br");
    const out_path_d = resolve(x_dir, "this.js");

    {
      const { resolve, reject, promise } = Promise.withResolvers();
      const readStream = fs.createReadStream(import.meta.filename);
      const writeStream = fs.createWriteStream(out_path_c);
      const brStream = zlib.createZstdCompress();
      const the_stream = readStream.pipe(brStream).pipe(writeStream);
      the_stream.on("finish", resolve);
      the_stream.on("error", reject);
      await promise;
    }
    {
      const { resolve, reject, promise } = Promise.withResolvers();
      const readStream = fs.createReadStream(out_path_c);
      const writeStream = fs.createWriteStream(out_path_d);
      const brStream = zlib.createZstdDecompress();
      const the_stream = readStream.pipe(brStream).pipe(writeStream);
      the_stream.on("finish", resolve);
      the_stream.on("error", reject);
      await promise;
    }
    {
      const expected = await Bun.file(import.meta.filename).text();
      const actual = await Bun.file(out_path_d).text();
      expect(actual).toEqual(expected);
    }
  });

  it("streaming encode doesn't wait for entire input", async () => {
    const readStream = new stream.Readable();
    const zstdStream = zlib.createZstdCompress();
    let all = [];

    const { promise, resolve, reject } = Promise.withResolvers();
    zstdStream.on("data", chunk => all.push(chunk.length));
    zstdStream.on("end", resolve);
    zstdStream.on("error", reject);

    // Distinct incompressible (random) chunks so the compressor emits many output chunks.
    for (let i = 0; i < 8; i++) {
      readStream.push(randomFillSync(Buffer.alloc(1024 * 1024)));
    }
    readStream.push(null);
    readStream.pipe(zstdStream);
    await promise;
    expect(all.length).toBeGreaterThanOrEqual(7);
  }, 15_000);
});

describe("async write buffer lifetime", () => {
  it("keeps the input and output buffers attached while a native write is in flight", async () => {
    const { promise, resolve } = Promise.withResolvers();
    const deflate = zlib.createDeflate();
    try {
      const handle = deflate._handle;

      const input = new Uint8Array(new ArrayBuffer(64));
      input.fill(97);
      const out = new Uint8Array(new ArrayBuffer(1024));

      // Mirror the bookkeeping processChunk() performs before calling
      // handle.write(), so the native write callback can complete normally.
      handle.buffer = input;
      handle.cb = resolve;
      handle.availOutBefore = out.byteLength;
      handle.availInBefore = input.byteLength;
      handle.inOff = 0;
      handle.flushFlag = zlib.constants.Z_FINISH;

      handle.write(
        zlib.constants.Z_FINISH, // flush
        input, // in
        0, // in_off
        input.byteLength, // in_len
        out, // out
        0, // out_off
        out.byteLength, // out_len
      );

      // The native worker thread reads `input` and writes compressed bytes into
      // `out` through raw pointers until the write completes. Transferring
      // either ArrayBuffer must not detach the backing store out from under
      // the worker -- both buffers must stay attached and full-length.
      out.buffer.transfer();
      input.buffer.transfer();
      expect(out.buffer.detached).toBe(false);
      expect(out.byteLength).toBe(1024);
      expect(input.buffer.detached).toBe(false);
      expect(input.byteLength).toBe(64);

      await promise;

      // Once the write completes the buffers are released and can be
      // transferred again.
      out.buffer.transfer();
      input.buffer.transfer();
      expect(out.buffer.detached).toBe(true);
      expect(input.buffer.detached).toBe(true);
    } finally {
      deflate.close();
    }
  });
});

describe("async write pins are released", () => {
  it("transfer() detaches once several async writes through the same buffers have completed", async () => {
    const deflate = zlib.createDeflate();
    try {
      const handle = deflate._handle;
      const input = new Uint8Array(new ArrayBuffer(64)).fill(97);
      const out = new Uint8Array(new ArrayBuffer(4096));
      for (let i = 0; i < 5; i++) {
        const { promise, resolve } = Promise.withResolvers();
        handle.buffer = input;
        handle.cb = resolve;
        handle.availOutBefore = out.byteLength;
        handle.availInBefore = input.byteLength;
        handle.inOff = 0;
        handle.flushFlag = zlib.constants.Z_NO_FLUSH;
        handle.write(zlib.constants.Z_NO_FLUSH, input, 0, input.byteLength, out, 0, out.byteLength);
        await promise;
      }
      // Every write pinned both buffers; every completion must have unpinned them, or they stay undetachable.
      out.buffer.transfer();
      input.buffer.transfer();
      expect(out.buffer.detached).toBe(true);
      expect(input.buffer.detached).toBe(true);
    } finally {
      deflate.close();
    }
  });
});

describe("dictionary buffer lifetime", () => {
  it("decompresses correctly when the dictionary's ArrayBuffer is detached after stream creation", async () => {
    const dictText = "hello hello hello world world world ";
    const input = Buffer.from(dictText.repeat(16));

    // Each call returns a dictionary backed by its own non-pooled ArrayBuffer
    // so it can be transferred independently.
    const makeDict = () => {
      const dict = new Uint8Array(new ArrayBuffer(dictText.length));
      dict.set(Buffer.from(dictText));
      return dict;
    };

    // Produce a zlib stream whose header demands this dictionary (FDICT set),
    // so inflate must re-read the dictionary bytes mid-stream (Z_NEED_DICT).
    const compressed = zlib.deflateSync(input, { dictionary: makeDict() });

    // Sanity: an intact dictionary round-trips.
    expect(zlib.inflateSync(compressed, { dictionary: makeDict() }).equals(input)).toBe(true);

    // Create the inflater, then detach the dictionary's backing store. The
    // native handle only consumes the dictionary later, when inflate reports
    // Z_NEED_DICT on the worker thread, so it must keep its own copy of the
    // bytes rather than a pointer into the (now freed) JS allocation.
    const dict = makeDict();
    const inflater = zlib.createInflate({ dictionary: dict });
    dict.buffer.transfer(0);
    expect(dict.buffer.detached).toBe(true);

    // Churn the heap so a stale pointer would observe different bytes.
    let garbage = [];
    for (let i = 0; i < 256; i++) garbage.push(new Uint8Array(dictText.length).fill(0xaa));
    Bun.gc(true);
    garbage = [];

    const chunks = [];
    const { promise, resolve, reject } = Promise.withResolvers();
    inflater.on("data", c => chunks.push(c));
    inflater.on("end", resolve);
    inflater.on("error", reject);
    inflater.end(compressed);
    await promise;

    expect(Buffer.concat(chunks).toString()).toBe(input.toString());
  });
});

it.concurrent("native streams take a write state and params at an odd address", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { ptr, toArrayBuffer } from "bun:ffi";
        import zlib from "node:zlib";
        const { constants } = zlib;
        const memory = new Uint8Array(256);
        // Moves the bytes of a small typed array, so it comes before ptr().
        memory.buffer;
        const odd = (offset, length) => new Uint32Array(toArrayBuffer(ptr(memory) + 1 + offset, 0, length * 4));
        const input = Buffer.from("hello hello hello");
        const run = (handle, state, flush) => {
          const out = Buffer.alloc(64);
          handle.writeSync(flush, input, 0, input.length, out, 0, out.length);
          return [out.subarray(0, out.length - state[0]), state[1]];
        };
        {
          const state = odd(0, 2);
          const handle = new (zlib.createDeflate()._handle.constructor)(constants.DEFLATE);
          handle.init(15, 6, 8, 0, state, () => {}, undefined);
          const [out, availIn] = run(handle, state, constants.Z_FINISH);
          console.log(zlib.inflateSync(out).toString(), availIn);
        }
        {
          const state = odd(8, 2);
          const params = odd(16, 10).fill(-1);
          params[constants.BROTLI_PARAM_QUALITY] = 3;
          const handle = new (zlib.createBrotliCompress()._handle.constructor)(constants.BROTLI_ENCODE);
          handle.init(params, state, () => {});
          const [out, availIn] = run(handle, state, constants.BROTLI_OPERATION_FINISH);
          console.log(zlib.brotliDecompressSync(out).toString(), availIn);
        }
        {
          const state = odd(64, 2);
          const handle = new (zlib.createZstdCompress()._handle.constructor)(constants.ZSTD_COMPRESS);
          handle.init(odd(72, 10).fill(-1), undefined, state, () => {});
          const [out, availIn] = run(handle, state, constants.ZSTD_e_end);
          console.log(zlib.zstdDecompressSync(out).toString(), availIn);
        }
        console.log((ptr(memory) + 1) % 2);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual(["hello hello hello 0", "hello hello hello 0", "hello hello hello 0", "1"]);
  expect(exitCode).toBe(0);
});

it("params() between two writes changes the level for the second write", async () => {
  const a = Buffer.alloc(32 * 1024, "a");
  const b = Buffer.alloc(32 * 1024, "b");
  const deflate = zlib.createDeflate({ level: 9 });
  const order = [];
  deflate.write(a, () => order.push("a"));
  deflate.params(0, zlib.constants.Z_FILTERED, () => order.push("params"));
  deflate.write(b, () => order.push("b"));
  deflate.end();
  const compressed = Buffer.concat(await deflate.toArray());
  expect(order).toEqual(["a", "params", "b"]);
  expect(deflate._level).toBe(0);
  expect(zlib.inflateSync(compressed)).toEqual(Buffer.concat([a, b]));
  // Level 0 stores "b".
  expect(compressed.length).toBeGreaterThan(b.length);
  expect(compressed.length).toBeLessThan(b.length + 200);
});

// With the small sizes, the last chunk waits for a reader before it is done.
it.each([{}, { chunkSize: 64, highWaterMark: 64 }])(
  "params() after 'finish' calls back while the output is unread (%j)",
  async options => {
    const input = Buffer.from(Array.from({ length: 1000 }, (_, i) => (i * 2654435761) >>> 24));
    const gzip = zlib.createGzip({ level: 9, ...options });
    gzip.write(input, () => gzip.end());
    await new Promise(resolve => gzip.once("finish", resolve));
    await new Promise(resolve => gzip.params(0, zlib.constants.Z_FILTERED, resolve));
    await new Promise(resolve => gzip.params(1, zlib.constants.Z_FILTERED, resolve));
    expect(gzip._level).toBe(1);
    expect(zlib.gunzipSync(Buffer.concat(await gzip.toArray()))).toEqual(input);
  },
);

describe("crc32", () => {
  it("rejects String objects", () => {
    expect(() => zlib.crc32(new String("abc"))).toThrow(TypeError);
    expect(() => zlib.crc32(String.prototype)).toThrow(TypeError);
    expect(zlib.crc32("abc")).toBe(891568578);
  });

  it("handles missing and undefined arguments", () => {
    // No data argument: ERR_INVALID_ARG_TYPE (not a crash, not a different error).
    expect(() => zlib.crc32()).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    // Explicit undefined behaves the same as no argument.
    expect(() => zlib.crc32(undefined)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    // Omitted second arg defaults to value=0.
    expect(zlib.crc32("hello")).toBe(zlib.crc32("hello", 0));
    // So does an explicit undefined, as a default parameter does in Node.
    expect(zlib.crc32("hello", undefined)).toBe(zlib.crc32("hello", 0));
  });

  it.each([
    [undefined, "undefined"],
    [null, "null"],
    [1, "type number (1)"],
    [{}, "an instance of Object"],
    [new String("a"), "an instance of String"],
  ])("says what Node says of %p as the data", (data, received) => {
    expect(() => zlib.crc32(data)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received ${received}`,
      }),
    );
  });
});

// Windows has no Bun.mmap.
it.skipIf(isWindows)(
  "libdeflate compresses a mapped input that another thread rewrites, or finds that it does not fit",
  async () => {
    using dir = tempDir("libdeflate-race", { "bytes.bin": Buffer.alloc(4096) });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        resolve(import.meta.dir, "libdeflate-racing-input-fixture.ts"),
        resolve(String(dir), "bytes.bin"),
      ],
      env: { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0"].filter(Boolean).join(":") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "done", stderr: "", exitCode: 0 });
  },
  20_000,
);

// `grow()` detaches a `WebAssembly.Memory`'s buffer and frees the old block even if the buffer is pinned.
it("zstdCompress compresses the bytes the caller passed when a WebAssembly.Memory grows after the call", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
      import { zstdCompress, zstdDecompressSync, constants } from "node:zlib";
      import { randomFillSync } from "node:crypto";
      const PAGES = 16; // 1 MB
      const newMemory = () => new WebAssembly.Memory({ initial: PAGES, maximum: PAGES + 4 });

      const mem = newMemory();
      const input = new Uint8Array(mem.buffer);
      // Incompressible input at a high level keeps the job reading until after the block is freed.
      randomFillSync(input);
      const original = Buffer.from(input);

      const { promise, resolve } = Promise.withResolvers();
      const options = { chunkSize: 12 << 20, params: { [constants.ZSTD_c_compressionLevel]: 12 } };
      zstdCompress(input, options, (err, out) =>
        resolve(err ? String(err) : Buffer.compare(zstdDecompressSync(out), original) === 0),
      );
      mem.grow(2);
      // Reuse the freed block so a stale read can't see the caller's bytes.
      const claim = Array.from({ length: 4 }, () => {
        const memory = newMemory();
        new Uint8Array(memory.buffer).fill(0xee);
        return memory;
      });

      console.log(JSON.stringify({ detachedAfterGrow: input.byteLength === 0, roundTripMatches: await promise }));
    `,
    ],
    // Without fast memory, `grow()` moves the block on every platform. With system malloc, the freed block is unmapped.
    env: { ...bunEnv, BUN_JSC_useWasmFastMemory: "0", Malloc: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe(JSON.stringify({ detachedAfterGrow: true, roundTripMatches: true }));
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
