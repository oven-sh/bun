import { deflateSync, gunzipSync, gzipSync, inflateSync } from "bun";
import { describe, expect, it, spyOn } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir, tmpdirSync } from "harness";
import * as buffer from "node:buffer";
import { randomFillSync } from "node:crypto";
import { once } from "node:events";
import * as fs from "node:fs";
import { resolve } from "node:path";
import * as stream from "node:stream";
import * as util from "node:util";
import * as vm from "node:vm";
import * as zlib from "node:zlib";
import { Engine, nothing } from "./zlib-golden/engine";
import { input as goldenInput, random as goldenRandom } from "./zlib-golden/inputs";

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

  describe('library: "libdeflate"', () => {
    const library = "libdeflate";

    function random(state) {
      return below => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) >>> 8) % below;
    }
    function noise(length, values = 256) {
      const next = random(length);
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = next(values);
      return Buffer.from(bytes.buffer);
    }
    const words = Array.from({ length: 900 }, (_, i) => ((i + 1) * (7919 + i)).toString(36) + " ,.\n"[(i % 7) & 3]);
    /** Short words are frequent. */
    function text(length) {
      const next = random(length);
      let text = "";
      while (text.length < length) text += words[next(1 + next(words.length))];
      return Buffer.from(text.slice(0, length));
    }
    /** Up to `longestUnit` new bytes, again and again, and then the next. */
    function repeats(length, longestUnit, longestRun) {
      const next = random(length);
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length;) {
        const unit = 1 + next(longestUnit);
        for (const end = i + unit; i < end; i++) bytes[i] = next(256);
        for (const end = i + next(longestRun); i < end; i++) bytes[i] = bytes[i - unit];
      }
      return Buffer.from(bytes.buffer);
    }

    const inputs = {
      "every length up to 70": Array.from({ length: 71 }, (_, length) => text(70).subarray(0, length)),
      "short text": [text(300), text(511), text(512), text(4999), text(10_000)],
      "text": [text(150_000)],
      "noise": [noise(300), noise(70_000)],
      "few literals": [noise(20_000, 2), noise(20_000, 9), noise(20_000, 40), noise(20_000, 70)],
      "zeros": [Buffer.alloc(259), Buffer.alloc(400_000)],
      "runs": [repeats(90_000, 1, 40), repeats(90_000, 1, 900)],
      "repeats": [repeats(90_000, 9, 80), repeats(90_000, 140, 3000)],
      "as far back as it gets": [32_766, 32_767, 32_768, 32_769].map(period => Buffer.alloc(110_000, noise(period))),
      "one kind after the other": [
        Buffer.concat([
          text(40_000),
          noise(15_000),
          repeats(30_000, 1, 300),
          text(20_000),
          Buffer.alloc(70_000, "0123456789a"),
          noise(9_000, 5),
          text(40_000),
          repeats(40_000, 70, 700),
        ]),
      ],
    };

    // Length and CRC-32 of what they come to at the levels from 0 to 12.
    const outputs = {
      "every length up to 70":
        "2840 fbed1731, 2783 bfbc85d6, 2771 994affc5, 2759 72ab9c3a, 2747 7e3a2c93, 2735 ece7741b, 2723 89528bf1, 2711 e9583147, 2699 58bfee6e, 2687 f4d2b609, 2675 db3d7399, 2663 2d4af09f, 2651 81d48b08",
      "short text":
        "16347 61afba6e, 8351 4c213612, 8351 4c213612, 8351 4c213612, 8351 4c213612, 8351 4c213612, 8351 4c213612, 8336 57ad7147, 8335 e82cff80, 8335 e82cff80, 8268 9dfb385e, 8256 2ab37ca6, 8254 2c7f6b0e",
      "text":
        "150015 1bf9da53, 57559 ad95850d, 57559 ad95850d, 57559 ad95850d, 57559 ad95850d, 57559 ad95850d, 57559 ad95850d, 57688 d221c645, 57662 e6070231, 57662 e6070231, 53708 12f757f2, 53655 a11042a0, 53655 7aeb5314",
      "noise":
        "70315 51f6763b, 70320 32d9eddd, 70320 32d9eddd, 70320 32d9eddd, 70320 32d9eddd, 70320 32d9eddd, 70320 32d9eddd, 70320 32d9eddd, 70320 32d9eddd, 70320 32d9eddd, 70320 32d9eddd, 70320 32d9eddd, 70320 32d9eddd",
      "few literals":
        "80020 4283f9ef, 37564 cda4bfdc, 37564 cda4bfdc, 37564 cda4bfdc, 37564 cda4bfdc, 37593 2af8500c, 37593 2af8500c, 37590 c29cfcd6, 37570 2af5375b, 37570 2af5375b, 37562 5485b467, 37562 84d690e2, 37562 84d690e2",
      "zeros":
        "400299 e534ed11, 408 69706306, 408 69706306, 408 69706306, 408 69706306, 408 69706306, 408 69706306, 408 69706306, 408 69706306, 408 69706306, 408 69706306, 408 69706306, 408 69706306",
      "runs":
        "180020 96ade632, 9863 f9890c42, 9784 c63d81cd, 9784 c63d81cd, 9784 c63d81cd, 9784 c63d81cd, 9784 c63d81cd, 9872 ed6b64a9, 9950 f4c46e6b, 9950 f4c46e6b, 9582 a2b9304d, 9583 721f7be3, 9583 721f7be3",
      "repeats":
        "180020 43dcb3cb, 18251 36a0d33b, 18245 dbb1081b, 18245 dbb1081b, 18245 dbb1081b, 18245 dbb1081b, 18245 dbb1081b, 18244 654e2717, 18245 d6df4156, 18245 d6df4156, 18183 6ff9b085, 18183 6ff9b085, 18176 58641e9d",
      "as far back as it gets":
        "440040 2c93c3cf, 210576 b443cb73, 210731 5824e685, 210731 5824e685, 210731 5824e685, 210731 5824e685, 210731 5824e685, 210731 5824e685, 210731 5824e685, 210731 5824e685, 210731 5824e685, 210731 5824e685, 210731 5824e685",
      "one kind after the other":
        "264025 af96f3cd, 65269 8183d09f, 65172 ee00f0ef, 65172 ee00f0ef, 65172 ee00f0ef, 65172 ee00f0ef, 65172 ee00f0ef, 65008 728d8920, 65002 679e1f1f, 65002 679e1f1f, 62967 bb73be9f, 62803 853243cf, 62791 5822b39c",
    };

    it.each(Object.keys(inputs))("compresses %s to the same bytes on every CPU", name => {
      const sums = [];
      for (let level = 0; level <= 12; level++) {
        const streams = inputs[name].map(input => deflateSync(input, { library, level }));
        for (const library of ["zlib", "libdeflate"]) {
          expect(inputs[name].findIndex((input, i) => !input.equals(inflateSync(streams[i], { library })))).toBe(-1);
        }
        const all = Buffer.concat(streams);
        sums.push(`${all.length} ${zlib.crc32(all).toString(16)}`);
      }
      expect(sums.join(", ")).toBe(outputs[name]);
    });

    it("says in the gzip header how hard it tried", () => {
      const headers = Array.from({ length: 13 }, (_, level) =>
        gzipSync("", { library, level }).subarray(0, 10).toHex(),
      );
      expect(headers).toEqual([..."4400000022222"].map(effort => `1f8b0800000000000${effort}ff`));
    });

    it.each([
      { level: 1 },
      { level: 9 },
      { level: 0, memLevel: 1 },
      { memLevel: 1 },
      { strategy: zlib.constants.Z_FIXED },
      { strategy: zlib.constants.Z_HUFFMAN_ONLY },
      { strategy: zlib.constants.Z_RLE },
    ])("decompresses what zlib makes with %j", options => {
      const all = Object.values(inputs).flat();
      expect(all.findIndex(input => !input.equals(inflateSync(deflateSync(input, options), { library })))).toBe(-1);
      expect(all.findIndex(input => !input.equals(gunzipSync(gzipSync(input, options), { library })))).toBe(-1);
    });

    it("copies a match of any length from any offset that it overlaps", () => {
      const parts = [];
      for (let offset = 1; offset <= 260; offset += offset < 70 ? 1 : 19) {
        const unit = noise(offset + 1000).subarray(1000);
        for (let length = 3; length <= 258; length += length < 70 ? 1 : 9)
          parts.push(Buffer.alloc(offset + length, unit.reverse()));
      }
      const input = Buffer.concat(parts);
      for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED]) {
        expect(input.equals(gunzipSync(gzipSync(input, { strategy }), { library }))).toBe(true);
      }
    });

    it("skips the optional fields of a gzip header", () => {
      const member = zlib.gzipSync("hello");
      for (let flags = 0; flags < 32; flags++) {
        const header = Buffer.concat([
          Buffer.from([0x1f, 0x8b, 8, flags, 1, 2, 3, 4, 0, 3]),
          Buffer.from(flags & 4 ? "\x03\0a\0c" : "", "latin1"),
          Buffer.from(flags & 8 ? "name\0" : "", "latin1"),
          Buffer.from(flags & 16 ? "comment\0" : "", "latin1"),
        ]);
        const crc = zlib.crc32(header);
        const file = Buffer.concat([header, Buffer.from(flags & 2 ? [crc, crc >> 8] : []), member.subarray(10)]);
        expect(Buffer.from(gunzipSync(file, { library })).toString()).toBe("hello");
        for (let length = 0; length < file.length; length++) {
          expect(() => gunzipSync(file.subarray(0, length), { library })).toThrow("bad data");
        }
      }
    });

    it.each([
      ["stored", { level: 0 }],
      ["static", { strategy: zlib.constants.Z_FIXED }],
      ["dynamic", {}],
    ])("agrees with zlib on a %s block that is cut off or has a bit flipped", (_, options) => {
      const outcome = (decompress, file) => {
        try {
          return Buffer.from(decompress(file)).toString("hex");
        } catch {
          return "refused";
        }
      };
      const file = Buffer.from(gzipSync(text(200), options));
      const damaged = Array.from(file, (_, length) => file.subarray(0, length));
      for (let bit = 0; bit < file.length * 8; bit += bit < 600 ? 1 : 11) {
        damaged.push(Buffer.from(file));
        damaged.at(-1)[bit >> 3] ^= 1 << (bit & 7);
      }
      expect(damaged.map(file => outcome(file => gunzipSync(file, { library }), file))).toEqual(
        damaged.map(file => outcome(gunzipSync, file)),
      );
    });
  });

  describe("libdeflate level validation", () => {
    const data = Buffer.alloc(64, "a");
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

  // libdeflate never emits a block bigger than a stored one, so output longer than the input plus
  // its overhead (5 bytes, plus 18 for gzip) means it wrote past the allocation.
  it.concurrent.each(["gzip", "deflate"])(
    "libdeflate %s doesn't write past its output buffer while another thread writes to the shared input",
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
        { memLevel: 5 },
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

    // Z_FIXED takes 9 bits for each byte from 144 up. zlib-ng writes more than deflateBound() for enough of this.
    it(
      "bytes with long fixed codes are stored",
      () => {
        const period = Buffer.alloc(37 * 37 * 38 * 3);
        for (let i = 0; i < period.length; i += 3) {
          const triple = i / 3;
          period[i] = 144 + Math.floor(triple / (37 * 38));
          period[i + 1] = 181 + (Math.floor(triple / 38) % 37);
          period[i + 2] = 218 + (triple % 38);
        }
        const input = Buffer.alloc(100 * 32768, period);
        for (let i = 5 * 32767 + 16000; i + 4 < input.length; i += 3 * 32768) input.copyWithin(i, i - 30000, i - 29996);

        const compressed = deflateSync(input, { memLevel: 9, strategy: zlib.constants.Z_FIXED, level: 2 });
        expect(compressed.length).toBeWithin(input.length, input.length * 1.001);
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

describe.each(["ArrayBuffer", "SharedArrayBuffer"])("%s of another realm", name => {
  function fromOtherRealm(text) {
    return vm.runInNewContext(
      `const array = new Uint8Array(new ${name}(bytes.length)); array.set(bytes); array.buffer`,
      { bytes: Buffer.from(text) },
    );
  }

  it("is input", async () => {
    expect(zlib.gunzipSync(zlib.gzipSync(fromOtherRealm("abc"))).toString()).toBe("abc");
    expect(zlib.gunzipSync(await util.promisify(zlib.gzip)(fromOtherRealm("abc"))).toString()).toBe("abc");
  });

  it("is a dictionary", () => {
    const deflated = zlib.deflateSync("abcabc", { dictionary: fromOtherRealm("abc") });
    expect(zlib.inflateSync(deflated, { dictionary: fromOtherRealm("abc") }).toString()).toBe("abcabc");
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

describe.each([
  ["gzip", "gunzip", "Gunzip"],
  ["gzip", "unzip", "Unzip"],
  ["deflate", "unzip", "Unzip"],
  ["deflate", "inflate", "Inflate"],
  ["deflateRaw", "inflateRaw", "InflateRaw"],
  ["brotliCompress", "brotliDecompress", "BrotliDecompress"],
  ["zstdCompress", "zstdDecompress", "ZstdDecompress"],
])("%s and %s", (compress, decompress, className) => {
  const fast = { params: compress === "brotliCompress" ? { [zlib.constants.BROTLI_PARAM_QUALITY]: 2 } : undefined };
  const chunkSize = 1024;
  const long = goldenInput("prose", 40 * chunkSize + 7);
  const describeResult = (error, result) =>
    error
      ? `${error.name} ${error.code} ${error.errno} ${error.message}`
      : Bun.hash(result.engine ? result.buffer : result);
  const callSync = (name, ...args) => {
    try {
      return describeResult(null, zlib[`${name}Sync`](...args));
    } catch (error) {
      return describeResult(error);
    }
  };
  const call = (name, ...args) =>
    new Promise(resolve => zlib[name](...args, (error, result) => resolve(describeResult(error, result))));

  /** How often each of the methods of the handles is called meanwhile. */
  async function countWrites(run) {
    const engine = new zlib[className]();
    const prototype = Object.getPrototypeOf(engine._handle);
    engine.close();
    const spies = ["write", "writeSync"].map(name => spyOn(prototype, name));
    try {
      await run();
      return spies.map(spy => spy.mock.calls.length);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }

  it("take a whole buffer at once", async () => {
    const writes = await countWrites(async () => {
      expect(zlib[`${decompress}Sync`](zlib[`${compress}Sync`](long, fast), { chunkSize })).toEqual(long);
      const compressed = await util.promisify(zlib[compress])(long, fast);
      expect(await util.promisify(zlib[decompress])(compressed, { chunkSize })).toEqual(long);
    });
    expect(writes).toEqual([0, 0]);
  });

  // With `info` it takes a stream.
  it.each([300, long.length])("end like a stream for %d bytes", async length => {
    const dictionary = long.subarray(50, 250);
    const good = zlib[`${compress}Sync`](long.subarray(0, length), fast);
    const withDictionary = zlib[`${compress}Sync`](long.subarray(0, length), { ...fast, dictionary });
    const damaged = at => Buffer.from(good).fill(0xfe, at, at + 3);
    const cases = [
      [good],
      [good, { maxOutputLength: length }],
      [good, { maxOutputLength: length - 1 }],
      [good, { maxOutputLength: length - 0.5 }],
      [good, { windowBits: 9 }],
      [good.subarray(0, 0)],
      [good.subarray(0, 1)],
      [good.subarray(0, -1)],
      [good.subarray(0, -1), { maxOutputLength: 10 }],
      [damaged(0)],
      [damaged(good.length >> 1)],
      [damaged(good.length - 3)],
      [Buffer.concat([good, good])],
      [Buffer.concat([good, good.subarray(0, 2)])],
      [Buffer.concat([good, good.subarray(0, 9)])],
      [Buffer.concat([good, Buffer.alloc(5)])],
      [Buffer.concat([good, Buffer.alloc(5, 7)])],
      [withDictionary],
      [withDictionary, { dictionary }],
      [withDictionary.subarray(0, -1), { dictionary }],
      [withDictionary, { dictionary: dictionary.subarray(1) }],
    ];
    const results = async more =>
      Promise.all(
        cases.map(async ([data, options]) => [
          callSync(decompress, data, { ...options, ...more }),
          await call(decompress, data, { ...options, ...more }),
        ]),
      );
    const expected = await results({ chunkSize, info: true });
    expect(new Set(expected.flat()).size).toBeGreaterThan(3);
    expect(await results({ chunkSize })).toEqual(expected);
  });

  it("refuse output that is too long", async () => {
    const { length } = zlib[`${compress}Sync`](long, fast);
    const tooLarge = `RangeError ERR_BUFFER_TOO_LARGE undefined Cannot create a Buffer larger than 99 bytes`;
    expect(callSync(compress, long, { ...fast, maxOutputLength: 99 })).toBe(tooLarge);
    expect(await call(compress, long, { ...fast, maxOutputLength: 99 })).toBe(tooLarge);
    expect(await call(compress, long, { ...fast, maxOutputLength: length })).toBe(callSync(compress, long, fast));
  });

  it("keep nothing of the options of the call before", () => {
    const expected = zlib[`${compress}Sync`]("abcabcabc");
    zlib[`${compress}Sync`](long, { ...fast, level: 1, dictionary: Buffer.from("abc") });
    expect(zlib[`${compress}Sync`]("abcabcabc")).toEqual(expected);
    expect(callSync(compress, "", { level: 1.5, params: { 4: 7 } })).toMatch(/ERR_OUT_OF_RANGE|ERR_ZLIB_INIT/);
    const options = {
      get dictionary() {
        expect(zlib[`${compress}Sync`]("abcabcabc")).toEqual(expected);
      },
    };
    expect(zlib[`${compress}Sync`]("abcabcabc", options)).toEqual(expected);
  });

  it("call back later, with the engine, and let other tasks run", async () => {
    const compressed = zlib[`${compress}Sync`]("abc");
    const order = [];
    const { promise, resolve } = Promise.withResolvers();
    zlib[decompress](compressed, function () {
      order.push([this instanceof zlib[className], this.destroyed, this.bytesWritten]);
      resolve();
    });
    process.nextTick(() => order.push("tick"));
    queueMicrotask(() => order.push("microtask"));
    await promise;
    expect(order.pop()).toEqual([true, true, compressed.length]);
    expect(order.sort()).toEqual(["microtask", "tick"]);

    let ran = false;
    setImmediate(() => (ran = true));
    while (!ran) await call(decompress, compressed);
  });

  it.each([
    ["is left alone", () => {}],
    ["is paused", stream => (stream.pause(), setImmediate(() => stream.resume()))],
    ["gets shorter chunks", stream => (stream._chunkSize = 300)],
    ["gets longer chunks", stream => (stream._chunkSize = 2500)],
  ])("give the chunks of writeSync() in a stream that %s", async (name, disturb) => {
    const good = zlib[`${compress}Sync`](long, fast);
    for (const data of [good, Buffer.from(good).fill(0xfe, good.length - 900, good.length - 800)]) {
      const stream = new zlib[className]({ chunkSize, highWaterMark: chunkSize });
      const chunks = [];
      stream.on("data", chunk => chunks.push(chunk) % 5 === 0 && disturb(stream));
      const ended = once(stream, "end").then(
        () => undefined,
        error => `${error.code} ${error.message}`,
      );
      stream.end(data);
      const error = await ended;

      using engine = new Engine(className, { chunkSize });
      if (engine.write(data)) engine.write(nothing, stream._finishFlushFlag);
      expect(error).toBe(engine.error);
      if (error) {
        if (name === "is left alone") expect(Buffer.concat(chunks)).toEqual(engine.output);
        continue;
      }
      expect(Buffer.concat(chunks)).toEqual(engine.output);
      expect(stream.bytesWritten).toBe(engine.read);
      expect(new Set(chunks.slice(0, 5).map(chunk => chunk.length))).toEqual(new Set([chunkSize]));
      expect(new Set(chunks.slice(5, -1).map(chunk => chunk.length))).toEqual(new Set([stream._chunkSize]));
    }
  });
});

it("a zstd frame whose end has yet to be read cannot be reset", async () => {
  const stream = zlib.createZstdCompress({ chunkSize: 4096 });
  stream.once("data", () => stream.reset());
  const failed = once(stream, "error");
  stream.cork();
  stream.end(goldenInput("noise", 10_000));
  expect((await failed)[0].code).toBe("ERR_ZLIB_INCOMPLETE_FRAME");
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
    expect(compressed.length).toBeLessThanOrEqual(compressedBuffer.length);
    expect(zlib.brotliDecompressSync(compressed).toString()).toEqual(inputString);
  });

  it("brotliDecompress", async () => {
    const roundtrip = await util.promisify(zlib.brotliDecompress)(compressedBuffer);
    expect(roundtrip.toString()).toEqual(inputString);
  });

  it("brotliCompressSync", () => {
    const compressed = zlib.brotliCompressSync(inputString);
    expect(compressed.length).toBeLessThanOrEqual(compressedBuffer.length);
    expect(zlib.brotliDecompressSync(compressed).toString()).toEqual(inputString);
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
      expect(compressed.length).toBeLessThanOrEqual(Buffer.from(compressedString2, "base64").length);
      expect(zlib.brotliDecompressSync(compressed).toString()).toEqual(inputString2);
    }
    {
      const compressed = await util.promisify(zlib.brotliCompress)(inputString2, {
        params: {
          [ZLIB.BROTLI_PARAM_MODE]: ZLIB.BROTLI_MODE_TEXT,
          [ZLIB.BROTLI_PARAM_QUALITY]: 2,
        },
      });
      expect(compressed.length).toBeLessThanOrEqual(Buffer.from(compressedString3, "base64").length);
      expect(compressed.length).toBeGreaterThan(Buffer.from(compressedString2, "base64").length);
      expect(zlib.brotliDecompressSync(compressed).toString()).toEqual(inputString2);
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
    // prettier-ignore
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
    expect(compressed.length).toBeLessThan(compressedBuffer.length + 8);
    expect(zlib.zstdDecompressSync(compressed).toString()).toEqual(inputString);
  });

  it("zstdCompressSync", () => {
    const compressed = zlib.zstdCompressSync(inputString);
    expect(compressed.length).toBeLessThan(compressedBuffer.length + 8);
    expect(zlib.zstdDecompressSync(compressed).toString()).toEqual(inputString);
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

  it.each([
    ["empty writes", decoder => decoder.write(Buffer.alloc(0))],
    ["flushes", decoder => decoder.flush()],
  ])("gives up after 16 %s in a row inside a frame", async (_, idle) => {
    const frame = zlib.zstdCompressSync("hello");
    async function decompress(times) {
      const decoder = zlib.createZstdDecompress();
      const chunks = [];
      decoder.on("data", chunk => chunks.push(chunk));
      decoder.write(frame.subarray(0, -1));
      for (let i = 0; i < times; i++) idle(decoder);
      decoder.end(frame.subarray(-1));
      await stream.promises.finished(decoder);
      return Buffer.concat(chunks).toString();
    }
    expect(await decompress(15)).toBe("hello");
    await expect(decompress(16)).rejects.toMatchObject({
      code: "ZSTD_error_noForwardProgress_inputEmpty",
      errno: zlib.constants.ZSTD_error_noForwardProgress_inputEmpty,
      message: "Operation made no progress over multiple calls, due to input being empty",
    });
  });

  it("gives up after 16 calls in a row without room", () => {
    const decoder = zlib.createZstdDecompress();
    decoder._chunkSize = 0;
    decoder._outBuffer = Buffer.alloc(0);
    expect(() => decoder._processChunk(zlib.zstdCompressSync("hello"), zlib.constants.ZSTD_e_end)).toThrow(
      expect.objectContaining({
        code: "ZSTD_error_noForwardProgress_destFull",
        errno: zlib.constants.ZSTD_error_noForwardProgress_destFull,
        message: "Operation made no progress over multiple calls, due to output buffer being full",
      }),
    );
  });

  // The cases of Node's test-zlib-reject-garbage-after-end.js that do not take that option.
  describe("what follows a frame", () => {
    const [a, b] = [zlib.zstdCompressSync("a"), zlib.zstdCompressSync("b")];
    const skippable = Buffer.from("502a4d18040000006d657461", "hex");
    const unexpectedEnd = { message: "unexpected end of file", code: "Z_BUF_ERROR", errno: zlib.constants.Z_BUF_ERROR };

    async function decompressWrites(writes, options) {
      const decoder = zlib.createZstdDecompress(options);
      const chunks = [];
      decoder.on("data", chunk => chunks.push(chunk));
      for (const chunk of writes) decoder.write(chunk);
      decoder.end();
      await stream.promises.finished(decoder);
      return Buffer.concat(chunks).toString();
    }

    function splits(input) {
      return Array.from({ length: input.length + 1 }, (_, at) => [input.subarray(0, at), input.subarray(at)]);
    }

    it.each([
      ["another frame", [a, b], "ab"],
      ["a skippable frame", [a, skippable, b], "ab"],
      ["junk", [a, Buffer.from("trailing junk")], "a"],
      ["junk and a frame", [a, Buffer.from("junk"), b], "a"],
      ["junk that starts like a frame", [a, b.subarray(0, 3), Buffer.from("junk")], "a"],
      ["1 byte of a frame", [a, b.subarray(0, 1)], "a"],
      ["3 bytes of a frame", [a, b.subarray(0, 3)], "a"],
      ["3 bytes of a skippable frame", [a, skippable.subarray(0, 3)], "a"],
    ])("%s, however it is split", async (_, parts, expected) => {
      const input = Buffer.concat(parts);
      expect(zlib.zstdDecompressSync(input).toString()).toBe(expected);
      for (const writes of splits(input)) expect(await decompressWrites(writes)).toBe(expected);
    });

    it.each([
      ["nothing at all", []],
      ["3 bytes of the first frame", [a.subarray(0, 3)]],
      ["4 bytes of the second frame", [a, b.subarray(0, 4)]],
      ["all but 1 byte of the second frame", [a, b.subarray(0, -1)]],
      ["all but 1 byte of a skippable frame", [a, skippable.subarray(0, -1)]],
    ])("%s is an unexpected end", async (_, parts) => {
      const input = Buffer.concat(parts);
      expect(() => zlib.zstdDecompressSync(input)).toThrow(expect.objectContaining(unexpectedEnd));
      for (const writes of splits(input)) await expect(decompressWrites(writes)).rejects.toMatchObject(unexpectedEnd);
    });

    it("junk in place of the first frame is an error", () => {
      expect(() => zlib.zstdDecompressSync(Buffer.from("junk"))).toThrow(
        expect.objectContaining({ code: "ZSTD_error_prefix_unknown" }),
      );
    });

    it("an error in a later frame is reported", async () => {
      const damaged = zlib.zstdCompressSync("b", { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } });
      damaged[damaged.length - 1] ^= 1;
      await expect(decompressWrites([a, damaged])).rejects.toMatchObject({ code: "ZSTD_error_checksum_wrong" });
    });

    it.each([
      ["nothing", Buffer.alloc(0), ""],
      ["junk", Buffer.from("junk"), ""],
      ["a frame", b, "b"],
    ])("%s after a frame that fills the output chunk", async (_, next, expected) => {
      const options = { chunkSize: 64 };
      const content = Buffer.alloc(options.chunkSize, "a").toString();
      const input = Buffer.concat([zlib.zstdCompressSync(content), next]);
      expect(zlib.zstdDecompressSync(input, options).toString()).toBe(content + expected);
      expect(await decompressWrites([input], options)).toBe(content + expected);
    });

    it("reset() ends ignoring junk", () => {
      const decoder = zlib.createZstdDecompress();
      const out = Buffer.alloc(64);
      const write = input => {
        decoder._handle.writeSync(zlib.constants.ZSTD_e_continue, input, 0, input.length, out, 0, out.length);
        return out.toString("latin1", 0, out.length - decoder._writeState[0]);
      };
      expect([write(a), write(Buffer.from("junk")), write(b)]).toEqual(["a", "", ""]);
      decoder.reset();
      expect(write(b)).toBe("b");
      decoder.close();
    });

    it("zlib/iter ignores junk and reports an unexpected end", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--experimental-stream-iter",
          "--no-warnings",
          "-e",
          `const { from, fromSync, pull, pullSync, text, textSync } = require("stream/iter");
           const { decompressZstd, decompressZstdSync } = require("zlib/iter");
           const [a, b] = ["a", "b"].map(it => require("zlib").zstdCompressSync(it));
           for (const chunks of [[a, Buffer.from("junk"), b], [a, b.subarray(0, -1)]]) {
             console.log(await text(pull(from(chunks), decompressZstd())).catch(e => e.code));
             try { console.log(textSync(pullSync(fromSync(chunks), decompressZstdSync()))); }
             catch (e) { console.log(e.code); }
           }`,
        ],
        env: bunEnv,
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("a\na\nZ_BUF_ERROR\nZ_BUF_ERROR\n");
      expect(exitCode).toBe(0);
    });
  });

  it("a frame that fills the output chunk is not followed by an empty one", async () => {
    const input = randomFillSync(Buffer.alloc(100));
    const frame = zlib.zstdCompressSync(input);
    const options = { chunkSize: frame.length };
    expect(zlib.zstdCompressSync(input, options)).toEqual(frame);
    expect(await util.promisify(zlib.zstdCompress)(input, options)).toEqual(frame);
  });

  it("an explicit pledgedSrcSize of 0 is honored by zstdCompress", async () => {
    await expect(util.promisify(zlib.zstdCompress)("a", { pledgedSrcSize: 0 })).rejects.toMatchObject({
      code: "ZSTD_error_srcSize_wrong",
    });
  });

  it.each([
    ["1", "ERR_INVALID_ARG_TYPE", "pledgedSrcSize must be a number"],
    [1.5, "ERR_OUT_OF_RANGE", "pledgedSrcSize must be a safe integer"],
    [-Infinity, "ERR_OUT_OF_RANGE", "pledgedSrcSize must be a safe integer"],
    [-1, "ERR_OUT_OF_RANGE", "pledgedSrcSize must be non-negative"],
  ])("pledgedSrcSize %p throws %s", (pledgedSrcSize, code, message) => {
    expect(() => zlib.createZstdCompress({ pledgedSrcSize })).toThrow(expect.objectContaining({ code, message }));
  });

  it("a dictionary can be a SharedArrayBuffer", () => {
    const bytes = Buffer.from(inputString);
    const dictionary = new SharedArrayBuffer(bytes.length);
    new Uint8Array(dictionary).set(bytes);
    const compressed = zlib.zstdCompressSync(inputString, { dictionary });
    expect(compressed).toEqual(zlib.zstdCompressSync(inputString, { dictionary: bytes }));
    expect(zlib.zstdDecompressSync(compressed, { dictionary }).toString()).toBe(inputString);
  });

  it("a dictionary that cannot be loaded throws", () => {
    const options = { dictionary: Buffer.from("37a430ec01000000", "hex") };
    const expected = expect.objectContaining({
      code: "ERR_ZLIB_INITIALIZATION_FAILED",
      message: "Failed to load zstd dictionary",
    });
    expect(() => zlib.createZstdDecompress(options)).toThrow(expected);
    expect(() => zlib.zstdDecompressSync(compressedBuffer, options)).toThrow(expected);
    expect(() => zlib.zstdDecompress(compressedBuffer, options, () => {})).toThrow(expected);
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

it.each([
  ["createGzip", "Z_FINISH", "gunzipSync"],
  ["createBrotliCompress", "BROTLI_OPERATION_FINISH", "brotliDecompressSync"],
  ["createZstdCompress", "ZSTD_e_end", "zstdDecompressSync"],
])("%s treats a chunk that was detached while it was queued as empty", async (create, finish, inverse) => {
  const chunks = [];
  const compressor = zlib[create]().on("data", chunk => chunks.push(chunk));
  const queued = Buffer.from(new ArrayBuffer(16));
  const { promise, resolve, reject } = Promise.withResolvers();
  compressor.on("error", reject);
  compressor.write("first");
  compressor.write(queued);
  queued.buffer.transfer();
  compressor.flush(zlib.constants[finish], resolve);
  await promise;
  compressor.close();
  expect(zlib[inverse](Buffer.concat(chunks)).toString()).toBe("first");
});

it("a stream of a ShadowRealm keeps its async context across a write", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  new ShadowRealm().evaluate(
    `(report, reject) => {
       const fail = error => reject(String(error));
       Promise.all([import("node:zlib"), import("node:async_hooks")]).then(([zlib, hooks]) => {
         const storage = new hooks.AsyncLocalStorage();
         storage.run("kept", () => zlib.createGzip().on("error", fail).once("data", () => report(storage.getStore())).end("x"));
       }).catch(fail);
     }`,
  )(resolve, reject);
  expect(await promise).toBe("kept");
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

describe.each([
  ["DeflateRaw", "inflateRaw", [1, 2, 3, 6, 7, 9], level => ({ level }), [0, 1, 2, 3, 5], 4],
  ["BrotliCompress", "brotliDecompress", [1, 2, 4, 5, 9, 10, 11], level => ({ params: { 1: level } }), [0, 1], 2],
  ["ZstdCompress", "zstdDecompress", [-1, 1, 3, 5, 6, 9, 13, 19], level => ({ params: { 100: level } }), [0, 1], 2],
])("%s", (className, decompress, levels, optionsFor, flushes, finish) => {
  const compress = (data, level) =>
    zlib[`${className[0].toLowerCase()}${className.slice(1)}Sync`](data, optionsFor(level));
  const data = goldenInput("mixed", 150_000);

  it.each(levels)("does not depend on what was compressed before at level %d", level => {
    for (const length of [100, 1000, 6000, 20_000]) {
      const results = levels.map((other, i) => {
        compress(data.subarray(i, i + (300 << i)), other);
        return Bun.hash(compress(data.subarray(0, length), level));
      });
      expect(new Set(results).size).toBe(1);
    }
  });

  it.each(levels)("takes writes of all lengths and flushes of all kinds in one stream at level %d", level => {
    const [next, out] = [goldenRandom(level + 7), Buffer.alloc(200_000)];
    for (let round = 0; round < (isDebug ? 3 : 20); round++) {
      const engine = new zlib[className](optionsFor(level));
      const start = next(50_000);
      let [at, used] = [start, 0];
      for (let left = 1 + next(8); left >= 0; left--) {
        const length = Math.min(next(2 << next(15)), data.length - at);
        const flush = left ? flushes[next(flushes.length)] : finish;
        engine._handle.writeSync(flush, data, at, length, out, used, out.length - used);
        [at, used] = [at + length, out.length - engine._writeState[0]];
      }
      engine.close();
      expect(zlib[`${decompress}Sync`](out.subarray(0, used)).equals(data.subarray(start, at))).toBe(true);
    }
  });
});

describe("work that is done before it is asked for", () => {
  const noise = goldenInput("noise", 60_000);
  const firstChunk = (engine, input) => {
    engine.write(input);
    return new Promise(resolve => engine.once("data", chunk => resolve([chunk, engine.emit("first", chunk)])));
  };

  it("leaves nothing out if the next write brings more input", async () => {
    const engine = zlib.createDeflate({ level: 0 });
    let rest;
    engine.on("first", () => {
      const more = Buffer.concat([noise.subarray(engine.bytesWritten), Buffer.from("more")]);
      engine._outBuffer = Buffer.alloc(engine._chunkSize);
      engine._outOffset = 0;
      rest = engine._processChunk(more, zlib.constants.Z_FINISH);
      engine.destroy();
    });
    const [first] = await firstChunk(engine, noise);
    expect(zlib.inflateSync(Buffer.concat([first, rest])).equals(Buffer.concat([noise, Buffer.from("more")]))).toBe(
      true,
    );
  });

  it("is no reason to refuse reset() after a frame that fills the chunk", async () => {
    const chunkSize = zlib.zstdCompressSync(noise).length;
    const engine = zlib.createZstdCompress({ chunkSize, flush: zlib.constants.ZSTD_e_end });
    engine.on("first", () => engine.reset());
    const [frame] = await firstChunk(engine, noise);
    expect(engine.errored).toBeNull();
    expect(zlib.zstdDecompressSync(frame).equals(noise)).toBe(true);
    engine.destroy();
  });

  it("takes its error along when reset() drops it", async () => {
    const params = { [zlib.constants.BROTLI_PARAM_LGWIN]: 10, [zlib.constants.BROTLI_PARAM_QUALITY]: 5 };
    const damaged = zlib.brotliCompressSync(noise.subarray(0, 20_000), { params });
    damaged[damaged.length - 1] = 0xff;
    const engine = zlib.createBrotliDecompress();
    let result;
    engine.on("first", () => {
      engine.reset();
      engine._outOffset = 0;
      result = engine._processChunk(zlib.brotliCompressSync("next"), zlib.constants.BROTLI_OPERATION_FINISH);
      engine.destroy();
    });
    await firstChunk(engine, damaged);
    expect(result.toString()).toBe("next");
  });
});

describe("a whole buffer at once", () => {
  it.each(["Gunzip", "BrotliDecompress", "ZstdDecompress", "Gzip", "BrotliCompress", "ZstdCompress"])(
    "is refused by a %s that has begun",
    className => {
      const engine = new zlib[className]();
      engine._handle.writeSync(
        0,
        Buffer.from([0x1f]),
        0,
        className === "ZstdDecompress" ? 0 : 1,
        Buffer.alloc(9),
        0,
        9,
      );
      expect(engine._handle.writeAllSync(Buffer.alloc(9), 1e6)).toBeUndefined();
      expect(engine._handle.writeAll(Buffer.alloc(9), 1e6, () => {})).toBe(false);
      engine.close();
    },
  );

  it.each(["Gzip", "BrotliCompress", "ZstdCompress"])("is refused by a %s that may have to stop early", className => {
    const engine = new zlib[className]();
    expect(engine._handle.writeAll(Buffer.alloc(5000), 5000, () => {})).toBe(false);
    expect(engine._handle.writeAllSync(Buffer.alloc(5000), 5000)).toBeUndefined();
    engine.close();
  });

  it("goes on in chunks if the output is very long", async () => {
    const frame = zlib.zstdCompressSync(Buffer.alloc(1 << 20, "ab"));
    const output = await util.promisify(zlib.zstdDecompress)(Buffer.concat(Array(65).fill(frame)), {
      chunkSize: 1 << 20,
    });
    expect(output.equals(Buffer.alloc(65 << 20, "ab"))).toBe(true);
  });

  it("throws for a detached DataView", () => {
    const view = new DataView(new ArrayBuffer(8));
    view.buffer.transfer();
    expect(() => zlib.gzipSync(view)).toThrow(TypeError);
  });

  it("takes no handle from Object.prototype", async () => {
    const source = `Object.prototype[3] = 1; console.log(require("zlib").gzipSync("").length)`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env: bunEnv, stderr: "inherit" });
    expect(await Promise.all([proc.stdout.text(), proc.exited])).toEqual(["20\n", 0]);
  });
});

it("does not do long work for short input in write()", async () => {
  const text = Buffer.alloc(1 << 20, "ab");
  const bomb = zlib.brotliCompressSync(text, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
  const isDoneAtOnce = async (engine, flush, input) => {
    const seen = [];
    for (let i = 0; i < 5; i++) {
      const [stream, out] = [engine(), Buffer.alloc(1024)];
      stream._outBuffer = out;
      stream._processChunk(input, flush, () => {});
      seen.push(out[0] !== 0);
      await once(stream, "data");
      stream.destroy();
    }
    return seen.every(Boolean);
  };
  const chunkSize = 1024;
  expect({
    short: await isDoneAtOnce(() => zlib.createBrotliDecompress({ chunkSize }), 0, zlib.brotliCompressSync("short")),
    bomb: await isDoneAtOnce(() => zlib.createBrotliDecompress({ chunkSize }), 0, bomb),
    brotli: await isDoneAtOnce(() => zlib.createBrotliCompress({ chunkSize, dictionary: text }), 2, Buffer.from("a")),
    zstd: await isDoneAtOnce(() => zlib.createZstdCompress({ chunkSize, dictionary: text }), 2, Buffer.alloc(0)),
  }).toEqual({ short: true, bomb: false, brotli: false, zstd: false });
});

it("streams that stay open do not pile up the memory that calls pass on to each other", async () => {
  const source = /* js */ `
    const zlib = require("zlib");
    const [input, kept] = [require("fs").readFileSync(process.execPath).subarray(1e6, 1.2e6), []];
    const round = () => {
      Bun.zstdCompressSync(input);
      kept.push(zlib.createZstdCompress({ chunkSize: 64 }));
      Bun.zstdCompressSync(input);
      kept.push(new CompressionStream("zstd"));
      Bun.gc(true);
    };
    round();
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 100; i++) round();
    console.log((process.memoryUsage.rss() - before) >> 20);
  `;
  const env = { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=1"].filter(Boolean).join(":") };
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env, stderr: "inherit" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(Number(stdout)).toBeLessThan(isASAN || isDebug ? 80 : 40);
  expect(exitCode).toBe(0);
});

// Only ASAN can detect the out-of-bounds write.
it.skipIf(!isASAN)(
  "compressors don't write past their buffers when another thread rewrites a mapped input",
  async () => {
    using dir = tempDir("libdeflate-race", { "bytes.bin": Buffer.alloc(70_000) });
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

describe("deflate finds the matches", () => {
  function random(seed) {
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 16;
    return { below: n => next() % n, bytes: n => Buffer.from(Array.from({ length: n }, () => next() >>> 8)) };
  }
  const many = (count, make) => Buffer.concat(Array.from({ length: count }, (_, i) => make(i)));
  const r = random(1);
  const words = r.bytes(1000);
  const bodies = {
    "pixels, 3 times each": [many(22000, () => Buffer.alloc(9, r.bytes(3))), 0.55],
    "pixels, 5 times each": [many(13000, () => Buffer.alloc(15, r.bytes(3))), 0.36],
    "runs": [many(12000, () => Buffer.alloc(1 + r.below(32), r.below(256))), 0.27],
    "words": [many(33000, (i, at = 5 * r.below(200)) => Buffer.concat([words.subarray(at, at + 5), r.bytes(1)])), 0.65],
  };
  const starts = {
    nothing: Buffer.alloc(0),
    noise: r.bytes(9000),
    acgt: r.bytes(9000).map(byte => "acgt".charCodeAt(byte % 4)),
  };
  function check(input, limit, levels, libdeflateLevels) {
    const streams = [
      ...levels.map(level => [`zlib ${level}`, zlib.deflateRawSync(input, { level })]),
      ...libdeflateLevels.map(level => [
        `libdeflate ${level}`,
        Bun.deflateSync(input, { level, library: "libdeflate" }),
      ]),
    ];
    expect(streams.filter(([, it]) => it.length > limit).map(([name, it]) => [name, it.length])).toEqual([]);
    for (const [, stream] of streams) expect(zlib.inflateRawSync(stream).equals(input)).toBe(true);
  }

  for (const [bodyName, [body, ratio]] of Object.entries(bodies)) {
    it.each(Object.keys(starts))(`in ${bodyName} after %s`, start => {
      check(Buffer.concat([starts[start], body]), starts[start].length + ratio * body.length, [1, 6, 9], [6, 10]);
    });
  }

  it.each(Object.keys(starts))("in a counter after %s", start => {
    const counter = Buffer.from(Uint32Array.from({ length: 50000 }, (_, i) => 0x8ecd0000 + 16 * i).buffer);
    check(Buffer.concat([starts[start], counter]), starts[start].length + 0.36 * counter.length, [9], [10]);
  });

  it("in records with few differences", () => {
    const records = Buffer.alloc(200000, r.bytes(257));
    for (let at = 0; at < records.length; at += 1 + r.below(60)) records[at] = r.below(256);
    check(records, 26000, [6, 9], [6, 9, 12]);
  });

  it("in successive versions of a file", () => {
    let version = r.bytes(20000);
    const versions = many(20, (i, at = (i * 7919) % 19000) => {
      return (version = Buffer.concat([version.subarray(0, at), r.bytes(40), version.subarray(at + 7)]));
    });
    check(versions, 28000, [9], [9, 10, 12]);
  });

  it.each([1, 6, 9])("in short messages after one that cannot be compressed, at level %d", async level => {
    async function lenAfter(first) {
      const [stream, ids] = [zlib.createDeflateRaw({ level }), random(2)];
      let len = 0;
      stream.on("data", chunk => (len += chunk.length));
      const send = message => {
        stream.write(message);
        return new Promise(resolve => stream.flush(zlib.constants.Z_SYNC_FLUSH, resolve));
      };
      await send(first);
      len = 0;
      for (let i = 0; i < 200; i++)
        await send(JSON.stringify({ id: ids.below(9999), type: "update", ts: 1700000000 + ids.below(9999), ok: true }));
      stream.close();
      return len;
    }
    expect(await lenAfter(random(3).bytes(20000))).toBeLessThan(1.05 * (await lenAfter("{}")));
  });
});
