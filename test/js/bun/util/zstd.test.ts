import {
  deflateSync,
  gunzipSync,
  gzipSync,
  inflateSync,
  zstdCompress,
  zstdCompressSync,
  zstdDecompress,
  zstdDecompressSync,
} from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, libcPathForDlopen, rss } from "harness";
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import path from "path";
import frames from "./zstd-frames-fixture.json";

// A hand-written empty frame: magic, a descriptor without a content size (so it goes through the
// streaming decoder), the window descriptor (the decoder allocates a window of 2^windowLog bytes before
// it can produce anything) and one empty raw last block.
const emptyFrameWithWindowLog = (windowLog: number) =>
  new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, (windowLog - 10) << 3, 0x01, 0x00, 0x00]);
const emptyFrameWith16MiBWindow = emptyFrameWithWindowLog(24);

describe("Zstandard compression", async () => {
  // Test data of various sizes
  const testCases = [
    // { name: "empty", data: new Uint8Array(0) },
    { name: "small", data: new TextEncoder().encode("Hello, World!") },
    { name: "medium", data: await Bun.file(path.join(__dirname, "..", "..", "..", "bun.lock")).bytes() },
    {
      name: "large",
      data: Buffer.from(
        (await Bun.file(path.join(__dirname, "..", "..", "..", "..", "src", "js_parser", "parser.rs")).text()).repeat(
          5,
        ),
      ),
    },
  ] as const;

  it("throws with invalid level", () => {
    expect(() => zstdCompressSync(new Uint8Array(123), { level: 0 })).toThrowErrorMatchingInlineSnapshot(
      `"Compression level must be between 1 and 22"`,
    );
    expect(() => zstdCompress(new Uint8Array(123), { level: 0 })).toThrowErrorMatchingInlineSnapshot(
      `"Compression level must be between 1 and 22"`,
    );
  });

  it("throws with invalid input", () => {
    expect(() => zstdDecompressSync("wow such compressed")).toThrow();
    expect(() => zstdDecompress("veryyy such compressed")).toThrow();
    const valid = zstdCompressSync(Buffer.from("wow such compressed"));
    valid[0] = 0;
    valid[valid.length - 1] = 0;
    expect(() => zstdDecompressSync(valid)).toThrow();
  });

  it("does not leak on streaming decompression error (unknown content size + corrupt stream)", () => {
    // Zstd frame header with content size *unknown* so decompressAlloc takes the streaming path:
    //   28 B5 2F FD - magic
    //   00          - Frame_Header_Descriptor: FCS_flag=0, Single_Segment=0 → content size not present
    //   58          - Window_Descriptor
    // followed by garbage block data so ZSTD_decompressStream errors after the output buffer
    // has already been allocated.
    const bad = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x58, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

    // Ensure this input actually hits the streaming error path (not InvalidZstdData / fast path).
    expect(() => zstdDecompressSync(bad)).toThrowError(/ZstdDecompressionError/);

    expectStreamingDecompressionNotToLeak(() => {
      try {
        zstdDecompressSync(bad);
      } catch {}
    }, "failed");
  }, 60_000);

  it("does not leak on streaming decompression of an empty result (unknown content size)", () => {
    // The streaming path reserves an output buffer before it knows the result is empty; the empty
    // Buffer handed to JS owns no memory, so that reservation has to be freed rather than leaked.
    const frame = emptyFrameWithWindowLog(10);
    expect(zstdDecompressSync(frame)).toHaveLength(0);

    expectStreamingDecompressionNotToLeak(() => zstdDecompressSync(frame), "empty");
  }, 60_000);

  function expectStreamingDecompressionNotToLeak(decompressOnce: () => void, what: string) {
    const iterations = 10000;
    function batch() {
      for (let i = 0; i < iterations; i++) decompressOnce();
      Bun.gc(true);
      return rss();
    }

    // Warm up until RSS stabilizes (allocator / ASAN quarantine reach steady state).
    // A leak of the ~4 KiB output buffer per call never converges: every batch adds 40+ MiB.
    let prev = batch();
    let growthMiB = Infinity;
    for (let round = 0; round < 5; round++) {
      const cur = batch();
      growthMiB = (cur - prev) / 1024 / 1024;
      prev = cur;
      if (growthMiB < 10) break;
    }

    expect(
      growthMiB,
      `RSS grew by ${growthMiB.toFixed(1)} MiB over ${iterations} ${what} zstd decompressions after warmup`,
    ).toBeLessThan(10);
  }

  describe("few literals whose codes are long", () => {
    // How often each of how many symbols is there, out of 1536: a code of 5 bits for 48 times, of 9 bits for 3 times.
    const upTo8Bits = [
      [48, 8],
      [6, 192],
    ];
    const upTo9Bits = [
      [48, 8],
      [6, 140],
      [3, 104],
    ];
    let x = 1;
    /** In a random order, but that each quarter, which is a Huffman stream of its own, starts with the longest codes. */
    function literals(mix: number[][]) {
      const input: number[] = [];
      let symbol = 0;
      for (const [count, nbSymbols] of mix) {
        for (const end = symbol + nbSymbols; symbol < end; symbol++) input.push(...Array(count).fill(symbol));
      }
      const isRare = (other: number) => other >= symbol - mix.at(-1)![1];
      for (let i = input.length - 1; i > 0; i--) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        const j = (x >>> 0) % (i + 1);
        [input[i], input[j]] = [input[j], input[i]];
      }
      for (let start = 0; start < input.length; start += input.length / 4) {
        for (let i = start, from = start + 8; i < start + 8; i++) {
          while (!isRare(input[from])) from++;
          if (!isRare(input[i])) [input[i], input[from]] = [input[from], input[i]];
        }
      }
      return Uint8Array.from(input);
    }

    // Where a stream ends within a byte, which is what varies, is how many bits there are before more have to be read.
    it.each([
      [8, upTo8Bits],
      [9, upTo9Bits],
    ])("of up to %i bits", (_, mix) => {
      for (let round = 0; round < 40; round++) {
        const input = literals(mix);
        const frame = zstdCompressSync(input);
        expect(frame.length).toBeLessThan(1500);
        expect(Buffer.compare(zstdDecompressSync(frame), input)).toBe(0);
      }
    });

    it("with a table that later blocks use again", () => {
      // Blocks of a target size end with a match.
      const input = Buffer.concat(
        Array.from({ length: 4 }, () => literals(upTo8Bits)).flatMap(part => [part, part.subarray(0, 64)]),
      );
      const ZSTD_c_targetCBlockSize = 130;
      const frame = zlib.zstdCompressSync(input, { params: { [ZSTD_c_targetCBlockSize]: 1340 } });
      // The blocks are after the magic number, the descriptor and a content size of 2 bytes.
      expect(frame[4]).toBe(0x60);
      const literalsTypes: number[] = [];
      for (let at = 7, header = 0; !(header & 1); at += 3 + (header >> 3)) {
        header = frame.readUIntLE(at, 3);
        literalsTypes.push(frame[at + 3] & 3);
      }
      const [compressed, treeless] = [2, 3];
      expect(literalsTypes).toEqual([compressed, treeless, treeless, treeless]);
      expect(Buffer.compare(zstdDecompressSync(frame), input)).toBe(0);
    });
  });

  // Test with known zstd-compressed data
  describe("zstd CLI compatibility", () => {
    for (const { name, compressed, original } of [
      {
        name: "package.json",
        compressed: Buffer.from(
          `KLUv/WSNFW02AJpFEA0swI6MHj4FfolQucJR+D/dUfm04dDfbha4DpjPR5DcwT8VjwrYBlgWQSBZVCDAAMkAwgDN0Fnp0emTbzV3s8XzzePrP5tnXee6lFcSy0tZXkqS5Hx74axOMwq0A80A9vRxGnOx/dE7qyPOqh0QDaJJXIAsnVj89s9Ld9HZ8q8LsTbQIqi/tU6xiCbRIC42zx1zOJrDWWc/SjRHgQZRwb9U9YgW0RA4LtjnnGL8k15Jx3ySeWWBuQFSUB27sC0vFVW/nMVzWNQgZuYGCixB1Z/DqgWdHQlHK9AcEEuQnF+pZ5C8FBSdbPilliXIrcueYhBzA0aXCsZyoWQqJgwGMi1JoXyysR/BUq/VbapTq06KetbN//pBkUwqlAWaCXOJVEwQ/lVU59DpxEKpmKhAIEwWSmXCQCLy6QVd1pbLwwLBQDRTJQKxTBPpqpMizZPH5EBCRjOpUB5ENFMDCIVk0uw48i0TzZUTW9SiRoCAg+173KLNkbIAAda9AZwhA18TttawaCNOIICtdPi1e4D0y3VmJb/T1MOIzkp6Rj3s5r7+E0X0q/bNc6+hoya8urnSSam3w8fifG2ly4+TYh2PWTntcb0l5+tmz2SPfHj9x0U6rb6kgw97ko1WtKpbrp79OE3Zza9aLGLxUhpNdrNbL/mVfCqqnCYvRV1b2/N1Yp1d2zRuHXXpVxTV+qJHq6WO1fouF78bm9Azr3pTW3o2o/mNvs3F3GmGKkR2ThpJkwgOAkAVOGvmSLupW7xZea58KMlLJbIjjd3CxafZ2O90BSK5VDQZSoPIFGHi3oTQK/zzGPkUcEbLYSZQKCgZBxfNBGWCW67Wa8JLprJgQWMmAg0ZDRnMDZC9s7HDbA8ObD22SdzCUUiiKJLO4ePa3ZqIyQAP638xODy0B6fXet4C4MAOGdW+RuXERrWx4amcRuU0PNU2qsVoGc+x2sBoD9HDQ+TA9c2K2T7t0MYPBxV4+qJ6a1lfSdYv6mxTQKjEDMKeUpoYSCASCQUjoQKxfL2ATjrouuOSL6iL8VoeRDKYKaOxPIhI13883q7/dKsVnZ2Wjoqgk9St/MildBTEHEkb67B+7vFu1KW8lL2a0vP8lsSh7sb+FYGEqOGZQWhoRkRSkIIU0gFBBAiCgayUED0SwOIkh7QYUwwhYsyIiIiIiCgoKUhB0xqNm0CdtADU/RPtR76+iC/H0LlxiV3RVBFQVEMfxTGI2Zki6LAMtubw2rzhYzwPwg87PQlElpR2/Ls7SocTKT+QmoPqFjbSRY1GAW4NB/JyQLGOudpTBRZdeSqepHTFnuc4a8Ss72CugyxKenYUVOMaAoFYx+FohmwccIUOgMWQzG4VloyBA5vfdcuCzhKsy5eskQlhKnttUeMRaPlYFHi3OfDbo4Algi5qE4hp5wnxnh7+G+EQhWKqZozIPSmLpnluDThpmqjQqBljNYyKGkDcPw/5oT7PwZRMx7KYCsfB3ACkfW+7kwKchL/+pMOJBRpNiCOl9SZO/Gva20fQ65DnhOl6GVzhO9S+5S9c1fx4Qgf06Kk8smDpbO63cRVeSUZnNUjq2sQY2VGFLA3jD9FRQYS9WIomzkhQD+AlQZRL5Csjm/Xw4aq5wb+UMQG2qucFzKTE7fAJ/KuFs8akw8bEwRiIpbD9tihD+Dv+YXx2LnC/f1CFDfi4KbAEv6wR3OLofbPh4M7hQtr8wc/fl55p8gyO2oeK6MM25EiwttB6VmfH+CogsSoe0iY36kzdeRr7rnhQWj9TwbtxgGbMBHaMocqY5+7Q5wBo3WheMOyhzEU6mvwwx4GXHTEfe8dwOwOIDnMSYk/GvsB1w8VguyIACtHwOL6QwLn3howqxiWgx3DAg2meUJA55NgAECWRKmD31H2+aJNmGATiaCOL0ktbox3NImajx4kQIZQFuSp3UahXx74rUnSNLYda0Urr7WVd5VgSSO0y+MOEODnzh0uaDYohHCQQIF50S1NW5ySRld+sch5S+BoQhwDmEHZUNor7k0GZ9F1cRc5TJPHsnxicpUq8/LO0gACwagmWA3U+X1d13YqBcolfjqRQ7udoZq6QWR4+ErRi5nzuMeEm28nfnwwJrisZqooPIw9kuaYpJyKdZBLqaGte3r2nr5z0FiRCALP2h6JGshUEkMIo/eYWNTBa6lKeuTVPb+XAGE4XzyTEM62qLNLnMGV8FuL0iqvzvKJ+AO0t4i/yc8fwHyK4Qheni3NOna2pYKszuq2MsSxBNUALonv3UJNZo6HwDH1zg+VvIe2KZpTDIeg6DLxcPf2ZbhipV1fEllrxJ2kfnMhggh9ZURGN`,
          "base64",
        ),
        original: Buffer.from(
          JSON.stringify(
            {
              "private": true,
              "name": "bun",
              "version": "1.2.14",
              "workspaces": ["./packages/bun-types", "./packages/@types/bun"],
              "devDependencies": {
                "@types/react": "^18.3.3",
                "esbuild": "^0.21.4",
                "mitata": "^0.1.11",
                "peechy": "0.4.34",
                "prettier": "^3.5.3",
                "prettier-plugin-organize-imports": "^4.0.0",
                "react": "^18.3.1",
                "react-dom": "^18.3.1",
                "source-map-js": "^1.2.0",
                "typescript": "^5.7.2",
              },
              "resolutions": {
                "bun-types": "workspace:packages/bun-types",
                "@types/bun": "workspace:packages/@types/bun",
              },
              "scripts": {
                "build": "bun run build:debug",
                "watch":
                  "zig build check --watch -fincremental --prominent-compile-errors --global-cache-dir build/debug/zig-check-cache --zig-lib-dir vendor/zig/lib",
                "watch-windows":
                  "zig build check-windows --watch -fincremental --prominent-compile-errors --global-cache-dir build/debug/zig-check-cache --zig-lib-dir vendor/zig/lib",
                "agent":
                  "(bun run --silent build:debug &> /tmp/bun.debug.build.log || (cat /tmp/bun.debug.build.log && rm -rf /tmp/bun.debug.build.log && exit 1)) && rm -f /tmp/bun.debug.build.log && ./build/debug/bun-debug",
                "build:debug": "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Debug -B build/debug",
                "build:debug:asan":
                  "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Debug -DENABLE_ASAN=ON -B build/debug-asan",
                "build:valgrind":
                  "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Debug -DENABLE_BASELINE=ON -ENABLE_VALGRIND=ON -B build/debug-valgrind",
                "build:release": "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Release -B build/release",
                "build:ci":
                  "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Release -DCMAKE_VERBOSE_MAKEFILE=ON -DCI=true -B build/release-ci --verbose --fresh",
                "build:assert":
                  "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DENABLE_ASSERTIONS=ON -DENABLE_LOGS=ON -B build/release-assert",
                "build:asan":
                  "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Release -DENABLE_ASSERTIONS=ON -DENABLE_LOGS=OFF -DENABLE_ASAN=ON -DENABLE_LTO=OFF -B build/release-asan",
                "build:logs":
                  "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Release -DENABLE_LOGS=ON -B build/release-logs",
                "build:safe":
                  "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Release -DZIG_OPTIMIZE=ReleaseSafe -B build/release-safe",
                "build:smol": "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=MinSizeRel -B build/release-smol",
                "build:local":
                  "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Debug -DWEBKIT_LOCAL=ON -B build/debug-local",
                "build:release:local":
                  "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Release -DWEBKIT_LOCAL=ON -B build/release-local",
                "build:release:with_logs":
                  "cmake . -DCMAKE_BUILD_TYPE=Release -DENABLE_LOGS=true -GNinja -Bbuild-release && ninja -Cbuild-release",
                "build:debug-zig-release":
                  "cmake . -DCMAKE_BUILD_TYPE=Release -DZIG_OPTIMIZE=Debug -GNinja -Bbuild-debug-zig-release && ninja -Cbuild-debug-zig-release",
                "run:linux":
                  'docker run --rm  -v "$PWD:/root/bun/" -w /root/bun ghcr.io/oven-sh/bun-development-docker-image',
                "css-properties": "bun run src/css/properties/generate_properties.ts",
                "uv-posix-stubs": "bun run src/bun.js/bindings/libuv/generate_uv_posix_stubs.ts",
                "bump": "bun ./scripts/bump.ts",
                "typecheck": "tsc --noEmit && cd test && bun run typecheck",
                "fmt": "bun run prettier",
                "fmt:cpp": "bun run clang-format",
                "fmt:zig": "bun run zig-format",
                "lint": "bunx oxlint --config=oxlint.json --format=github src/js",
                "lint:fix": "oxlint --config oxlint.json --fix",
                "test": "node scripts/runner.node.mjs --exec-path ./build/debug/bun-debug",
                "test:release": "node scripts/runner.node.mjs --exec-path ./build/release/bun",
                "banned": "bun test test/internal/ban-words.test.ts",
                "glob-sources": "bun scripts/glob-sources.mjs",
                "zig": "vendor/zig/zig.exe",
                "zig:test": "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Debug -DBUN_TEST=ON -B build/debug",
                "zig:test:release":
                  "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Release -DBUNTEST=ON -B build/release",
                "zig:test:ci":
                  "bun ./scripts/build.mjs -GNinja -DCMAKE_BUILD_TYPE=Release -DBUN_TEST=ON -DZIG_OPTIMIZE=ReleaseSafe -DCMAKE_VERBOSE_MAKEFILE=ON -DCI=true -B build/release-ci --verbose --fresh",
                "zig:fmt": "bun run zig-format",
                "zig:check": "bun run zig build check --summary new",
                "zig:check-all": "bun run zig build check-all --summary new",
                "zig:check-windows": "bun run zig build check-windows --summary new",
                "analysis":
                  "bun ./scripts/build.mjs -DCMAKE_BUILD_TYPE=Debug -DENABLE_ANALYSIS=ON -DENABLE_CCACHE=OFF -B build/analysis",
                "analysis:no-llvm": "bun run analysis -DENABLE_LLVM=OFF",
                "clang-format": "bun run analysis --target clang-format",
                "clang-format:check": "bun run analysis --target clang-format-check",
                "clang-format:diff": "bun run analysis --target clang-format-diff",
                "clang-tidy": "bun run analysis --target clang-tidy",
                "clang-tidy:check": "bun run analysis --target clang-tidy-check",
                "clang-tidy:diff": "bun run analysis --target clang-tidy-diff",
                "zig-format": "bun run analysis:no-llvm --target zig-format",
                "zig-format:check": "bun run analysis:no-llvm --target zig-format-check",
                "prettier":
                  "bunx prettier@latest --plugin=prettier-plugin-organize-imports --config .prettierrc --write scripts packages src docs 'test/**/*.{test,spec}.{ts,tsx,js,jsx,mts,mjs,cjs,cts}' '!test/**/*fixture*.*'",
                "node:test": "node ./scripts/runner.node.mjs --quiet --exec-path=$npm_execpath --node-tests ",
                "clean:zig":
                  "rm -rf build/debug/cache/zig build/debug/CMakeCache.txt 'build/debug/*.o' .zig-cache zig-out || true",
              },
            },
            null,
            2,
          ) + "\n",
        ),
      },
    ] as const) {
      it(`can decompress ${name}`, async () => {
        // Test sync decompression
        const syncDecompressed = zstdDecompressSync(compressed);
        expect(syncDecompressed.toString()).toStrictEqual(original.toString());

        // Test async decompression
        const asyncDecompressed = await zstdDecompress(compressed);
        expect(asyncDecompressed.toString()).toStrictEqual(original.toString());
      });
    }
  });

  for (const { data: input, name } of testCases) {
    describe.concurrent(name + " (" + input.length + " bytes)", () => {
      for (let level = 1; level <= 22; level++) {
        it("level " + level, async () => {
          // Kick off async compression first so it runs in the thread pool while
          // the sync compression below blocks the main thread.
          const asyncCompressedPromise = zstdCompress(input, { level });

          // Sync compression
          const syncCompressed = zstdCompressSync(input, { level });

          // Async compression
          const asyncCompressed = await asyncCompressedPromise;

          // Compare compressed results (they should be identical with same level)
          expect(syncCompressed).toStrictEqual(asyncCompressed);

          // Kick off async decompression of sync compressed data first so it overlaps
          // with the sync decompression below.
          const asyncDecompressedPromise = zstdDecompress(syncCompressed);

          // Sync decompression of async compressed data
          const syncDecompressed = zstdDecompressSync(asyncCompressed);

          // Async decompression of sync compressed data
          const asyncDecompressed = await asyncDecompressedPromise;

          // Compare decompressed results
          expect(syncDecompressed).toStrictEqual(asyncDecompressed);

          // Verify both match original
          expect(syncDecompressed).toStrictEqual<Uint8Array>(input);
          expect(asyncDecompressed).toStrictEqual<Uint8Array>(input);
        });
      }
    });
  }
});

describe("decompressing frames whose size is known", () => {
  let x = 0x9e3779b9;
  const noise = (length: number) =>
    Buffer.from(
      Uint8Array.from({ length }, () => {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        return x;
      }),
    );
  const repeated = (period: Buffer, length: number) => Buffer.alloc(length, period);
  // Blocks that are stored, blocks of one byte, blocks of a few long matches, and blocks of many short ones.
  const pieces = [
    noise(140_000),
    Buffer.alloc(270_000, 7),
    repeated(noise(1000), 140_000),
    repeated(Buffer.from("one two three two one three "), 20_000),
    repeated(noise(60_000), 200_000),
    Buffer.from(noise(30_000).map(byte => 97 + (byte & 3) * ((byte >> 2) % 3))),
    noise(9),
  ];
  const whole = Buffer.concat(pieces);

  // "raw", "rle", or how many sequences a compressed block has. Or else how its literals are written.
  function blocks(frame: Uint8Array, ofLiterals = false) {
    const descriptor = frame[4];
    const isSingleSegment = (descriptor >> 5) & 1;
    let at = 5 + (1 - isSingleSegment) + [0, 1, 2, 4][descriptor & 3] + [isSingleSegment, 2, 4, 8][descriptor >> 6];
    const kinds: (string | number)[] = [];
    for (let isLast = 0; !isLast;) {
      const header = frame[at] | (frame[at + 1] << 8) | (frame[at + 2] << 16);
      at += 3;
      isLast = header & 1;
      const type = (header >> 1) & 3;
      if (type === 2) {
        const format = (frame[at] >> 2) & 3;
        const bits =
          frame[at] +
          frame[at + 1] * 2 ** 8 +
          frame[at + 2] * 2 ** 16 +
          frame[at + 3] * 2 ** 24 +
          frame[at + 4] * 2 ** 32;
        let literals: number;
        if ((frame[at] & 3) < 2) {
          const size = format === 1 ? (bits >> 4) & 0xfff : format === 3 ? (bits >> 4) & 0xfffff : frame[at] >> 3;
          literals = [1, 2, 1, 3][format] + ((frame[at] & 3) === 0 ? size : 1);
        } else {
          const width = [10, 10, 14, 18][format];
          literals = [3, 3, 4, 5][format] + (Math.floor(bits / 2 ** (4 + width)) % 2 ** width);
        }
        const [first, second, third] = frame.subarray(at + literals);
        kinds.push(
          ofLiterals
            ? ["raw", "rle", "code", "same code"][frame[at] & 3]
            : first < 128
              ? first
              : first < 255
                ? ((first - 128) << 8) + second
                : second + (third << 8) + 0x7f00,
        );
      } else {
        kinds.push(["raw", "rle"][type]);
      }
      at += type === 1 ? 1 : header >> 3;
    }
    return kinds;
  }

  it("the frames have blocks of these kinds", () => {
    expect(pieces.map(piece => blocks(zstdCompressSync(piece, { level: 1 })))).toEqual([
      ["raw", "raw"],
      [1, "rle", "rle"],
      [1, 1],
      [4],
      [1, 1],
      [3647],
      ["raw"],
    ]);
  });

  it.each([1, 3])("stretches of noise, runs and long matches in one frame of level %i", level => {
    expect(zstdDecompressSync(zstdCompressSync(whole, { level })).equals(whole)).toBe(true);
  });

  it("the same in a frame each, whose blocks are let to write more or less", () => {
    const frames = pieces.map((piece, i) =>
      zlib.zstdCompressSync(piece, { params: { [zlib.constants.ZSTD_c_windowLog]: [17, 10, 20, 12][i % 4] } }),
    );
    expect(zstdDecompressSync(Buffer.concat(frames)).equals(whole)).toBe(true);
    expect(zstdDecompressSync(Buffer.concat(frames.toReversed())).equals(Buffer.concat(pieces.toReversed()))).toBe(
      true,
    );
  });

  it.each([4097, 4100, 4222, 8200])("long matches from %i bytes back, which are copied in parts", period => {
    const data = repeated(noise(period), 40_000);
    const frame = zstdCompressSync(data, { level: 3 });
    expect(zstdDecompressSync(frame).equals(data)).toBe(true);
    expect(zlib.zstdDecompressSync(frame).equals(data)).toBe(true);
  });

  it.each([
    [0xffff, 0, ["raw", "raw", "raw", "code", "code", "code,same code,same code,same code"]],
    [0xffffffff, 0, ["raw", "code", "code", "code", "code", "code,code,code,same code"]],
    [0xffffffff, 2, ["code", "code", "code", "code", "code", "code,code,same code,same code"]],
  ])(
    "literals that take many bits: the least of the bytes of a number up to %i, shifted by %i",
    (mask, shift, written) => {
      let x = 0x9e3779b9;
      const kinds = [300, 1500, 3000, 6000, 20_000, 400_000].map(length => {
        const data = Buffer.from(
          Uint8Array.from({ length }, () => {
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            const y = x | ~mask;
            return Math.min(y & 255, (y >> 8) & 255, (y >> 16) & 255, y >>> 24) >> shift;
          }),
        );
        const frame = zstdCompressSync(data, { level: 1 });
        expect(zstdDecompressSync(frame).equals(data)).toBe(true);
        expect(zlib.zstdDecompressSync(frame).equals(data)).toBe(true);
        return blocks(frame, true).join();
      });
      expect(kinds).toEqual(written);
    },
  );

  it("a frame that makes more than it says is refused", () => {
    for (const piece of pieces.filter(piece => piece.length >= 135_000)) {
      const frame = zstdCompressSync(piece.subarray(0, 135_000), { level: 1 });
      // The content size, 4 bytes of it from 64 KB on, after the magic number and the descriptor.
      expect(frame.readUInt32LE(5)).toBe(135_000);
      for (const size of [134_999, 131_072, 70_000]) {
        const lying = Buffer.from(frame);
        lying.writeUInt32LE(size, 5);
        expect(() => zstdDecompressSync(lying)).toThrow("Decompression failed: DecompressionFailed");
      }
    }
  });
});

// zstdDecompressSync sizes its output from the frame header when the content size is
// present and at most 16 MiB. Anything else is decoded in a stream into a buffer that
// starts at a guess (the input size, or the 16 MiB limit) and grows as needed.
describe("decompressing frames whose size is not known up front", () => {
  const MiB = 1024 * 1024;

  // CompressionStream does not know the total size when it writes the frame header.
  async function compressWithoutContentSize(data: Uint8Array): Promise<Uint8Array> {
    const frame = await new Response(new Response(data).body!.pipeThrough(new CompressionStream("zstd"))).bytes();
    // RFC 8878 3.1.1.1.1: with the Frame_Content_Size_flag (bits 7-6) and the
    // Single_Segment_flag (bit 5) both clear, the header carries no content size.
    expect(frame[4] & 0xe0).toBe(0);
    return frame;
  }

  function patternBytes(length: number): Buffer {
    // Incompressible, but deterministic: xorshift32.
    const bytes = Buffer.alloc(length);
    let x = 0x9e3779b9;
    for (let i = 0; i < length; i += 4) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      bytes.writeUInt32LE(x >>> 0, i);
    }
    return bytes;
  }

  it.concurrent("output larger than the input (the buffer has to grow)", async () => {
    const original = Buffer.from(JSON.stringify(Array.from({ length: 20_000 }, (_, i) => ({ id: i, ok: true }))));
    const frame = await compressWithoutContentSize(original);
    expect(frame.length).toBeLessThan(original.length / 4);

    expect(zstdDecompressSync(frame)).toEqual(original);
    expect(await zstdDecompress(frame)).toEqual(original);
  });

  it.concurrent("output smaller than the input (the initial buffer is enough)", async () => {
    const original = patternBytes(256 * 1024);
    const frame = await compressWithoutContentSize(original);
    expect(frame.length).toBeGreaterThan(original.length);

    expect(zstdDecompressSync(frame)).toEqual(original);
    expect(await zstdDecompress(frame)).toEqual(original);
  });

  it.concurrent("several frames in one input", async () => {
    const parts = [patternBytes(64 * 1024), Buffer.alloc(300 * 1024, "abc"), Buffer.from("tail")];
    const frames = await Promise.all(parts.map(compressWithoutContentSize));
    const original = Buffer.concat(parts);

    expect(zstdDecompressSync(Buffer.concat(frames))).toEqual(original);
    expect(await zstdDecompress(Buffer.concat(frames))).toEqual(original);
  });

  it.concurrent("content size in the header just over the 16 MiB limit", async () => {
    // The streaming decoder starts with exactly 16 MiB of room, so this frame fills it
    // completely and still has one byte to go.
    const original = Buffer.alloc(16 * MiB + 1, 0x5a);
    const frame = zstdCompressSync(original);

    const fromSync = zstdDecompressSync(frame);
    expect([fromSync.length, fromSync.equals(original)]).toEqual([original.length, true]);
    const fromAsync = await zstdDecompress(frame);
    expect([fromAsync.length, fromAsync.equals(original)]).toEqual([original.length, true]);
  });
});

// The output buffers are sized by the input: the compression bound of the caller's data, or
// whatever the (possibly hostile) frames say they decompress to. When that allocation fails
// the call has to throw or reject, not take the process down. ASAN's allocation cap makes the
// failure deterministic: native allocations above CAP_MIB fail, while the JS Buffers the
// script itself creates are backed by JSC's own allocator and are not affected.
describe.skipIf(!isASAN)("a failed allocation is an error, not a crash", () => {
  const MiB = 1024 * 1024;
  const CAP_MIB = 8;
  const outOfMemory = { name: "RangeError", message: "Out of memory" };

  // Like emptyFrameWith16MiBWindow, a stream whose decoder has to allocate a 16 MiB window (larger
  // than the cap) before it can produce anything, so the codec's own allocation fails, not one of ours.
  const brotliWith16MiBWindow = (input: Uint8Array) =>
    zlib.brotliCompressSync(input, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 },
    });

  // Runs `script` in a child whose native allocations above the cap fail. `inputs` arrive in the
  // child as Buffers in a `inputs` object; the script prints a JSON object, which is returned.
  async function runCapped(inputs: Record<string, Uint8Array>, script: string): Promise<unknown> {
    const inputsBase64 = Object.fromEntries(
      Object.entries(inputs).map(([name, bytes]) => [name, Buffer.from(bytes).toString("base64")]),
    );
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
          const inputs = Object.fromEntries(
            Object.entries(${JSON.stringify(inputsBase64)}).map(([name, b64]) => [name, Buffer.from(b64, "base64")]),
          );
          const describeError = e => ({ name: e.name, message: e.message });
          const results = {};
          const attempt = (name, fn) => { try { results[name] = fn().length; } catch (e) { results[name] = describeError(e); } };
          ${script}
          console.log(JSON.stringify(results));
        `,
      ],
      env: {
        ...bunEnv,
        // detect_leaks=0: LeakSanitizer cannot see through JSC cells to the natives they own.
        ASAN_OPTIONS: [
          bunEnv.ASAN_OPTIONS,
          "allocator_may_return_null=1",
          `max_allocation_size_mb=${CAP_MIB}`,
          "detect_leaks=0",
        ]
          .filter(Boolean)
          .join(":"),
      },
      stdout: "pipe",
      // ASAN logs a warning for every refused allocation; drained, not asserted on.
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout, `the child printed nothing and exited with ${exitCode}\nstderr:\n${stderr}`).not.toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  it.concurrent("zstd: compress and decompress, sync and async", async () => {
    // The first three decompress to more than the cap and each reaches the allocation differently:
    // a header size under the 16 MiB limit is allocated up front; one above it starts the
    // streaming decoder at 16 MiB; no header size starts small and fails while growing.
    const frames = {
      headerSize: zstdCompressSync(Buffer.alloc(12 * MiB)),
      headerSizeAboveLimit: zstdCompressSync(Buffer.alloc(32 * MiB)),
      noHeaderSize: await new Response(
        new Response(Buffer.alloc(12 * MiB)).body!.pipeThrough(new CompressionStream("zstd")),
      ).bytes(),
      largeWindow: emptyFrameWith16MiBWindow,
    };
    expect(frames.noHeaderSize[4] & 0xe0).toBe(0);
    expect(zstdDecompressSync(frames.largeWindow)).toHaveLength(0);

    const results = await runCapped(
      frames,
      /* js */ `
        // The compression bound of this is a little over the cap.
        const input = Buffer.alloc(${2 * CAP_MIB} * 1024 * 1024);
        attempt("compressSync", () => Bun.zstdCompressSync(input));
        results.compress = await Bun.zstdCompress(input).then(out => out.length, describeError);
        for (const [name, frame] of Object.entries(inputs)) {
          attempt("decompressSync " + name, () => Bun.zstdDecompressSync(frame));
          results["decompress " + name] = await Bun.zstdDecompress(frame).then(out => out.length, describeError);
        }
        results.afterwards = Bun.zstdDecompressSync(Bun.zstdCompressSync("still works")).toString();
        results.afterwardsAsync = (await Bun.zstdDecompress(await Bun.zstdCompress("still works"))).toString();
      `,
    );
    expect(results).toEqual({
      compressSync: outOfMemory,
      compress: outOfMemory,
      "decompressSync headerSize": outOfMemory,
      "decompress headerSize": outOfMemory,
      "decompressSync headerSizeAboveLimit": outOfMemory,
      "decompress headerSizeAboveLimit": outOfMemory,
      "decompressSync noHeaderSize": outOfMemory,
      "decompress noHeaderSize": outOfMemory,
      "decompressSync largeWindow": outOfMemory,
      "decompress largeWindow": outOfMemory,
      afterwards: "still works",
      afterwardsAsync: "still works",
    });
  });

  it.concurrent("gzip and deflate, with zlib and with libdeflate", async () => {
    // gunzip reads the size from the gzip trailer (12 MiB, which cannot be reserved, so it
    // starts small); inflate has no such hint. Both then fail while growing towards 12 MiB.
    const streams = {
      gzip: gzipSync(Buffer.alloc(12 * MiB)),
      deflate: deflateSync(Buffer.alloc(12 * MiB)),
    };

    const results = await runCapped(
      streams,
      /* js */ `
        // Both compression bounds of this are a little over the cap.
        const input = Buffer.alloc(${2 * CAP_MIB} * 1024 * 1024);
        for (const library of ["zlib", "libdeflate"]) {
          attempt("gzipSync " + library, () => Bun.gzipSync(input, { library }));
          attempt("deflateSync " + library, () => Bun.deflateSync(input, { library }));
          attempt("gunzipSync " + library, () => Bun.gunzipSync(inputs.gzip, { library }));
          attempt("inflateSync " + library, () => Bun.inflateSync(inputs.deflate, { library }));
        }
        const text = bytes => new TextDecoder().decode(bytes);
        results.afterwards = text(Bun.gunzipSync(Bun.gzipSync("still works"))) + " " + text(Bun.inflateSync(Bun.deflateSync("still works", { library: "libdeflate" }), { library: "libdeflate" }));
      `,
    );
    expect(results).toEqual({
      "gzipSync zlib": outOfMemory,
      "deflateSync zlib": outOfMemory,
      "gunzipSync zlib": outOfMemory,
      "inflateSync zlib": outOfMemory,
      "gzipSync libdeflate": outOfMemory,
      "deflateSync libdeflate": outOfMemory,
      "gunzipSync libdeflate": outOfMemory,
      "inflateSync libdeflate": outOfMemory,
      afterwards: "still works still works",
    });
  });

  it.concurrent("fetch() decompressing a response body", async () => {
    // The first four bodies decompress to 12 MiB: the gzip trailer's size cannot be reserved up front
    // and every streaming decoder (zlib, brotli, zstd) fails while growing its output. The two
    // large-window bodies fail inside the codec instead.
    const zeros = Buffer.alloc(12 * MiB);
    const bodies = {
      gzip: gzipSync(zeros),
      // Content-Encoding: deflate is the zlib-wrapped stream; Bun.deflateSync would emit raw deflate.
      deflate: zlib.deflateSync(zeros),
      br: zlib.brotliCompressSync(zeros, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } }),
      zstd: zstdCompressSync(zeros),
      "br-large-window": brotliWith16MiBWindow(zeros),
      "zstd-large-window": emptyFrameWith16MiBWindow,
      afterwards: gzipSync(Buffer.from("still works")),
    };
    const encodings: Record<string, string> = {
      "br-large-window": "br",
      "zstd-large-window": "zstd",
      afterwards: "gzip",
    };

    const results = await runCapped(
      bodies,
      /* js */ `
        const encodings = ${JSON.stringify(encodings)};
        using server = Bun.serve({
          port: 0,
          fetch(req) {
            const name = new URL(req.url).pathname.slice(1);
            return new Response(inputs[name], { headers: { "Content-Encoding": encodings[name] ?? name } });
          },
        });
        for (const name of Object.keys(inputs)) {
          results[name] = await fetch(new URL(name, server.url))
            .then(res => res.text())
            .then(text => text.length > 64 ? text.length : text, e => ({ name: e.name, code: e.code }));
        }
      `,
    );
    const fetchOutOfMemory = { name: "TypeError", code: "OutOfMemory" };
    expect(results).toEqual({
      gzip: fetchOutOfMemory,
      deflate: fetchOutOfMemory,
      br: fetchOutOfMemory,
      zstd: fetchOutOfMemory,
      "br-large-window": fetchOutOfMemory,
      "zstd-large-window": fetchOutOfMemory,
      afterwards: "still works",
    });
  });

  it.concurrent("DecompressionStream", async () => {
    // A stream's own output is produced in small chunks, so only the codecs' window allocations can
    // fail here; the default-window brotli stream decompresses all 12 MiB to prove that.
    const zeros = Buffer.alloc(12 * MiB);
    const streams = {
      brotli: zlib.brotliCompressSync(zeros, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } }),
      brotliLargeWindow: brotliWith16MiBWindow(zeros),
      zstdLargeWindow: emptyFrameWith16MiBWindow,
    };

    const results = await runCapped(
      streams,
      /* js */ `
        const decompressedLength = async (bytes, format) => {
          let length = 0;
          for await (const chunk of new Response(bytes).body.pipeThrough(new DecompressionStream(format))) {
            length += chunk.length;
          }
          return length;
        };
        for (const [name, bytes] of Object.entries(inputs)) {
          results[name] = await decompressedLength(bytes, name.startsWith("brotli") ? "brotli" : "zstd").catch(describeError);
        }
        results.afterwards = await decompressedLength(inputs.brotli, "brotli");
      `,
    );
    expect(results).toEqual({
      brotli: 12 * MiB,
      brotliLargeWindow: outOfMemory,
      zstdLargeWindow: outOfMemory,
      afterwards: 12 * MiB,
    });
  });
});

describe("sync compression argument handling", () => {
  it("zstdCompressSync evaluates the options object before capturing the input", () => {
    const input = new Uint8Array(64).fill(97);
    const compressed = zstdCompressSync(input, {
      get level() {
        input.buffer.transfer();
        return 3;
      },
    });
    expect(zstdDecompressSync(compressed).byteLength).toBe(0);
  });

  it("zstdCompressSync refuses an input that is not bytes before it evaluates the options object", () => {
    expect(() =>
      zstdCompressSync(42 as any, {
        get level(): never {
          throw new Error("level option was read");
        },
      }),
    ).toThrow("data must be a string, ArrayBuffer or ArrayBufferView");
  });

  it("gzipSync evaluates the options object before capturing the input", () => {
    const input = new Uint8Array(64).fill(97);
    const compressed = gzipSync(input, {
      get level(): 6 {
        input.buffer.transfer();
        return 6;
      },
    });
    expect(gunzipSync(compressed).byteLength).toBe(0);
  });

  it("deflateSync evaluates the options object before capturing the input", () => {
    const input = new Uint8Array(64).fill(97);
    const compressed = deflateSync(input, {
      get level(): 6 {
        input.buffer.transfer();
        return 6;
      },
    });
    expect(inflateSync(compressed).byteLength).toBe(0);
  });

  it("gunzipSync refuses an input that is not bytes before it evaluates the options object", () => {
    expect(() =>
      gunzipSync(42 as any, {
        get windowBits(): never {
          throw new Error("windowBits option was read");
        },
      }),
    ).toThrow("data must be a string, ArrayBuffer or ArrayBufferView");
  });

  it("inflateSync refuses an input that is not bytes before it evaluates the options object", () => {
    expect(() =>
      inflateSync(42 as any, {
        get windowBits(): never {
          throw new Error("windowBits option was read");
        },
      }),
    ).toThrow("data must be a string, ArrayBuffer or ArrayBufferView");
  });

  it("a numeric option is converted to a number, and then treated as that number is", () => {
    const input = "hello hello hello";
    const beyond32Bits = [
      2 ** 32 + 1,
      "4294967297",
      4294967297n,
      2n ** 64n + 1n,
      { valueOf: () => 2 ** 32 + 1 },
      "Infinity",
    ];
    for (const [compress, outOfRange] of [
      [gzipSync, "Zlib error: Invalid argument"],
      [deflateSync, "Zlib error: Invalid argument"],
      [zstdCompressSync, "Compression level must be between 1 and 22"],
    ] as [(data: string, options: any) => Uint8Array, string][]) {
      const expected = compress(input, { level: 1 });
      for (const level of ["1", 1n, Object(1n), [1], { valueOf: () => 1 }, { valueOf: () => 1n }]) {
        expect(compress(input, { level })).toEqual(expected);
      }
      for (const level of beyond32Bits) expect(() => compress(input, { level })).toThrow(outOfRange);
    }
    for (const [decompress, compressed, bits] of [
      [gunzipSync, gzipSync(input), 31],
      [inflateSync, deflateSync(input), -15],
    ] as [(data: Uint8Array, options: any) => Uint8Array, Uint8Array, number][]) {
      for (const windowBits of [bits, String(bits), BigInt(bits), { valueOf: () => bits }]) {
        expect(new TextDecoder().decode(decompress(compressed, { windowBits }))).toBe(input);
      }
      for (const windowBits of beyond32Bits) {
        expect(() => decompress(compressed, { windowBits })).toThrow("Zlib error: Invalid argument");
      }
    }
  });

  it("zstdCompress and zstdCompressSync take the same levels", async () => {
    const input = "hello hello hello";
    for (const level of [undefined, 1, 22, "1", 1n, Object(1n), { valueOf: () => 1 }]) {
      expect(await zstdCompress(input, { level } as any)).toEqual(zstdCompressSync(input, { level } as any));
    }
    for (const level of [0, 23, NaN, 2 ** 32 + 1, "4294967297", 4294967297n, { valueOf: () => 2 ** 32 + 1 }]) {
      for (const compress of [zstdCompress, zstdCompressSync]) {
        expect(() => compress(input, { level } as any)).toThrow("Compression level must be between 1 and 22");
      }
    }
  });

  it("zstdDecompress and zstdDecompressSync take no options", async () => {
    const compressed = zstdCompressSync("hello");
    for (const ignored of [undefined, null, 5, "x", {}, { level: 99 }]) {
      expect(
        (
          await (zstdDecompress as (data: Uint8Array, ignored: unknown) => Promise<Buffer>)(compressed, ignored)
        ).toString(),
      ).toBe("hello");
      expect(
        (zstdDecompressSync as (data: Uint8Array, ignored: unknown) => Buffer)(compressed, ignored).toString(),
      ).toBe("hello");
    }
  });

  it("takes the bytes of every kind of buffer, and a string as UTF-8", () => {
    const text = "h\u00e9llo w\u00f6rld, \u65e5\u672c\u8a9e!";
    const bytes = new TextEncoder().encode(text);
    const shared = new Uint8Array(new SharedArrayBuffer(bytes.length));
    shared.set(bytes);
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 4);
    const inputs = [
      text,
      new String(text),
      bytes,
      bytes.buffer,
      Buffer.from(bytes),
      new DataView(bytes.buffer),
      padded.subarray(4, 4 + bytes.length),
      shared,
      shared.buffer,
    ];
    for (const [compress, decompress] of [
      [gzipSync, gunzipSync],
      [deflateSync, inflateSync],
      [zstdCompressSync, zstdDecompressSync],
    ] as ((data: any) => Uint8Array)[][]) {
      const expected = compress(text);
      for (const input of inputs) expect(compress(input)).toEqual(expected);
      const sharedCompressed = new Uint8Array(new SharedArrayBuffer(expected.length));
      sharedCompressed.set(expected);
      for (const compressed of [expected, sharedCompressed, new DataView(expected.slice().buffer)]) {
        expect(new TextDecoder().decode(decompress(compressed))).toBe(text);
      }
    }
  });

  // An empty result must not register a GC-time deallocator: the backing Vec is
  // empty, so its pointer is dangling and freeing it at collection is an invalid
  // free (aborts under ASAN/debug allocators).
  it("collecting empty decompression results does not free a dangling pointer", () => {
    const empty = new Uint8Array(0);
    for (let i = 0; i < 10; i++) {
      expect(gunzipSync(gzipSync(empty)).byteLength).toBe(0);
      expect(inflateSync(deflateSync(empty)).byteLength).toBe(0);
      expect(zstdDecompressSync(zstdCompressSync(empty)).byteLength).toBe(0);
      Bun.gc(true);
    }
  });

  // libdeflate is one-shot, so Bun retries with a doubling output buffer; the
  // retry cap must not be tighter than the zlib backend's (ArrayBuffer max).
  // Spawned so the multi-GB buffer is released with the child.
  it("gunzipSync({library:'libdeflate'}) decompresses output larger than 1 GiB", async () => {
    const MiB = 1024 * 1024;
    const expected = 17 * 64 * MiB; // 1088 MiB
    const script = `
      import * as zlib from "node:zlib";
      const chunk = Buffer.alloc(64 * ${MiB});
      const bomb = await new Promise((resolve, reject) => {
        const g = zlib.createGzip({ level: 9 });
        const out = [];
        g.on("data", c => out.push(c));
        g.on("end", () => resolve(Buffer.concat(out)));
        g.on("error", reject);
        let left = 17;
        const w = () => { if (!left--) return g.end(); g.write(chunk) ? w() : g.once("drain", w); };
        w();
      });
      const out = Bun.gunzipSync(bomb, { library: "libdeflate" });
      console.log(JSON.stringify({ libdeflate: out.length, head: out[0], tail: out[out.length - 1] }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({
      stdout: JSON.stringify({ libdeflate: expected, head: 0, tail: 0 }),
      stderr: expect.not.stringContaining("Out of memory"),
    });
    expect(exitCode).toBe(0);
  }, 60_000);
});

// CPUID is a VM exit under a hypervisor, about 2 us each. The C library once asked it twice in every
// CCtx and DCtx init. arch_prctl(ARCH_SET_CPUID, 0) makes CPUID raise SIGSEGV on the calling thread,
// so a context that probes the CPU kills the child. The first round trip loads what else may probe.
describe("zstd context setup", () => {
  const canFaultOnCpuid =
    isLinux && process.arch === "x64" && /^flags\s*:.*\bcpuid_fault\b/m.test(readFileSync("/proc/cpuinfo", "utf8"));

  it.skipIf(!canFaultOnCpuid)("does not ask CPUID", async () => {
    const script = `
      const { dlopen } = require("bun:ffi");
      const zlib = require("node:zlib");
      const { symbols: { syscall } } = dlopen(process.argv[1], {
        syscall: { args: ["i64", "i32", "u64"], returns: "i64" },
      });
      const SYS_arch_prctl = 158n, ARCH_SET_CPUID = 0x1012;
      const input = Buffer.alloc(1024, "a");
      function roundtrip() {
        const native = Bun.zstdDecompressSync(Bun.zstdCompressSync(input));
        const node = zlib.zstdDecompressSync(zlib.zstdCompressSync(input));
        if (!input.equals(native) || !input.equals(node)) throw new Error("roundtrip mismatch");
      }
      roundtrip();
      if (syscall(SYS_arch_prctl, ARCH_SET_CPUID, 0n) !== 0n) throw new Error("ARCH_SET_CPUID failed");
      for (let i = 0; i < 20; i++) roundtrip();
      syscall(SYS_arch_prctl, ARCH_SET_CPUID, 1n);
      console.log("ok");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script, libcPathForDlopen()],
      // JSC runs CPUID as a serializing instruction each time it installs JIT code.
      env: { ...bunEnv, BUN_JSC_useBaselineJIT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr: stderr.slice(0, 2000) }).toEqual({ stdout: "ok\n", stderr: "" });
    expect(exitCode).toBe(0);
  });
});

// The async functions read the input on a pool thread. The unfixed build segfaults there, so each
// case runs in a child process: it compares the result against a fixed-length input's result.
describe.concurrent("async compression of a resizable ArrayBuffer that shrinks after the call", () => {
  async function runInChild(script: string, expectedStdout: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(expectedStdout);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }

  it("zstdCompress reads the bytes the caller passed", async () => {
    await runInChild(
      /* js */ `
      const fixed = Buffer.alloc(256 * 1024, 0x41);
      const expected = Buffer.from(Bun.zstdCompressSync(fixed)).toString("hex");
      let wrong = 0;
      for (let i = 0; i < 20; i++) {
        const ab = new ArrayBuffer(fixed.byteLength, { maxByteLength: 1 << 21 });
        new Uint8Array(ab).fill(0x41);
        const promise = Bun.zstdCompress(new Uint8Array(ab));
        ab.resize(0);
        if (Buffer.from(await promise).toString("hex") !== expected) wrong++;
      }
      console.log("wrong:", wrong);
    `,
      "wrong: 0\n",
    );
  });

  it("zstdDecompress reads the bytes the caller passed", async () => {
    await runInChild(
      /* js */ `
      const fixed = Buffer.from(Bun.zstdCompressSync(Buffer.alloc(256 * 1024, 0x41)));
      const expected = Buffer.from(Bun.zstdDecompressSync(fixed)).toString("hex");
      let wrong = 0;
      for (let i = 0; i < 20; i++) {
        const ab = new ArrayBuffer(fixed.byteLength, { maxByteLength: 1 << 21 });
        new Uint8Array(ab).set(fixed);
        const promise = Bun.zstdDecompress(new Uint8Array(ab));
        ab.resize(0);
        if (Buffer.from(await promise).toString("hex") !== expected) wrong++;
      }
      console.log("wrong:", wrong);
    `,
      "wrong: 0\n",
    );
  });

  it("a growable SharedArrayBuffer stays a borrow and compresses the same bytes", async () => {
    await runInChild(
      /* js */ `
      const fixed = Buffer.alloc(256 * 1024, 0x41);
      const expected = Buffer.from(Bun.zstdCompressSync(fixed)).toString("hex");
      const sab = new SharedArrayBuffer(fixed.byteLength, { maxByteLength: 1 << 21 });
      new Uint8Array(sab).fill(0x41);
      const promise = Bun.zstdCompress(new Uint8Array(sab, 0, fixed.byteLength));
      sab.grow(1 << 21);
      console.log(Buffer.from(await promise).toString("hex") === expected ? "same" : "different");
    `,
      "same\n",
    );
  });
});

describe.concurrent("Zstandard HTTP compression", () => {
  // Sample data for HTTP tests
  const testData = {
    text: "This is a test string for zstd HTTP compression tests. Repeating content to improve compression: This is a test string for zstd HTTP compression tests.",
    json: { id: 1234, name: "Test Object", values: [1, 2, 3, 4, 5], nested: { prop1: "value1", prop2: "value2" } },
    binary: Buffer.from(
      "d99672ce993fec2d180320aef27f9d05617958e6e67eb2e734cd976034d9301f410ccfca695075f02c5c2969b525a54b7e95ea61797a591daf09a8764800a8d99ad06ba3fcc5c89bd074a47f6a11c1",
      "hex",
    ),
  };

  let server;
  let serverBaseUrl;

  // Start HTTP server that can serve zstd-compressed content
  beforeAll(async () => {
    server = Bun.serve({
      port: 0, // Use a random available port
      async fetch(req) {
        const url = new URL(req.url);
        const acceptEncoding = req.headers.get("Accept-Encoding") || "";
        const supportsZstd = acceptEncoding.includes("zstd");

        // Route: /text
        if (url.pathname === "/text") {
          if (supportsZstd) {
            const compressed = await zstdCompress(testData.text, { level: 3 });
            return new Response(compressed, {
              headers: {
                "Content-Type": "text/plain",
                "Content-Encoding": "zstd",
              },
            });
          }
          return new Response(testData.text, {
            headers: { "Content-Type": "text/plain" },
          });
        }

        // Route: /json
        else if (url.pathname === "/json") {
          const jsonString = JSON.stringify(testData.json);
          if (supportsZstd) {
            const compressed = await zstdCompress(jsonString, { level: 3 });
            return new Response(compressed, {
              headers: {
                "Content-Type": "application/json",
                "Content-Encoding": "zstd",
              },
            });
          }
          return new Response(jsonString, {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Route: /binary
        else if (url.pathname === "/binary") {
          if (supportsZstd) {
            const compressed = await zstdCompress(testData.binary, { level: 3 });
            return new Response(compressed, {
              headers: {
                "Content-Type": "application/octet-stream",
                "Content-Encoding": "zstd",
              },
            });
          }
          return new Response(testData.binary, {
            headers: { "Content-Type": "application/octet-stream" },
          });
        }

        // Route: /echo
        else if (url.pathname === "/echo") {
          // Echo back the request body, with zstd compression if supported
          const body = await req.arrayBuffer();
          if (supportsZstd) {
            const compressed = await zstdCompress(new Uint8Array(body), { level: 3 });
            return new Response(compressed, {
              headers: {
                "Content-Type": req.headers.get("Content-Type") || "application/octet-stream",
                "Content-Encoding": "zstd",
              },
            });
          }
          return new Response(body, {
            headers: { "Content-Type": req.headers.get("Content-Type") || "application/octet-stream" },
          });
        }

        // Default: 404
        return new Response("Not Found", { status: 404 });
      },
    });

    serverBaseUrl = `http://localhost:${server.port}`;
  });

  // Clean up the server after tests
  afterAll(() => {
    server.stop();
  });

  it("can fetch and automatically decompress zstd-encoded text", async () => {
    const response = await fetch(`${serverBaseUrl}/text`, {
      headers: { "Accept-Encoding": "gzip, deflate, br, zstd" },
    });

    expect(response.headers.get("Content-Encoding")).toBe("zstd");
    expect(response.headers.get("Content-Type")).toBe("text/plain");

    const text = await response.text();
    expect(text).toBe(testData.text);
  });

  it("can fetch and automatically decompress zstd-encoded JSON", async () => {
    const response = await fetch(`${serverBaseUrl}/json`, {
      headers: { "Accept-Encoding": "gzip, deflate, br, zstd" },
    });

    expect(response.headers.get("Content-Encoding")).toBe("zstd");
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const json = await response.json();
    expect(json).toEqual(testData.json);
  });

  it("can fetch and automatically decompress zstd-encoded binary data", async () => {
    const response = await fetch(`${serverBaseUrl}/binary`, {
      headers: { "Accept-Encoding": "zstd" },
    });

    expect(response.headers.get("Content-Encoding")).toBe("zstd");
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");

    const buffer = await response.bytes();
    expect(buffer).toStrictEqual(testData.binary);
  });

  it("doesn't use zstd when not in Accept-Encoding", async () => {
    const response = await fetch(`${serverBaseUrl}/text`, {
      headers: { "Accept-Encoding": "gzip, deflate, br" },
    });

    expect(response.headers.get("Content-Encoding")).toBeNull();

    const text = await response.text();
    expect(text).toBe(testData.text);
  });

  it("can POST and receive zstd-compressed echo response", async () => {
    const testString = "Echo this back with zstd compression";

    const response = await fetch(`${serverBaseUrl}/echo`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Accept-Encoding": "zstd",
      },
      body: testString,
    });

    expect(response.headers.get("Content-Encoding")).toBe("zstd");
    const echoed = await response.text();
    expect(echoed).toBe(testString);
  });
});

// The compressor is a port of zstd 1.5.7, and gives the same bytes. The expected values are from the C library.
describe("the output is that of zstd 1.5.7", () => {
  // Words, copies of earlier parts at all distances, noise and runs: something for every part of the compressor.
  function sample(size: number, seed: number) {
    let state = seed >>> 0 || 1;
    const next = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>>= 0);
    };
    const words = [
      "function ",
      "return ",
      "const ",
      "zstd",
      "\n  ",
      "{",
      "}",
      "(",
      ");",
      "await ",
      "=> ",
      "length",
      "0",
    ].map(word => Buffer.from(word));
    // Room for the last piece to overrun.
    const out = new Uint8Array(size + 2048);
    let at = 0;
    while (at < size) {
      const kind = next() % 16;
      if (kind < 7) {
        const word = words[next() % words.length];
        out.set(word, at);
        at += word.length;
      } else if (kind < 11 && at > 8) {
        const distance = 1 + (next() % Math.min(at, 1 << (next() % 20)));
        const length = 3 + (next() % (1 << (next() % 10)));
        if (distance >= length) out.copyWithin(at, at - distance, at - distance + length);
        else for (let i = 0; i < length; i++) out[at + i] = out[at + i - distance];
        at += length;
      } else if (kind < 15) {
        for (let n = 1 + (next() % 24); n > 0; n--) out[at++] = next() >>> (next() % 8 ? 27 : 24);
      } else {
        const length = 1 + (next() % 300);
        out.fill(next(), at, at + length);
        at += length;
      }
    }
    return out.subarray(0, size);
  }
  const digest = (bytes: Uint8Array) => `${bytes.length} ${Bun.hash.xxHash64(bytes).toString(16)}`;
  const c = zlib.constants;
  // More than one job of the least size there is, for the workers.
  const corpus = sample(700_000, 1);
  const large = corpus.subarray(0, 300_000);
  const small = corpus.subarray(300_000, 303_000);

  // Not -1: node:zlib takes that for a parameter that is not set.
  it.each([
    [-100, "167967 45693a3bc89d2838, 2112 a1f04bdd2c75d853"],
    [-7, "65641 25bb487794d2f45f, 1081 6841140ea417de55"],
    [-2, "55329 a7cd8da33a4cce8b, 954 cb3a52b86b5193c7"],
    [1, "46828 2a61d18b13a9df88, 824 3a3b2b799ed70f7b"],
    [2, "45933 2795a6f87171faac, 811 bd7ae68cb7d95862"],
    [3, "45122 344d3c35e5ad0340, 810 e35cec5c3500c856"],
    [4, "45093 7634242fc968e2c3, 822 6b45b45a5d921bfc"],
    [5, "44424 daecc1abec496995, 810 4489026b2c29b8dc"],
    [6, "42948 a879387b2601910d, 809 b15c4cf338e1d77a"],
    [7, "42675 1f9ad80ad0656d09, 804 603c9d665714a2"],
    [8, "42562 26911127c1e54142, 804 603c9d665714a2"],
    [9, "42562 26911127c1e54142, 807 bc69857972f7737c"],
    [10, "42353 d560f70047c278d, 807 bc69857972f7737c"],
    [11, "42124 cc37ec9a45f8d164, 808 95559a23325a524d"],
    [12, "42124 cc37ec9a45f8d164, 806 5984ef401fd2141"],
    [13, "42364 fd1a09c03715fc5f, 807 6648f2fa58a397d4"],
    [14, "42287 87ee023408ff3e30, 807 6648f2fa58a397d4"],
    [15, "42233 109ef580b5685e85, 804 52073852c548e55e"],
    [16, "42522 3293e655be1b0330, 807 6648f2fa58a397d4"],
    [17, "41809 7cb274a8772cd4cc, 806 b609660f6b3d21d9"],
    [18, "41253 d616eadc7ae1a5de, 804 52073852c548e55e"],
    [19, "18189 44c06af9c0a7b97f, 804 52073852c548e55e"],
    [20, "18125 7c0ef33ba30541a2, 804 52073852c548e55e"],
    [21, "18125 7c0ef33ba30541a2, 804 52073852c548e55e"],
    [22, "18125 e1b7fc6756c67456, 804 52073852c548e55e"],
  ])("at level %i", (level, expected) => {
    const compress = (data: Uint8Array) =>
      level > 0
        ? zstdCompressSync(data, { level })
        : zlib.zstdCompressSync(data, { params: { [c.ZSTD_c_compressionLevel]: level } });
    // The highest levels are slow.
    const data = level < 19 ? large : large.subarray(0, 140_000);
    expect(`${digest(compress(data))}, ${digest(compress(small))}`).toBe(expected);
  });

  it("where blocks that are stored are between blocks that are compressed", () => {
    const noise = new Uint8Array(200_000);
    for (let i = 0, x = 9; i < noise.length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      noise[i] = x;
    }
    const data = Buffer.concat([large.subarray(0, 150_000), noise, large.subarray(150_000)]);
    expect([1, 3, 6, 13, 16].map(level => digest(zstdCompressSync(data, { level })))).toEqual([
      "248567 de53cc88abf776bf",
      "245529 c13322b7116144a",
      "245428 8fdcf68c52aa046d",
      "244844 ad91ca42d335a19",
      "244843 e1282705ef659832",
    ]);
  });

  it("with parameters", () => {
    const cases: Record<string, Record<number, number>> = {
      checksum: { [c.ZSTD_c_checksumFlag]: 1 },
      noContentSize: { [c.ZSTD_c_contentSizeFlag]: 0 },
      smallWindow: { [c.ZSTD_c_windowLog]: 12, [c.ZSTD_c_compressionLevel]: 7 },
      hashChain: { [c.ZSTD_c_strategy]: c.ZSTD_lazy2, [c.ZSTD_c_windowLog]: 14, [c.ZSTD_c_searchLog]: 6 },
      rows: { [c.ZSTD_c_strategy]: c.ZSTD_greedy, [c.ZSTD_c_searchLog]: 6, [c.ZSTD_c_minMatch]: 6 },
      binaryTree: { [c.ZSTD_c_strategy]: c.ZSTD_btlazy2, [c.ZSTD_c_chainLog]: 14, [c.ZSTD_c_hashLog]: 13 },
      optimal: { [c.ZSTD_c_strategy]: c.ZSTD_btopt, [c.ZSTD_c_targetLength]: 20, [c.ZSTD_c_minMatch]: 3 },
      longDistance: { [c.ZSTD_c_enableLongDistanceMatching]: 1, [c.ZSTD_c_windowLog]: 20 },
      longDistanceOptimal: {
        [c.ZSTD_c_enableLongDistanceMatching]: 1,
        [c.ZSTD_c_compressionLevel]: 16,
        [c.ZSTD_c_ldmMinMatch]: 16,
        [c.ZSTD_c_ldmHashLog]: 12,
        [c.ZSTD_c_ldmBucketSizeLog]: 2,
        [c.ZSTD_c_ldmHashRateLog]: 3,
      },
      // ZSTD_c_targetCBlockSize
      smallBlocks: { 130: 2000, [c.ZSTD_c_compressionLevel]: 5 },
      // ZSTD_c_format: ZSTD_f_zstd1_magicless
      magicless: { 10: 1 },
      workers: { [c.ZSTD_c_nbWorkers]: 2, [c.ZSTD_c_jobSize]: 1, [c.ZSTD_c_checksumFlag]: 1 },
      workersOverlap: {
        [c.ZSTD_c_nbWorkers]: 3,
        [c.ZSTD_c_jobSize]: 1,
        [c.ZSTD_c_overlapLog]: 9,
        [c.ZSTD_c_windowLog]: 17,
      },
      workersLongDistance: {
        [c.ZSTD_c_nbWorkers]: 2,
        [c.ZSTD_c_jobSize]: 1,
        [c.ZSTD_c_enableLongDistanceMatching]: 1,
        [c.ZSTD_c_windowLog]: 18,
      },
    };
    const results: Record<string, string> = {};
    for (const [name, params] of Object.entries(cases)) {
      const data = name.startsWith("workers") ? corpus : large;
      const compressed = zlib.zstdCompressSync(data, { params });
      results[name] = digest(compressed);
      if (name !== "magicless") expect(zlib.zstdDecompressSync(compressed).equals(data)).toBe(true);
    }
    expect(results).toMatchInlineSnapshot(`
      {
        "binaryTree": "43844 a5c9eabbae2dd756",
        "checksum": "44939 b9750b95ad15111d",
        "hashChain": "48609 ad3f314838cea64",
        "longDistance": "44645 1be0f74f50e4c2f1",
        "longDistanceOptimal": "42035 826bf710d9511423",
        "magicless": "44931 ef5be3a06c229e22",
        "noContentSize": "44932 69582ab759972bd0",
        "optimal": "42193 af8904ce81d257c5",
        "rows": "43948 1c7f2cd5acfbb9eb",
        "smallBlocks": "44603 b857325b812bea9c",
        "smallWindow": "55906 6786884ad22d6b2d",
        "workers": "108770 1df628af1e7dc077",
        "workersLongDistance": "109211 732c0b64dad8574b",
        "workersOverlap": "111826 bfab26c4004f255d",
      }
    `);
  });

  it("where a block is one match, which is too short for the optimal parser to take at once", () => {
    const digests = (data: Buffer, windowLog: number) =>
      [16, 19, 22].map(level => {
        const params = {
          [c.ZSTD_c_compressionLevel]: level,
          [c.ZSTD_c_windowLog]: windowLog,
          [c.ZSTD_c_targetLength]: 4096,
        };
        const compressed = zlib.zstdCompressSync(data, { params });
        expect(zlib.zstdDecompressSync(compressed).equals(data)).toBe(true);
        return digest(compressed);
      });
    const periodic = Buffer.alloc(5_000, corpus.subarray(0, 700));
    expect(digests(periodic, 10)).toEqual(Array(3).fill("163 571cb5ea10428fa7"));
    expect(digests(periodic, 11)).toEqual(Array(3).fill("142 671efcd2063db130"));
    expect(digests(Buffer.alloc(1_000), 10)).toEqual(Array(3).fill("19 bf47b44041ed0aa6"));
  });

  // Short input searches the tables of the dictionary, long input starts from a copy of them.
  function withDictionary(dictionary: Uint8Array) {
    const results: Record<string, string> = {};
    for (const level of [-3, 1, 3, 5, 8, 13, 16, 19]) {
      for (const size of [5_000, 150_000]) {
        const data = corpus.slice(400_000, 400_000 + size);
        data.set(dictionary.subarray(-600, -100), 1_000);
        const options = { dictionary, params: { [c.ZSTD_c_compressionLevel]: level }, pledgedSrcSize: size };
        const compressed = zlib.zstdCompressSync(data, options);
        results[`${level}, ${size}`] = digest(compressed);
        expect(zlib.zstdDecompressSync(compressed, { dictionary }).equals(data)).toBe(true);
      }
    }
    return results;
  }

  it("with a dictionary that is only content", () => {
    expect(withDictionary(sample(20_000, 4))).toMatchInlineSnapshot(`
      {
        "-3, 150000": "31691 a6cba8ed83f78cbe",
        "-3, 5000": "1280 99e5c402823fdcad",
        "1, 150000": "25367 4eed614674d852f5",
        "1, 5000": "1042 c36ace4ccb9d37ab",
        "13, 150000": "23771 c93a9f67de8b8c82",
        "13, 5000": "988 6a7990046fc8b0de",
        "16, 150000": "22992 c47f0966b096f185",
        "16, 5000": "969 3be3d777b3ae4229",
        "19, 150000": "22935 28de114f08f4bd22",
        "19, 5000": "969 552f7abe774fa6ca",
        "3, 150000": "24931 2feb8f5d9e046e54",
        "3, 5000": "1028 6aaf30fe0e09dd18",
        "5, 150000": "24343 c26404163f4b0830",
        "5, 5000": "1002 6cf280704008a5eb",
        "8, 150000": "23534 8b65e660bd8911a6",
        "8, 5000": "973 f42818736cafcdfb",
      }
    `);
  });

  it("with a dictionary that has tables", () => {
    // zstd --train --maxdict=1200, on 400 of these samples.
    const dictionary = Buffer.from(
      "N6Qw7CRPAAA5EKgmaQOIpOamUZ6YaYFWNK4FBYVp7RRHeEwRH2jGgTCmatsY1bd2V0loSVJyU2hzaXNTUlJIUminQwFAaTAYEstI" +
        "FScAAATAhwSXlAeZRmKhICQIhcKgMCAQBgPCgCAYDAaAQWEgGBgOCWRJpPcCAAB0bWcj0zgoEAaDwXAwHA4MszhRamoRAAAAAQAA" +
        "AAQAAAAIAAAACg1jb24XFBxYHlgKYXdhaXQgYXdhaXN0IAMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD" +
        "AwMDAwNubm5ubm5ubm5ubm5ubmxlbmd0aAgCHgZmdW5jdGlvbiBDDgQJFgCsIAMDAwMDAwMDKCgoKCgoPT09PT09PT0MDJMND8YY" +
        "EgAKDAUNt5sCBQoIKN/f39/f39/f39/f39/f3/4aenN0ZHpzdGTBwcHBwcHBwcHBwcEwGwcJCAsfDROdHA8V6gMHGg89PT0wYXdh" +
        "aXQgc3RkCA8MCwcIFhvWenN0ZAgPDAsHCAogIN/f3wkNBBcXBQ4WFRUbDQYbBBACCwILAgsCCwILY29uc3QgcmV0dXJuIGZ1bmN0" +
        "aW9uID09PT09PT09PT09PT09PWF3YWl0IHQgdB4GHg0IBwMpO2F3YWl0ID0+IGZ1bmN0aW9uIGZ1bmN0aW9uIG5ubm5ubm5ubm5u" +
        "bm5ubm5ubm5ubm5ubm5ubm5ubm57BvoUBvoUBvoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICw8PDw8PDw8PD" +
        "w8PDw8PDw8PDw8PDw8PDw8MkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk" +
        "JCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk" +
        "JCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQ9PiBsZW5ndGhoowEX" +
        "ImNvbnN0IB8IHRwHHgIYChUJBAgECAMYEg8bCxwDuQ4dDgYOjY2NC4IWBgcwKKCgoKB7KTswBgccAg8aEwIWDx4dGBUMFA8fCugK" +
        "FxsfCB0cBx4CGAoADgt9ZnVuY3Rpb24gGRgLCBUbHAYaBwgQCxwQBQofGBgAAgMKgbcSHAkIHhwPGRwOcRsoPT4gMGNvbnN0IGZ1" +
        "bmN0aW9uIBQOAiQWEAgUDRwUBBQIGwbP8MQYChIOBBQeHgsNDxALHMUXCBEaBADwxBgKEg4EFB4eCw0PEAscxRcIERoEAPDEGAoS" +
        "DgRhd2FpdCBsZW5ndGhjb25zdCBsZW5ndGhsZW5ndGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGho" +
        "aCh7e3t7e3t7e3t7e3t7e3t7e3t7e3toaGhoaGhoaGhokJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQ",
      "base64",
    );
    expect(withDictionary(dictionary)).toMatchInlineSnapshot(`
      {
        "-3, 150000": "31674 a6f9cb1f5deb45f",
        "-3, 5000": "1255 86e003673a214f0a",
        "1, 150000": "25439 b187159ef67d798f",
        "1, 5000": "967 7ab6c959cbc9173",
        "13, 150000": "23377 807244f3412a1248",
        "13, 5000": "918 51a5e4bbad4678c8",
        "16, 150000": "23360 7e0e03d462f05b47",
        "16, 5000": "918 51a5e4bbad4678c8",
        "19, 150000": "23224 dbc52271327892b3",
        "19, 5000": "916 a6838a535dce670d",
        "3, 150000": "24745 9a4a4d7d66087c52",
        "3, 5000": "942 2f652f811a065d94",
        "5, 150000": "24209 a726791cfb67d565",
        "5, 5000": "926 f64c220e68e0c73c",
        "8, 150000": "24000 7f2abf062f75ff72",
        "8, 5000": "913 b12d4bfdabcdaf2b",
      }
    `);

    const compressed = zlib.zstdCompressSync(small, { dictionary });
    expect(() => zlib.zstdDecompressSync(compressed)).toThrow(
      expect.objectContaining({ code: "ZSTD_error_dictionary_wrong", errno: c.ZSTD_error_dictionary_wrong }),
    );
    const damaged = Buffer.from(dictionary);
    damaged.fill(0xff, 8, 40);
    expect(() => zlib.zstdCompressSync(small, { dictionary: damaged })).toThrow(
      expect.objectContaining({ code: "ZSTD_error_memory_allocation", errno: c.ZSTD_error_memory_allocation }),
    );
  });

  async function stream(params: Record<number, number>, flushes: boolean) {
    const stream = zlib.createZstdCompress({ params });
    const chunks: Buffer[] = [];
    stream.on("data", chunk => chunks.push(chunk));
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    stream.on("end", resolve).on("error", reject);
    stream.on("close", () => reject(new Error("closed before the end")));
    for (let at = 0, n = 1; at < corpus.length; at += n, n = (n * 7) % 90_001) {
      stream.write(corpus.subarray(at, at + n));
      if (flushes && n % 3 === 0) stream.flush();
    }
    stream.end();
    await promise;
    return Buffer.concat(chunks);
  }

  it("in a stream with flushes", async () => {
    const results: Record<string, string> = {};
    for (const level of [1, 6, 12, 17]) {
      results[level] = digest(await stream({ [c.ZSTD_c_compressionLevel]: level }, true));
    }
    expect(results).toMatchInlineSnapshot(`
      {
        "1": "111500 f8b357a7535f4d59",
        "12": "99899 c7c64eb5fefd6b8c",
        "17": "99325 43b1ca1d605f6a2a",
        "6": "101943 73ac52aed8b6fec6",
      }
    `);
  });

  it("in a stream with workers", async () => {
    for (const flushes of [false, true]) {
      const compressed = await stream({ [c.ZSTD_c_nbWorkers]: 1, [c.ZSTD_c_jobSize]: 1 }, flushes);
      expect(zlib.zstdDecompressSync(compressed).equals(corpus)).toBe(true);
    }
  });

  it("in a stream with workers, after others were given up in the middle of a frame", async () => {
    const params = { [c.ZSTD_c_nbWorkers]: 2, [c.ZSTD_c_jobSize]: 1 };
    for (let i = 0; i < 4; i++) {
      const abandoned = zlib.createZstdCompress({ params });
      abandoned.write(corpus);
      abandoned.destroy();
    }
    expect(zlib.zstdDecompressSync(await stream(params, false)).equals(corpus)).toBe(true);
  });

  async function flushed(params: Record<number, number>, sizes: number[]) {
    const stream = zlib.createZstdCompress({ params });
    const chunks: Buffer[] = [];
    stream.on("data", chunk => chunks.push(chunk));
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    stream.on("end", resolve).on("error", reject);
    stream.on("close", () => reject(new Error("closed before the end")));
    let at = 0;
    for (const size of sizes) {
      stream.write(corpus.subarray(at, at + size));
      stream.flush();
      at += size;
    }
    stream.end();
    await promise;
    expect(zlib.zstdDecompressSync(Buffer.concat(chunks)).equals(corpus.subarray(0, at))).toBe(true);
  }

  it("in a stream with workers, where a flush does not cost as much as a whole job", async () => {
    // A job makes room for one long distance match for each ldmMinMatch bytes. For a whole job that is 192 MB here.
    await flushed(
      {
        [c.ZSTD_c_nbWorkers]: 1,
        [c.ZSTD_c_jobSize]: 64 << 20,
        [c.ZSTD_c_enableLongDistanceMatching]: 1,
        [c.ZSTD_c_ldmMinMatch]: 4,
      },
      Array(200).fill(1000),
    );
  });

  it("in a stream with workers, where a larger job than those before does not clear the tables", async () => {
    // The table is 256 MB.
    await flushed(
      { [c.ZSTD_c_nbWorkers]: 4, [c.ZSTD_c_strategy]: c.ZSTD_fast, [c.ZSTD_c_hashLog]: 26 },
      Array.from({ length: 300 }, (_, i) => i + 1),
    );
  });
});

// Frames from `decodecorpus`, zstd's own generator of anything the format allows, most of which no encoder makes, and
// what zstd 1.5.7 makes of each of them, whole and damaged in nine ways, through `node:zlib` and through `Bun`.
describe("frames that no encoder makes decode as with zstd 1.5.7", () => {
  const digest = (output: Uint8Array) => `${output.length} ${Bun.hash.xxHash32(output).toString(16)}`;
  const attempt = (decompress: (input: Buffer) => Uint8Array, input: Buffer) => {
    try {
      return digest(decompress(input));
    } catch (error: any) {
      return error.code.replace("ZSTD_error_", "");
    }
  };
  function* damaged(frame: Buffer) {
    for (let k = 1; k <= 6; k++) {
      const copy = Buffer.from(frame);
      copy[Math.floor((frame.length * k) / 7)] ^= 1 << ((k * 3) % 8);
      yield copy;
    }
    yield frame.subarray(0, Math.floor((frame.length * 3) / 4));
    yield frame.subarray(0, frame.length - 1);
    yield Buffer.concat([frame, Buffer.from([0x28])]);
  }

  it("whole and damaged", () => {
    for (const { frame: base64, results } of frames) {
      const frame = Buffer.from(base64, "base64");
      const actual: string[] = [];
      for (const input of [frame, ...damaged(frame)]) {
        actual.push(attempt(zlib.zstdDecompressSync, input), attempt(Bun.zstdDecompressSync, input));
      }
      expect({ frame: base64, results: actual.join(",") }).toEqual({ frame: base64, results });
    }
  });
});

describe("bugs of zstd 1.5.7", () => {
  // Fixed by facebook/zstd cef5a5611: `windowLog - ldmHashRateLog` wrapped around, which made for a table of 8 GiB.
  it("a hash rate above the window does not make for the largest table of long distance matches", async () => {
    const script = `
      const zlib = require("node:zlib");
      const c = zlib.constants;
      const input = Buffer.alloc(1024, "long distance ");
      const output = zlib.zstdCompressSync(input, {
        params: { [c.ZSTD_c_enableLongDistanceMatching]: 1, [c.ZSTD_c_ldmHashRateLog]: 11 },
      });
      console.log(input.equals(zlib.zstdDecompressSync(output)), process.resourceUsage().maxRSS < 4 * 1024 * 1024);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr: stderr.slice(0, 2000) }).toEqual({ stdout: "true true\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  // Only a streaming decoder checked that. Decoded in one call, such a block could overwrite literals it had yet to read.
  it("a compressed block that makes more than 128 KB is an error", () => {
    const frame = Buffer.from("28b52ffd8050c6ff030040000041424344454647487500008dfb1f7a02540103340000030058", "hex");
    expect(() => zlib.zstdDecompressSync(frame, { chunkSize: 262086 })).toThrow(
      expect.objectContaining({ code: "ZSTD_error_corruption_detected" }),
    );
    expect(() => Bun.zstdDecompressSync(frame)).toThrow(expect.objectContaining({ code: "ERR_ZSTD" }));
  });

  // No decoder checked that. A streaming one keeps little more than the window, and gave whatever was there by then.
  it("an offset beyond the window is an error once a streaming decoder has let go of what it is for", () => {
    // A window of 1 KB, 1 KB each of "a", "b" and "c", then "xyz" and 4 bytes from 1500 bytes back.
    const frame = Buffer.from("28b52ffd00000220006102200062022000635d00001878797a0154030a01df05", "hex");
    expect(() => zlib.zstdDecompressSync(frame)).toThrow(
      expect.objectContaining({ code: "ZSTD_error_corruption_detected" }),
    );
  });

  // With workers, only a frame of one job was checked. Any other came out with the wrong size in its header.
  it.each([-1, 1])("with workers, input that is %i off the pledged size is an error", async difference => {
    const c = zlib.constants;
    const input = Buffer.alloc(3 << 20, "several jobs ");
    const stream = zlib.createZstdCompress({
      pledgedSrcSize: input.length - difference,
      params: { [c.ZSTD_c_nbWorkers]: 2, [c.ZSTD_c_jobSize]: 1 << 20 },
    });
    const { promise, resolve } = Promise.withResolvers();
    stream.on("error", resolve).on("end", resolve).on("close", resolve).resume();
    stream.write(input.subarray(0, 1000));
    stream.end(input.subarray(1000));
    expect(await promise).toMatchObject({ code: "ZSTD_error_srcSize_wrong" });
  });
});

// Bugs that zstd has had, from its history up to October 2026. zstd 1.5.7 has none of them, and what is expected is what
// it gives: they are here because the port does not follow the C code line by line. So Bun 1.4.4 passes them too, but for
// bugs of its own: streams with workers lose their output, and a dictionary that a decoder cannot load goes unnoticed.
describe("bugs that zstd has had", () => {
  const c = zlib.constants;
  const hex = (digits: string) => Buffer.from(digits.replaceAll(" ", ""), "hex");
  const base64 = (text: string) => Buffer.from(text, "base64");
  const repeated = (digits: string, count: number) => Buffer.alloc((digits.length / 2) * count, hex(digits));
  const skippable = (size: number) => {
    const frame = Buffer.alloc(8 + size, 7);
    frame.writeUInt32LE(0x184d2a50, 0);
    frame.writeUInt32LE(size, 4);
    return frame;
  };
  /** xorshift32 */
  function noise(length: number, seed: number, mask = 255) {
    const bytes = Buffer.alloc(length);
    for (let i = 0, x = seed >>> 0; i < length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      bytes[i] = x & mask;
    }
    return bytes;
  }
  function through(stream: zlib.ZstdCompress | zlib.ZstdDecompress, chunks: Iterable<Buffer>, flush = false) {
    const { promise, resolve } = Promise.withResolvers<Buffer | string>();
    const output: Buffer[] = [];
    stream.on("data", chunk => output.push(chunk));
    stream.on("error", (error: any) => resolve(error.code));
    stream.on("end", () => resolve(Buffer.concat(output)));
    stream.on("close", () => resolve("closed"));
    for (const chunk of chunks) {
      stream.write(chunk);
      if (flush) stream.flush();
    }
    stream.end();
    return promise;
  }
  function* pieces(bytes: Buffer, size: number) {
    for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
  }
  const attempt = (decompress: () => Uint8Array) => {
    try {
      return Buffer.from(decompress());
    } catch (error: any) {
      return error.code as string;
    }
  };
  /** By `Bun.zstdDecompressSync`, by `zlib.zstdDecompressSync`, and by a stream that gets little at a time. */
  const decoded = async (frame: Buffer, options?: zlib.ZstdOptions) => [
    attempt(() => Bun.zstdDecompressSync(frame)),
    attempt(() => zlib.zstdDecompressSync(frame, options)),
    await through(zlib.createZstdDecompress(options), pieces(frame, frame.length > 3000 ? 1000 : 1)),
  ];
  const hello = hex("28b52ffd200529000068656c6c6f");
  const corrupt = "ZSTD_error_corruption_detected";

  it.each<[string, Buffer, Buffer | string]>([
    ["an empty compressed block", hex("28b52ffd00001500000000"), ""],
    ["an empty raw block", hex("28b52ffd0000 010000"), ""],
    ["an empty run", hex("28b52ffd0000 030000 09"), ""],
    ["empty blocks between others", hex("28b52ffd0000 180000616263 000000 0200007a 190000646566"), "abcdef"],
    [
      "a run for a first block",
      hex("28b52ffda400001000" + "020010 00".repeat(7) + "030010 00 f13e16e1"),
      Buffer.alloc(1 << 20),
    ],
    ["no sequences, said in 2 bytes", hex("28b52ffd00008500006848656c6c6f20576f726c64210a8000"), "Hello World!\n"],
    ["no sequences", hex("28b52ffd0000 2d0000 1861626300"), "abc"],
    [
      "a compressed block of 128 KB",
      Buffer.concat([hex("28b52ffd0038050010ccff1f"), Buffer.alloc(131068), hex("00")]),
      Buffer.alloc(131068),
    ],
    [
      "copies that go too far at the end of a stream's buffer",
      hex("28b52ffd04004c00001061610100002a800544000008620100002a20045d00000003400000646027b0e00c6762cee0"),
      Buffer.concat([Buffer.alloc(517, "a"), Buffer.alloc(543, "b"), Buffer.from("aaa")]),
    ],
    [
      "sequence sections of 3 and 4 bytes",
      base64("KLUv/SQ8NQEA8IUIwsRwz9fAln5Ma6mLvMW22X9M8QWmVO+saZSJHANECgcAtASAQAqk"),
      hex("8508c2c470cfd7c0967e".repeat(2) + "4c6ba98bbcc5b6d97f4c".repeat(2) + "f105a654efac6994891c".repeat(2)),
    ],
    [
      "skippable frames before, between and after frames",
      hex("502a4d1803000000010203 28b52ffd0000190000616263 5f2a4d1800000000 28b52ffd0000190000646566"),
      "abcdef",
    ],
    ["a skippable frame longer than any buffer", Buffer.concat([skippable(200_000), hello]), "hello"],
    ["a window of 128 MB", hex("28b52ffd0088190000616263"), "abc"],
    ["a match for the byte before", hex("28b52ffd8000040000004d00001c0000610150010040"), "aaaa"],
    ["a match that overlaps itself", hex("28b52ffd80000c00000045000010616201006d0e0b"), "abababababab"],
    [
      "a raw block of the size of the window",
      Buffer.concat([hex("28b52ffd0000 012000"), Buffer.alloc(1024, "A")]),
      Buffer.alloc(1024, "A"),
    ],
  ])("%s is decoded", async (_, frame, content) => {
    const expected = Buffer.from(content);
    expect(await decoded(frame)).toEqual([expected, expected, expected]);
  });

  it.each<[string, Buffer, string]>([
    ["an offset of 0", hex("28b52ffd0000450000080002002f430bae"), corrupt],
    ["a repeat offset that comes to 0", hex("28b52ffd000040000061626364656667683d000000015400010003"), corrupt],
    ["a Huffman state that is cut short", hex("28b52ffd000055000072800104207e1f02aa00"), corrupt],
    [
      "bytes after no sequences, said in 2 bytes",
      hex("28b52ffd00009500006848656c6c6f20576f726c64210a80000000"),
      corrupt,
    ],
    ["a byte after no sequences", hex("28b52ffd0000 350000 186162630000"), corrupt],
    ["less content than the header says", hex("28b52ffd200629000068656c6c6f"), corrupt],
    ["more content than the header says", hex("28b52ffd200429000068656c6c6f"), corrupt],
    [
      "a raw block larger than the window",
      Buffer.concat([hex("28b52ffd0000 092000"), Buffer.alloc(1025, "A")]),
      corrupt,
    ],
    [
      "the Huffman table of the block before, in the first",
      hex("28b52ffd0000350000434000000000"),
      "ZSTD_error_dictionary_corrupted",
    ],
    ["a window of 256 MB", hex("28b52ffd0090190000616263"), "ZSTD_error_frameParameter_windowTooLarge"],
    ["the reserved bit", hex("28b52ffd0800190000616263"), "ZSTD_error_frameParameter_unsupported"],
    ["the reserved bit of a frame in one segment", hex("28b52ffd2800010000"), "ZSTD_error_frameParameter_unsupported"],
    ["the largest window there is a code for", hex("28b52ffd00ff010000"), "ZSTD_error_frameParameter_windowTooLarge"],
    ["the sequence tables of the block before, in the first", hex("28b52ffd8000040000002d0000086101fc01"), corrupt],
    ["a literal length code of 36", hex("28b52ffd800004000000350000086101402401"), corrupt],
    ["an offset code of 32", hex("28b52ffd800004000000350000086101102001"), corrupt],
    ["a match length code of 53", hex("28b52ffd800004000000350000086101043501"), corrupt],
    [
      "4 streams for 5 literals",
      hex("28b52ffd8000050000004d0000568001811100000000"),
      "ZSTD_error_literals_headerWrong",
    ],
    [
      "Huffman weights that add up to more than 2^12",
      hex("28b52ffd80001400000085000042010383cccc01010101010101010100"),
      corrupt,
    ],
    ["the first repeat offset less 1, in the first sequence", hex("28b52ffd800003000000350000000150000181"), corrupt],
    ["an offset of 2 after 1 byte", hex("28b52ffd8000040000003d0000096101440100b9"), corrupt],
    ["a run of literals without its byte", hex("28b52ffd8000280000001d00008d0200"), corrupt],
    ["compressed literals without a table", hex("28b52ffd80002800000025000002000000"), corrupt],
    [
      // CVE-2026-116591 of another decoder, where it got through on top of what the block before had left.
      "Huffman weights with a table of 2^15 states",
      Buffer.concat([
        hex("28b52ffd003874060042b8320d1a00000090affaff030080ff7f"),
        repeated("a594524a29", 37),
        hex("a5941200ad5603eeffdfb31a1c1a00e0ff1f0fb19c5acf4de41d7bab995e0151a473d8b1f3394b67f6ab1aab1aab1a"),
        ...[repeated("8c31c61863", 1365), hex("8c31"), repeated("638c31c618", 1365), hex("632c")],
        ...[repeated("31c618638c", 1365), hex("3146"), repeated("31c618638c", 1365), hex("310600")],
      ]),
      corrupt,
    ],
  ])("%s is an error", async (_, frame, code) => {
    expect(await decoded(frame)).toEqual(["ERR_ZSTD", code, code]);
  });

  it("what follows the last frame is refused or left alone", async () => {
    const abc = Buffer.from("abc");
    const frame = hex("28b52ffd0000190000616263");
    const after = (rest: string) => decoded(Buffer.concat([frame, hex(rest)]));
    expect(await after("ff")).toEqual(["ERR_ZSTD", abc, "ZSTD_error_prefix_unknown"]);
    expect(await after("502a4d18ffffffff")).toEqual(["ERR_ZSTD", abc, abc]);
    // 8 more than that wraps around.
    expect(await decoded(hex("502a4d18f8ffffff"))).toEqual(["ERR_ZSTD", Buffer.alloc(0), Buffer.alloc(0)]);
  });

  it("what no frame starts with is refused before there are 4 bytes of it", async () => {
    const after = async (first: string) => {
      const stream = zlib.createZstdDecompress();
      const { promise, resolve } = Promise.withResolvers<string>();
      stream.on("error", (error: any) => resolve(error.code));
      stream.write(hex(first), error => resolve((error as any)?.code ?? "more"));
      try {
        return await promise;
      } finally {
        stream.destroy();
      }
    };
    expect(await Promise.all(["28", "28b52f", "50", "5f2a4d"].map(after))).toEqual(["more", "more", "more", "more"]);
    const unknown = "ZSTD_error_prefix_unknown";
    expect(await Promise.all(["000000", "29", "28b530", "4f2a4d"].map(after))).toEqual(Array(4).fill(unknown));
  });

  it("a first block cannot repeat the tables of the frame that was decoded before it", async () => {
    const text = zlib.zstdCompressSync(noise(20_000, 18, 15));
    for (const [frame, code] of [
      [hex("28b52ffd800008000000350000834000010100"), "ZSTD_error_dictionary_corrupted"],
      [hex("28b52ffd8000040000002d0000086101fc01"), corrupt],
    ] as const) {
      expect(Bun.zstdDecompressSync(text).length).toBe(20_000);
      expect(zlib.zstdDecompressSync(text).length).toBe(20_000);
      expect(await decoded(frame)).toEqual(["ERR_ZSTD", code, code]);
      expect(await through(zlib.createZstdDecompress(), [text, frame])).toBe(code);
    }
  });

  it.each([1000, 1017, 1023, 1024])(
    "offsets up to the window are decoded after a stream's buffer has wrapped around: %i",
    async distance => {
      const input = Buffer.alloc(100_000, noise(distance, distance));
      for (const level of [5, 13, 19]) {
        const params = { [c.ZSTD_c_windowLog]: 10, [c.ZSTD_c_compressionLevel]: level };
        const frame = zlib.zstdCompressSync(input, { params });
        expect(frame.length).toBeLessThan(5000);
        expect(await through(zlib.createZstdDecompress(), pieces(frame, 1))).toEqual(input);
        expect(await through(zlib.createZstdDecompress(), [frame])).toEqual(input);
      }
    },
  );

  it("a larger window is decoded if allowed", async () => {
    const [, sync, streamed] = await decoded(hex("28b52ffd0090190000616263"), {
      params: { [c.ZSTD_d_windowLogMax]: 28 },
    });
    expect([sync, streamed]).toEqual([Buffer.from("abc"), Buffer.from("abc")]);
  });

  it("each bit of the checksum counts", async () => {
    const frame = zlib.zstdCompressSync(noise(3000, 1, 15), { params: { [c.ZSTD_c_checksumFlag]: 1 } });
    for (let bit = 0; bit < 32; bit++) {
      const damaged = Buffer.from(frame);
      damaged[frame.length - 4 + (bit >> 3)] ^= 1 << (bit & 7);
      expect(attempt(() => zlib.zstdDecompressSync(damaged))).toBe("ZSTD_error_checksum_wrong");
    }
  });

  it("a raw block comes out as it comes in", async () => {
    const content = noise(100_000, 2);
    const frame = zlib.zstdCompressSync(content);
    const stream = zlib.createZstdDecompress();
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    stream.once("data", chunk => resolve(chunk.length)).on("error", reject);
    stream.on("close", () => reject(new Error("closed before any data")));
    stream.write(frame.subarray(0, 5000), () => stream.flush());
    expect(await promise).toBeWithin(4000, 5000);
    stream.destroy();
  });

  const roundTrip = (input: Buffer, params: Record<number, number>, dictionary?: Buffer) => {
    const frame = zlib.zstdCompressSync(input, { params, dictionary });
    expect(zlib.zstdDecompressSync(frame, { dictionary }).equals(input)).toBe(true);
    return frame;
  };
  const levels = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  // facebook/zstd#3517
  it("a block is split where 64 KB of literals come before a repeat offset", () => {
    const input = noise(256 << 10, 2654435761, 127);
    noise(32 << 10, 0xcafebabe, 3).copy(input);
    const put = (at: number, values: number[]) => {
      for (const skip of [0, 4]) values.forEach((value, i) => input.writeUInt32LE(value, (at + skip + i) * 4));
    };
    put(8 << 10, [0xffffffff, 0xeeeeeeee]);
    put((24 << 10) + 2, [0xdddddddd, 0xcccccccc]);
    put(32 << 10, [0xbbbbbbbb, 0xaaaaaaaa]);
    expect(roundTrip(input, { [c.ZSTD_c_compressionLevel]: 19, [c.ZSTD_c_minMatch]: 7 }).length).toBe(210649);
  });

  // facebook/zstd#3212
  const ZSTD_c_targetCBlockSize = 130;
  it("literals and matches of more than 64 KB go in blocks of a target size", () => {
    const input = Buffer.alloc(270_000);
    noise(70_000, 12345, 127).copy(input);
    for (let i = 70_000; i < 200_000; i++) input[i] = input[i - 1000];
    noise(70_000, 777, 127).copy(input, 200_000);
    for (const level of [1, 3, 7, 19]) {
      roundTrip(input, { [c.ZSTD_c_compressionLevel]: level, [ZSTD_c_targetCBlockSize]: 1340 });
    }
  });

  it("runs are coded as runs, but for the first block", () => {
    const twoRuns = Buffer.concat([Buffer.alloc((256 << 10) - 2, "B"), Buffer.alloc(100 << 10, "A")]);
    expect(Buffer.from(Bun.zstdCompressSync(twoRuns, { level: 1 })).toString("hex")).toBe(
      "28b52ffda0fe8f05005400001042420100fbff39c0025c0000184241410100faff391002f37f0c41",
    );
    const runs = "02001000".repeat(6) + "03120a00";
    const zeros = (level: number) =>
      Buffer.from(Bun.zstdCompressSync(Buffer.alloc(1_000_000), { level })).toString("hex");
    expect(zeros(1)).toBe("28b52ffd804840420f005400001000000100fbff39c002" + runs);
    expect(zeros(3)).toBe("28b52ffda040420f005400001000000100fbff39c002" + runs);
    expect(zeros(19)).toBe("28b52ffda040420f004c000008000100fcff391002" + runs);
  });

  it("what does not compress is not split", () => {
    const input = noise(256 << 10, 99);
    for (let chunk = 0; chunk < 32; chunk++) {
      for (let i = chunk * 8192; i < (chunk + 1) * 8192; i += 43)
        input[i] = chunk % 2 ? input[i] & 0x80 : input[i] | 0x80;
    }
    for (const level of [1, 3, 5, 9, 13, 16, 19, 22]) {
      expect(Bun.zstdCompressSync(input, { level }).length).toBe(input.length + 9 + 2 * 3);
    }
  });

  it("literals that Huffman coding makes longer are left as they are", () => {
    const input = base64(
      "KLUv/QRQFQQAZoYeHZByBTMAgCylAQAAAAAQ3rSu67renkkEAACAAACAFgAXABYAPAbsctt3bakp+jCTL8TBUCAMBAHAB/qINH48GBJqFKKYQCuWaqejAYm/HkwYO8iHxTOx0WQulspEBGEVN1ttJot1X2V//vv1OxoLTidSkpxSsxzjcgEBAFsWJDvL4y4=",
    );
    for (const level of levels(1, 22))
      expect(roundTrip(input, { [c.ZSTD_c_compressionLevel]: level }).length).toBe(152);
    expect(Bun.zstdDecompressSync(input).length).toBe(142);
  });

  it("there is no empty block after input of the pledged size", async () => {
    const block = Buffer.alloc(128 << 10, "a");
    const compressed = async (options: zlib.ZstdOptions) =>
      ((await through(zlib.createZstdCompress(options), [block])) as Buffer).toString("hex");
    expect(await compressed({ pledgedSrcSize: block.length })).toBe("28b52ffda0000002005500001061610100fbff39c002");
    expect(await compressed({})).toBe("28b52ffd00585400001061610100fbff39c002010000");
  });

  it("tiny inputs", () => {
    const compressed = (input: string | Buffer, level: number) =>
      Buffer.from(Bun.zstdCompressSync(input, { level })).toString("hex");
    for (const level of [1, 3, 19]) {
      expect(compressed(Buffer.alloc(100), level)).toBe("28b52ffd206445000010000001003f012c");
      expect(compressed("", level)).toBe("28b52ffd2000010000");
      expect(compressed("a", level)).toBe("28b52ffd200109000061");
    }
    const abab = Buffer.alloc(20, "ab");
    expect([1, 3, 19].map(level => compressed(abab, level))).toEqual([
      "28b52ffd20144500001061620100790e0b",
      "28b52ffd20144500001061620100790e0b",
      "28b52ffd20144d0000186162610100cd6e08",
    ]);
    for (const length of levels(0, 40)) {
      for (const input of [Buffer.alloc(length), Buffer.from(levels(1, length)), Buffer.alloc(length, "ab")]) {
        for (const level of [-5, 1, 3, 6, 13, 19, 22]) roundTrip(input, { [c.ZSTD_c_compressionLevel]: level });
      }
    }
  });

  it("127, 128 and 129 sequences", () => {
    const made = (total: number) => {
      let x = 1;
      const next = () => ((x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff), (x >> 16) & 255);
      const bytes = Array.from({ length: 16 }, next);
      while (bytes.length < total) {
        const distance = 4 + (next() % 9);
        for (let i = 0; i < 3; i++) bytes.push(bytes.at(-distance)!);
        const byte = next();
        bytes.push(byte === bytes.at(-distance) ? (byte + 1) & 255 : byte);
      }
      const frame = roundTrip(Buffer.from(bytes), { [c.ZSTD_c_compressionLevel]: 19 });
      return `${frame.length} ${Bun.hash.xxHash64(frame).toString(16)}`;
    };
    expect([532, 536, 540].map(made)).toEqual(["237 675545151ba98499", "239 18edd3092b7b0659", "241 bf78b419d4d9bdc1"]);
  });

  it("literals and matches of about 64 KB", () => {
    for (const literals of [65_535, 65_536, 65_537]) {
      for (const match of [65_538, 65_539]) {
        const input = Buffer.concat([
          noise(literals + 10, literals),
          noise(literals + 10, literals).subarray(0, match),
        ]);
        for (const level of [1, 3, 9, 19]) roundTrip(input, { [c.ZSTD_c_compressionLevel]: level });
      }
    }
  });

  it("level 0 is level 3", () => {
    const input = noise(20_000, 3, 7);
    expect(roundTrip(input, { [c.ZSTD_c_compressionLevel]: 0 })).toEqual(
      roundTrip(input, { [c.ZSTD_c_compressionLevel]: 3 }),
    );
  });

  it("the size of the output buffer does not show", () => {
    for (const input of [Buffer.alloc(0), Buffer.from("a"), noise(200, 4, 7), noise(5000, 5, 7), noise(5000, 6)]) {
      for (const level of [1, 3, 9, 19]) {
        const params = { [c.ZSTD_c_compressionLevel]: level };
        expect(zlib.zstdCompressSync(input, { params, chunkSize: 64 })).toEqual(roundTrip(input, params));
      }
    }
  });

  it("a match for the first position is found alike in one call and in a stream", () => {
    const input = Buffer.from([...levels(0, 19), ...levels(0, 9)]);
    for (const level of levels(1, 19)) {
      expect(Buffer.from(Bun.zstdCompressSync(input, { level }))).toEqual(
        roundTrip(input, { [c.ZSTD_c_compressionLevel]: level }),
      );
    }
  });

  it("the first block that counts comes after blocks too small to", async () => {
    const input = noise(5000, 7, 15);
    const stream = zlib.createZstdCompress({
      pledgedSrcSize: input.length,
      params: { [c.ZSTD_c_compressionLevel]: 22 },
    });
    const cuts = [0, 4, 9, 20, input.length];
    const chunks = cuts.slice(1).map((to, i) => input.subarray(cuts[i], to));
    expect(zlib.zstdDecompressSync((await through(stream, chunks, true)) as Buffer)).toEqual(input);
  });

  it("raw blocks between compressed ones", () => {
    const input = Buffer.concat(levels(1, 3).flatMap(i => [noise(128 << 10, i, 7), noise(128 << 10, i + 10)]));
    for (const level of [1, 3, 9, 19]) roundTrip(input, { [c.ZSTD_c_compressionLevel]: level });
  });

  it("a block of literals with a match for its last bytes", () => {
    const input = noise(128 << 10, 19);
    input.copy(input, input.length - 16, 1000, 1016);
    for (const level of [16, 19, 22])
      expect(roundTrip(input, { [c.ZSTD_c_compressionLevel]: level }).length).toBe(131084);
  });

  it("less input than the shortest long distance match", async () => {
    const params = { [c.ZSTD_c_enableLongDistanceMatching]: 1, [c.ZSTD_c_ldmMinMatch]: 4096 };
    const frames = [0, 1, 7, 63, 64, 4095].flatMap(length =>
      [3, 19].map(level => roundTrip(noise(length, 21, 3), { ...params, [c.ZSTD_c_compressionLevel]: level })),
    );
    expect(Bun.MD5.hash(Buffer.concat(frames), "hex")).toStartWith("033266ef");

    const input = noise(300, 22, 3);
    const frame = (await through(zlib.createZstdCompress({ params }), pieces(input, 5), true)) as Buffer;
    expect(`${frame.length} ${Bun.MD5.hash(frame, "hex").slice(0, 8)}`).toBe("504 1f230d95");
    expect(zlib.zstdDecompressSync(frame)).toEqual(input);
  });

  it("the least and the most that parameters can be", () => {
    const taken = (parameter: number, values: number[]) =>
      values.filter(value => typeof attempt(() => roundTrip(hello, { [parameter]: value })) !== "string");
    expect(taken(c.ZSTD_c_compressionLevel, [-200_000, -131_073, -131_072, 22, 23, 200_000])).toBeArrayOfSize(6);
    expect(taken(c.ZSTD_c_windowLog, [9, 10, 31, 32])).toEqual([10, 31]);
    expect(taken(c.ZSTD_c_enableLongDistanceMatching, [0, 1, 2, 3])).toEqual([0, 1, 2]);
    expect(taken(c.ZSTD_c_ldmHashLog, [5, 6, 30, 31])).toEqual([6, 30]);
    expect(taken(c.ZSTD_c_ldmMinMatch, [3, 4, 4096, 4097])).toEqual([4, 4096]);
    expect(taken(c.ZSTD_c_ldmBucketSizeLog, [0, 1, 8, 9])).toEqual([0, 1, 8]);
    expect(taken(c.ZSTD_c_ldmHashRateLog, [0, 25, 26])).toEqual([0, 25]);
  });

  describe("dictionaries", () => {
    // `tests/dict-files/zero-weight-dict`
    const zeroWeights = base64(
      "N6Qw7P8g/wA2EBsBAS69U+gVvLDIxkg0+R20Td9JXrqkGW5ZfDAqCkIVpJJ/1SYRHsHu2M4pkpKSkpKSkjIF0wIgDAoHxYOiAYE+uwUEIMKpoI4m1OVZksMoCiFkjDGEECAAAEAAQGREAAAAABRwrVMUAAAATCGEjEHGDM3IDAAAAAEAAAAEAAAACAAAACAgjibU5VmSwygK",
    );

    it("whose Huffman table has symbols of weight 0", () => {
      const skewed = noise(5000, 8).map((byte, i, all) => Math.min(byte, all[(i + 1) % all.length]));
      for (const level of levels(1, 22)) {
        for (const input of [zeroWeights, Buffer.from("0000000000000000000000000\n"), Buffer.from(skewed)]) {
          roundTrip(input, { [c.ZSTD_c_compressionLevel]: level }, zeroWeights);
        }
      }
    });

    // A compressor only looks at its dictionary when it starts, and has one error for all that can go wrong with it.
    const refused = ["ZSTD_error_memory_allocation", "ERR_ZLIB_INITIALIZATION_FAILED"];
    const taken = (dictionary: Buffer) =>
      [
        attempt(() => zlib.zstdCompressSync("hello", { dictionary })),
        attempt(() => zlib.zstdDecompressSync(hello, { dictionary })),
      ].map(result => (typeof result === "string" ? result : "ok"));

    it("whose repeat offsets reach no further than their content", () => {
      const withOffset = (offset: number, at: number) => {
        const dictionary = Buffer.from(zeroWeights);
        dictionary.writeUInt32LE(offset, at);
        return taken(dictionary);
      };
      for (const at of [130, 134, 138]) {
        expect([withOffset(11, at), withOffset(12, at), withOffset(0, at)]).toEqual([["ok", "ok"], refused, refused]);
      }
    });

    it("that are short", () => {
      const input = noise(300, 9, 7);
      const plain = zlib.zstdCompressSync(input);
      for (const length of levels(1, 20)) {
        const raw = noise(length, length, 7);
        const frame = roundTrip(input, {}, raw);
        if (length < 8) expect(frame).toEqual(plain);
        // With the magic number, 8 bytes and more have to be a whole dictionary.
        hex("37a430ec").copy(raw);
        expect(taken(raw)).toEqual(length < 8 ? ["ok", "ok"] : refused);
      }
    });

    it("that do not make the window of a stream of unknown size smaller", async () => {
      const chunks = [Buffer.from("abc"), Buffer.from("def")];
      const start = async (options: zlib.ZstdOptions) =>
        ((await through(zlib.createZstdCompress(options), chunks)) as Buffer).toString("hex", 0, 6);
      const dictionary = noise(1000, 20, 7);
      expect(await start({ dictionary })).toBe("28b52ffd0058");
      expect(await start({ dictionary, pledgedSrcSize: 6 })).toBe("28b52ffd2006");
    });

    it("of which the tables have no room for all", () => {
      const dictionary = noise(17 << 20, 24, 15);
      const params = { [c.ZSTD_c_compressionLevel]: 1 };
      expect(roundTrip(dictionary.subarray(0, 10240), params, dictionary).length).toBe(5154);
      expect(roundTrip(dictionary.subarray(-10240), params, dictionary).length).toBe(19);
    });

    it("that leave the window", async () => {
      const dictionary = noise(10240, 10, 15);
      const input = Buffer.alloc(10240);
      for (let i = 0, x = 11; i < input.length; x = (x * 1103515245 + 12345) >>> 0) {
        const length = 4 + ((x >>> 8) % 57);
        const distance = [7, 300, 1000][(x >>> 16) % 3];
        const from = (x >>> 4) % (dictionary.length - 64);
        for (let k = 0; k < length && i < input.length; k++, i++) {
          input[i] =
            x % 5 === 0
              ? (x >>> (k % 24)) & 15
              : x % 5 === 1 || i < distance
                ? dictionary[from + k]
                : input[i - distance];
        }
      }
      for (const strategy of levels(1, 9)) {
        const params = { [c.ZSTD_c_windowLog]: 10, [c.ZSTD_c_strategy]: strategy, [c.ZSTD_c_checksumFlag]: 1 };
        const frame = (await through(zlib.createZstdCompress({ dictionary, params }), pieces(input, 512))) as Buffer;
        const decoder = zlib.createZstdDecompress({ dictionary, params: { [c.ZSTD_d_windowLogMax]: 10 } });
        expect(await through(decoder, pieces(frame, 100))).toEqual(input);
      }
    });
  });

  describe("workers", () => {
    it("whose overlap starts like a dictionary", async () => {
      const input = noise(5 << 20, 12, 7);
      for (const job of levels(1, 4)) hex("37a430ec").copy(input, (job << 20) - (1 << 14));
      const params = {
        [c.ZSTD_c_nbWorkers]: 2,
        [c.ZSTD_c_jobSize]: 1 << 20,
        [c.ZSTD_c_windowLog]: 17,
        [c.ZSTD_c_overlapLog]: 6,
      };
      const frame = (await through(zlib.createZstdCompress({ params }), pieces(input, 300_000))) as Buffer;
      expect(zlib.zstdDecompressSync(frame).equals(input)).toBe(true);
    });

    it("with long distance matching and a tiny dictionary", () => {
      const input = noise(600_000, 13, 7);
      for (const length of [1, 8, 63]) {
        roundTrip(input, { [c.ZSTD_c_nbWorkers]: 2, [c.ZSTD_c_enableLongDistanceMatching]: 1 }, noise(length, 14));
      }
    });

    // What Node 24 gives, with zstd 1.5.7.
    it("make the same of input however it is cut", async () => {
      const input = noise(3 << 20, 15, 7);
      const options = { pledgedSrcSize: input.length, params: { [c.ZSTD_c_nbWorkers]: 2, [c.ZSTD_c_checksumFlag]: 1 } };
      const cut = async (size: number) => {
        const frame = (await through(zlib.createZstdCompress(options), pieces(input, size))) as Buffer;
        return `${frame.length} ${Bun.MD5.hash(frame, "hex").slice(0, 8)}`;
      };
      expect(await cut(input.length)).toBe("1398674 d981d509");
      for (const size of [1 << 20, 64 << 10, 1000]) expect(await cut(size)).toBe("1398687 a871b693");
    });

    it.each([
      [3, 0],
      [3, 1],
      [16, 0],
      [16, 1],
    ])("make the same twice: level %i, long distance matching %i", async (level, longDistance) => {
      const input = noise(3 << 19, 23, 7);
      const params = {
        [c.ZSTD_c_nbWorkers]: 2,
        [c.ZSTD_c_jobSize]: 512 << 10,
        [c.ZSTD_c_compressionLevel]: level,
        [c.ZSTD_c_enableLongDistanceMatching]: longDistance,
      };
      const made = () => through(zlib.createZstdCompress({ params }), pieces(input, 100_000)) as Promise<Buffer>;
      const [frame, again] = await Promise.all([made(), made()]);
      expect(frame.equals(again)).toBe(true);
      expect(zlib.zstdDecompressSync(frame).equals(input)).toBe(true);
    });

    it("with nothing left for the last job", async () => {
      const input = noise(2 << 20, 16, 7);
      const params = { [c.ZSTD_c_nbWorkers]: 2, [c.ZSTD_c_jobSize]: 512 << 10, [c.ZSTD_c_checksumFlag]: 1 };
      const dictionary = noise(1000, 17, 7);
      const frame = (await through(zlib.createZstdCompress({ params, dictionary }), [input])) as Buffer;
      expect(zlib.zstdDecompressSync(frame, { dictionary }).equals(input)).toBe(true);
    });
  });

  // Each input is one of many from its seed that gives other bytes once the check that it is for is taken out.
  describe("the optimal parser", () => {
    /** xorshift32 */
    class Input {
      bytes: number[] = [];
      #x: number;
      constructor(seed: number) {
        this.#x = Math.imul(seed, 2654435761) >>> 0;
      }
      next() {
        this.#x ^= this.#x << 13;
        this.#x ^= this.#x >>> 17;
        this.#x ^= this.#x << 5;
        return (this.#x >>>= 0);
      }
      range(from: number, to: number) {
        return from + (this.next() % (to - from + 1));
      }
      pick(values: number[]) {
        return values[this.next() % values.length];
      }
      some(length: number) {
        return Array.from({ length }, () => this.next() & 255);
      }
      noise(length: number) {
        return this.add(this.some(length));
      }
      copy(offset: number, length: number) {
        for (let i = 0; i < length; i++) this.bytes.push(this.bytes[this.bytes.length - offset]);
        return this;
      }
      add(bytes: number[]) {
        for (const byte of bytes) this.bytes.push(byte);
        return this;
      }
      /** Many of these make one literal cheaper than none. */
      shortMatchAndLiteral() {
        return this.copy(this.range(50, Math.min(2000, this.bytes.length)), this.range(5, 14)).noise(1);
      }
    }
    const digest = (frame: Buffer) => `${frame.length} ${Bun.hash.xxHash32(frame).toString(16)}`;

    // The first block ends with a match in the dictionary, a little further back than the window is large. For the
    // second block the dictionary is given up, and the same distance leads to the right bytes again.
    it.each([
      [26, false, "1520 a9ba4dd5"],
      [10, false, "2316 30a8306d"],
      [26, true, "9125 e0ee4a07"],
    ])(
      "a repeat offset beyond the window is not used once the dictionary is given up: %i, %p",
      async (seed, known, expected) => {
        const input = new Input(seed);
        const windowLog = input.range(10, 12);
        const window = 1 << windowLog;
        const offset = window + input.range(1, 200);
        const dictionarySize = input.range(offset + 50, 4 * window);
        input.noise(dictionarySize);
        const first = input.next() % 2 < 1 ? input.range(window >> 2, window - 50) : window;
        const [length, after] = [input.range(8, 40), input.range(0, 5)];
        input
          .noise(first - length - after)
          .copy(offset, length)
          .noise(after);
        for (let i = input.range(1, 6); i > 0; i--) input.noise(input.range(1, 250)).copy(offset, input.range(4, 40));
        // From 8 KB on the tables of the dictionary are copied, and it is the older segment. Else it is attached.
        const more = known ? 8300 + input.range(0, 2999) : input.range(1, 3000);
        while (input.bytes.length - dictionarySize < first + more) {
          if (input.next() % 3 < 1) input.copy(offset, input.range(4, 40));
          else input.noise(input.range(1, 400));
        }
        const dictionary = Buffer.from(input.bytes).subarray(0, dictionarySize);
        const source = Buffer.from(input.bytes).subarray(dictionarySize);
        const params = {
          [c.ZSTD_c_strategy]: input.range(c.ZSTD_btopt, c.ZSTD_btultra2),
          [c.ZSTD_c_windowLog]: windowLog,
          [c.ZSTD_c_minMatch]: input.range(3, 5),
          [c.ZSTD_c_searchLog]: input.range(2, 6),
        };
        const stream = zlib.createZstdCompress({
          params,
          dictionary,
          pledgedSrcSize: known ? source.length : undefined,
        });
        stream.write(source.subarray(0, first));
        stream.flush();
        const frame = (await through(stream, [source.subarray(first)])) as Buffer;
        expect(digest(frame)).toBe(expected);
        expect(zlib.zstdDecompressSync(frame, { dictionary }).equals(source)).toBe(true);
      },
    );

    // facebook/zstd b0e8580dc. The input ends with `q 6 x 1`. `q 5 x 2` is a little before, so that the repeat offset
    // gives `x` and not what follows, and `x 1` is far before.
    it("does not look at the byte after the block for a literal that replaces the end of a match", () => {
      const input = new Input(68);
      const x = input.some(input.range(8, 40));
      input
        .noise(200)
        .add(x)
        .add([1])
        .noise(input.pick([300, 5000, 40000]));
      for (let i = input.range(30, 600); i > 0; i--) input.shortMatchAndLiteral();
      const q = input.some(input.range(6, 20));
      for (let i = input.range(0, 29); i > 0; i--) {
        const [a, b] = [input.some(input.range(6, 20)), input.some(input.range(6, 20))];
        for (const w of [3, 4])
          input
            .add(a)
            .add([w])
            .add(b)
            .add([w + 10]);
      }
      input.add(q).add([5]).add(x).add([2]);
      for (let i = input.range(0, 2); i > 0; i--) input.shortMatchAndLiteral();
      input.add(q).add([6]).add(x).add([1]);
      const params = {
        [c.ZSTD_c_strategy]: input.range(c.ZSTD_btopt, c.ZSTD_btultra2),
        [c.ZSTD_c_windowLog]: input.range(19, 21),
        [c.ZSTD_c_searchLog]: input.range(3, 7),
        [c.ZSTD_c_minMatch]: input.range(3, 5),
        [c.ZSTD_c_targetLength]: input.pick([48, 64, 200, 999]),
      };
      expect(digest(roundTrip(Buffer.from(input.bytes), params))).toBe("41368 2e959c78");
    });

    // facebook/zstd 22574d848. Matches for `text` are short and overlap, as both copies of it are spoilt every so often,
    // at other places. Its last byte is only in a third, short copy.
    it("has room for a series that goes on to the last position a match can lead to, and a literal", () => {
      const input = new Input(255);
      const size = input.pick([4095, 4095, 4095, 4095, 4094, 4096, 4093, 4097]);
      const text = input.some(size);
      const step = input.range(40, 300);
      const spoilt = (first: number) =>
        text.map((byte, i) => (i === size - 1 || (i >= first && (i - first) % step === 0) ? byte ^ 0x55 : byte));
      const end = text.slice(size - input.range(5, 40));
      input.noise(100);
      const far = input.next() % 2 < 1;
      if (far) input.add(end).noise(input.pick([10, 1000, 20000]));
      input
        .add(spoilt(step >> 1))
        .noise(20)
        .add(spoilt(step - 1))
        .noise(20);
      for (let i = input.range(100, 900); i > 0; i--) input.shortMatchAndLiteral();
      if (!far) input.add(end);
      input.noise(input.range(12, 60)).add(text).noise(input.range(20, 400));
      const params = {
        [c.ZSTD_c_strategy]: input.range(c.ZSTD_btopt, c.ZSTD_btultra2),
        [c.ZSTD_c_windowLog]: 20,
        [c.ZSTD_c_searchLog]: input.range(3, 7),
        [c.ZSTD_c_minMatch]: input.range(3, 5),
        [c.ZSTD_c_targetLength]: input.pick([4095, 4096, 131072]),
      };
      expect(digest(roundTrip(Buffer.from(input.bytes), params))).toBe("5917 9ffc7ec4");
    });

    // facebook/zstd 4d8a2132d. No 4 bytes come twice before the last 9, which are a copy from far away that the small
    // tables have lost by the position after its first, and half of the block is one byte, so that literals are cheap.
    it("has a price for 128 KB of literals", () => {
      const input = new Input(4);
      const size = 128 << 10;
      const last = [0, 0, 0, input.range(1, 254), 0, 0, 0, input.range(1, 254)];
      last.push(input.next() % 3 < 1 ? 0 : input.range(1, 254));
      const from = 4 * input.range(1, (size - 70000) >> 2);
      const pairs = Array.from({ length: 254 * 254 }, (_, i) => [1 + Math.floor(i / 254), 1 + (i % 254)]);
      for (let i = pairs.length - 1; i > 0; i--) {
        const j = input.next() % (i + 1);
        [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
      }
      for (const pair of pairs) {
        if (input.bytes.length === from) input.add(last);
        if (input.add([0, 0]).add(pair).bytes.length >= size) break;
      }
      input.bytes.length = size - last.length;
      input.bytes[input.bytes.length - 1] ||= 7;
      input.add(last);
      const params = {
        [c.ZSTD_c_strategy]: input.range(c.ZSTD_btopt, c.ZSTD_btultra2),
        [c.ZSTD_c_minMatch]: input.range(4, 6),
        [c.ZSTD_c_windowLog]: 18,
        [c.ZSTD_c_targetLength]: input.pick([48, 64, 256, 999]),
        [c.ZSTD_c_hashLog]: input.range(14, 19),
        [c.ZSTD_c_chainLog]: input.range(6, 8),
        [c.ZSTD_c_searchLog]: 1,
      };
      expect(digest(roundTrip(Buffer.from(input.bytes), params))).toBe("81886 6893fa8c");
    });
  });
});
