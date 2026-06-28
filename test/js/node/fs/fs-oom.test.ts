import { memfd_create, setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { closeSync, readFileSync, writeFileSync, writeSync } from "fs";
import { bunEnv, bunExe, isASAN, isLinux, isPosix, tempDir } from "harness";
import { join } from "path";
setSyntheticAllocationLimitForTesting(128 * 1024 * 1024);

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
        Bun.gc(true);
        closeSync(memfd);
      }
    });
  });
}

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
  test("readFileSync, readFile, Buffer.toString and TextDecoder recover", async () => {
    const SIZE = 32 * 1024 * 1024;
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
        const big = Buffer.alloc(${SIZE}, "a"); big[0] = 0xc3; big[1] = 0xa9;
        try { big.toString("utf8"); results.push("TOSTRING_UNEXPECTED_SUCCESS"); }
        catch (e) { results.push(report(e)); }
        try { new TextDecoder().decode(big); results.push("DECODE_UNEXPECTED_SUCCESS"); }
        catch (e) { results.push(report(e)); }
        // Slow (WTF-8 replacement) path: the simdutf length query counts ~0
        // code units for a continuation-byte flood, so the output buffer is
        // sized by the replacement decoder instead of the fast path.
        const cont = Buffer.alloc(${SIZE}, 0x80);
        try { cont.toString("utf8"); results.push("TOSTRING_SLOW_UNEXPECTED_SUCCESS"); }
        catch (e) { results.push(report(e)); }
        try { new TextDecoder().decode(cont); results.push("DECODE_SLOW_UNEXPECTED_SUCCESS"); }
        catch (e) { results.push(report(e)); }
        console.log(JSON.stringify(results));
        `,
      ],
      env: {
        ...bunEnv,
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", "max_allocation_size_mb=48"]
          .filter(Boolean)
          .join(":"),
      },
      stdout: "pipe",
      // ASAN prints a benign "failed to allocate" WARNING line per recovered
      // failure; drain it but do not assert on it.
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode }))).toEqual([
      { name: "Error", code: "ENOMEM" },
      { name: "Error", code: "ENOMEM" },
      { name: "Error", code: "ERR_STRING_TOO_LONG" },
      { name: "RangeError", code: undefined },
      { name: "Error", code: "ERR_STRING_TOO_LONG" },
      { name: "RangeError", code: undefined },
    ]);
    expect(exitCode).toBe(0);
  });
});
