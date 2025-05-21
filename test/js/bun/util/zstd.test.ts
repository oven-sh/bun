import { zstdCompress, zstdCompressSync, zstdDecompress, zstdDecompressSync } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "path";

describe("Zstandard compression", async () => {
  // Test data of various sizes
  const testCases = [
    // { name: "empty", data: new Uint8Array(0) },
    { name: "small", data: new TextEncoder().encode("Hello, World!") },
    { name: "medium", data: await Bun.file(path.join(__dirname, "..", "..", "..", "bun.lock")).bytes() },
    {
      name: "large",
      data: Buffer.from(
        (await Bun.file(path.join(__dirname, "..", "..", "..", "..", "src", "js_parser.zig")).text()).repeat(5),
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
    describe(name + " (" + input.length + " bytes)", () => {
      for (let level = 1; level <= 22; level++) {
        it("level " + level, async () => {
          // Sync compression
          const syncCompressed = zstdCompressSync(input, { level });

          // Async compression
          const asyncCompressed = await zstdCompress(input, { level });

          // Compare compressed results (they should be identical with same level)
          expect(syncCompressed).toStrictEqual(asyncCompressed);

          // Sync decompression of async compressed data
          const syncDecompressed = zstdDecompressSync(asyncCompressed);

          // Async decompression of sync compressed data
          const asyncDecompressed = await zstdDecompress(syncCompressed);

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

describe("Zstandard HTTP compression", () => {
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
