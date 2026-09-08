import { memfd_create, setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { afterAll, describe, expect, test } from "bun:test";
import { closeSync, readFileSync, truncateSync, writeFileSync, writeSync } from "fs";
import { bunEnv, bunExe, isASAN, isLinux, isPosix, tempDir } from "harness";
import os from "node:os";
import { join } from "path";

// The limit is process-wide and a `--parallel` worker runs many files in one
// process, so put it back for whatever runs after this file. A later file in
// the same worker would otherwise fail to build any string over the lowered
// limit with ERR_STRING_TOO_LONG.
const FILE_LIMIT = 128 * 1024 * 1024;
const previousLimit = setSyntheticAllocationLimitForTesting(FILE_LIMIT);
afterAll(() => {
  setSyntheticAllocationLimitForTesting(previousLimit);
});

// /dev/zero reports a size of 0. So we need a separate test for reDgular files that are huge.
if (isPosix) {
  test("fs.readFileSync(/dev/zero) should throw an OOM without crashing the process.", () => {
    expect(() => readFileSync("/dev/zero")).toThrow("ENOMEM: not enough memory, read '/dev/zero'");
    Bun.gc(true);
  });

  test.each(["utf8", "ucs2", "latin1", "hex", "base64", "base64url"] as const)(
    "fs.readFileSync(/dev/zero, '%s') should throw an OOM without crashing the process.",
    encoding => {
      expect(() => readFileSync("/dev/zero", encoding)).toThrow("ENOMEM: not enough memory, read '/dev/zero'");
      Bun.gc(true);
    },
  );
}

// memfd is linux only.
if (isLinux) {
  describe("fs.readFileSync large file show OOM without crashing the process.", () => {
    test.each(["buffer", "utf8", "ucs2", "latin1"] as const)("%s encoding", encoding => {
      const memfd = memfd_create(1024 * 1024 * 16 + 1);
      (function (memfd) {
        let buf = new Uint8Array(8 * 1024 * 1024);
        buf.fill(42);
        for (let i = 0; i < 1024 * 1024 * 16 + 1; i += buf.byteLength) {
          writeSync(memfd, buf, 0, buf.byteLength, i);
        }
      })(memfd);
      Bun.gc(true);
      setSyntheticAllocationLimitForTesting(2 * 1024 * 1024);

      try {
        expect(() => (encoding === "buffer" ? readFileSync(memfd) : readFileSync(memfd, encoding))).toThrow(
          "ENOMEM: not enough memory",
        );
      } finally {
        setSyntheticAllocationLimitForTesting(FILE_LIMIT);
        Bun.gc(true);
        closeSync(memfd);
      }
    });
  });
}

// Files in [2^31, 2^32) bytes used to abort the process when decoded to a
// string: the guards in front of WTF string construction only checked the
// synthetic allocation limit (2^32 - 1 by default) and missed
// WTF::StringImpl::MaxLength (2^31 - 1), tripping a RELEASE_ASSERT in
// StringImplShape. The fs layer reports the dead string as ENOMEM (it speaks
// errno), matching the existing >= 2^32 and /dev/zero behavior above.
// 2^31 - 1 is the largest length WTF accepts and must keep working. The file
// is sparse so only the in-memory read costs 2 GiB; each case runs in a
// subprocess to keep the peak away from the test runner, and the block skips
// on small machines (same gate as buffer.test.js's 4 GiB case).
describe.skipIf(os.totalmem() < 10 * 1024 ** 3)("readFileSync at the 2 GiB string limit", () => {
  const spawnRead = async (size: number) => {
    using dir = tempDir("readfile-2gib", {});
    const file = join(String(dir), "big.txt");
    writeFileSync(file, "x");
    truncateSync(file, size);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        try {
          const s = require("fs").readFileSync(${JSON.stringify(file)}, "utf8");
          console.log(JSON.stringify({ length: s.length }));
        } catch (e) {
          console.log(JSON.stringify({ name: e.name, code: e.code }));
        }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { result: JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode })), exitCode };
  };

  test("2^31 bytes throws ENOMEM instead of aborting", async () => {
    const { result, exitCode } = await spawnRead(2 ** 31);
    expect(result).toEqual({ name: "Error", code: "ENOMEM" });
    expect(exitCode).toBe(0);
  });

  test("2^31 - 1 bytes still decodes", async () => {
    const { result, exitCode } = await spawnRead(2 ** 31 - 1);
    expect(result).toEqual({ length: 2 ** 31 - 1 });
    expect(exitCode).toBe(0);
  });
});

// The UTF-8 -> UTF-16 converters behind `fs.readFile*(.., "utf8")`,
// `Buffer.prototype.toString("utf8")` and `TextDecoder.decode` must surface a
// failed output-buffer allocation as a catchable error, never a process abort
// (observed in the wild as a `capacity overflow` panic from an oversized
// length). ASAN's per-allocation cap makes the failure deterministic: every
// 32 MiB input fits under the 48 MiB cap while its ~64 MiB UTF-16 output does
// not, on both the simdutf fast path ('\u00e9' followed by ASCII) and the
// per-codepoint replacement slow path (a flood of 0x80 continuation bytes,
// for which the simdutf length query predicts ~0 code units).
describe.skipIf(!isASAN)("utf8 to utf16 output buffer allocation failure is catchable", () => {
  const SIZE = 32 * 1024 * 1024;
  const env = {
    ...bunEnv,
    // `detect_leaks=0` (last wins): natives owned only by a JSC cell
    // (TextDecoder, Blob) are invisible to LeakSanitizer's reachability scan
    // and get reported at exit, independently of what these children test.
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", "max_allocation_size_mb=48", "detect_leaks=0"]
      .filter(Boolean)
      .join(":"),
  };

  test("readFileSync, readFile, Bun.file, Buffer.toString and TextDecoder recover", async () => {
    using dir = tempDir("utf16-alloc-oom", {});
    const file = join(String(dir), "big-utf8.txt");
    // Valid UTF-8 whose first character is non-ASCII ('\u00e9' = C3 A9), so the
    // decoder must build a (SIZE - 1)-code-unit UTF-16 buffer (~2x SIZE bytes).
    const payload = Buffer.alloc(SIZE, "a");
    payload[0] = 0xc3;
    payload[1] = 0xa9;
    writeFileSync(file, payload);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require("fs");
        const file = ${JSON.stringify(file)};
        const results = [];
        const report = e => ({ name: e.name, code: e.code });
        try { fs.readFileSync(file, "utf8"); results.push("SYNC_UNEXPECTED_SUCCESS"); }
        catch (e) { results.push(report(e)); }
        await fs.promises.readFile(file, "utf8").then(
          () => results.push("ASYNC_UNEXPECTED_SUCCESS"),
          e => results.push(report(e)),
        );
        // Bun.file().text() reaches the converter through
        // Blob::to_string_with_bytes with Lifetime::Temporary, the one caller
        // that also owns its input buffer across the failing allocation.
        await Bun.file(file).text().then(
          () => results.push("BUNFILE_UNEXPECTED_SUCCESS"),
          e => results.push(report(e)),
        );
        const big = Buffer.alloc(${SIZE}, "a"); big[0] = 0xc3; big[1] = 0xa9;
        const decoder = new TextDecoder();
        try { big.toString("utf8"); results.push("TOSTRING_UNEXPECTED_SUCCESS"); }
        catch (e) { results.push(report(e)); }
        try { decoder.decode(big); results.push("DECODE_UNEXPECTED_SUCCESS"); }
        catch (e) { results.push(report(e)); }
        // Slow (WTF-8 replacement) path: the simdutf length query counts ~0
        // code units for a continuation-byte flood, so the output buffer is
        // sized by the replacement decoder instead of the fast path.
        const cont = Buffer.alloc(${SIZE}, 0x80);
        try { cont.toString("utf8"); results.push("TOSTRING_SLOW_UNEXPECTED_SUCCESS"); }
        catch (e) { results.push(report(e)); }
        try { decoder.decode(cont); results.push("DECODE_SLOW_UNEXPECTED_SUCCESS"); }
        catch (e) { results.push(report(e)); }
        console.log(JSON.stringify(results));
        `,
      ],
      env,
      stdout: "pipe",
      // ASAN prints a benign "failed to allocate" WARNING line per recovered
      // failure; drain it but do not assert on it.
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode }))).toEqual([
      { name: "Error", code: "ENOMEM" },
      { name: "Error", code: "ENOMEM" },
      { name: "RangeError", code: "ERR_MEMORY_ALLOCATION_FAILED" },
      { name: "RangeError", code: "ERR_MEMORY_ALLOCATION_FAILED" },
      { name: "RangeError", code: "ERR_MEMORY_ALLOCATION_FAILED" },
      { name: "RangeError", code: "ERR_MEMORY_ALLOCATION_FAILED" },
      { name: "RangeError", code: "ERR_MEMORY_ALLOCATION_FAILED" },
    ]);
    expect(exitCode).toBe(0);
  });

  // Three more callers of `to_utf16_alloc(.., fail_if_invalid = false, ..)`
  // were written as if that call could never error (before the fix it could
  // only abort), so they collapsed `Err` into their all-ASCII fallback. Once
  // the allocation is fallible, `Response.text()` on an `Internal` blob must
  // throw rather than return an empty string, and a store-backed
  // `Blob.json()` must throw rather than reinterpret the UTF-8 bytes as
  // Latin-1. `Blob.text()` is the sibling that was already correct.
  test("Response.text, Blob.text and Blob.json recover", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const results = [];
        const buf = Buffer.alloc(${SIZE}, "a"); buf[0] = 0xc3; buf[1] = 0xa9;
        // '"' + '\\u00e9' + 'a'.repeat(${SIZE} - 4) + '"': a valid JSON string literal.
        const json = Buffer.alloc(${SIZE}, "a");
        json[0] = 0x22; json[1] = 0xc3; json[2] = 0xa9; json[${SIZE} - 1] = 0x22;
        for (const run of [() => new Response(buf).text(), () => new Blob([buf]).text(), () => new Blob([json]).json()]) {
          await run().then(
            v => results.push("UNEXPECTED_SUCCESS length=" + JSON.stringify(v).length),
            e => results.push({ name: e.name, code: e.code, message: e.message }),
          );
        }
        console.log(JSON.stringify(results));
        `,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const allocationFailed = {
      name: "RangeError",
      code: "ERR_MEMORY_ALLOCATION_FAILED",
      message: "Failed to allocate memory",
    };
    expect(JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode }))).toEqual([
      allocationFailed,
      allocationFailed,
      allocationFailed,
    ]);
    expect(exitCode).toBe(0);
  });
});
