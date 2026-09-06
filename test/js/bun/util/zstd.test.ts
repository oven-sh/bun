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
import { bunEnv, bunExe, isASAN, rss } from "harness";
import zlib from "node:zlib";
import path from "path";

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

  // Test with known zstd-compressed data
  describe("zstd CLI compatibility", () => {
    for (const { name, compressed, original } of [
      {
        name: "package.json",
        compressed: Buffer.from(
          `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`,
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
          expect(syncDecompressed).toStrictEqual(input);
          expect(asyncDecompressed).toStrictEqual(input);
        });
      }
    });
  }
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

  it("zstdCompressSync evaluates the options object before validating the input", () => {
    expect(() =>
      zstdCompressSync(42 as any, {
        get level() {
          throw new Error("level option was read");
        },
      }),
    ).toThrow("level option was read");
  });

  it("gzipSync evaluates the options object before capturing the input", () => {
    const input = new Uint8Array(64).fill(97);
    const compressed = gzipSync(input, {
      get level() {
        input.buffer.transfer();
        return 6;
      },
    });
    expect(gunzipSync(compressed).byteLength).toBe(0);
  });

  it("deflateSync evaluates the options object before capturing the input", () => {
    const input = new Uint8Array(64).fill(97);
    const compressed = deflateSync(input, {
      get level() {
        input.buffer.transfer();
        return 6;
      },
    });
    expect(inflateSync(compressed).byteLength).toBe(0);
  });

  it("gunzipSync evaluates the options object before validating the input", () => {
    expect(() =>
      gunzipSync(42 as any, {
        get windowBits() {
          throw new Error("windowBits option was read");
        },
      }),
    ).toThrow("windowBits option was read");
  });

  it("inflateSync evaluates the options object before validating the input", () => {
    expect(() =>
      inflateSync(42 as any, {
        get windowBits() {
          throw new Error("windowBits option was read");
        },
      }),
    ).toThrow("windowBits option was read");
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
