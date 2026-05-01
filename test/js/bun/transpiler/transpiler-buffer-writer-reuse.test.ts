import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";

// transformSync caches its print buffer on the Transpiler instance and reuses
// it across calls. BufferPrinter.init copies that BufferWriter *by value* into
// printer.ctx, so when printing grows the underlying MutableString past its
// capacity the old allocation is freed and only printer.ctx sees the new
// pointer. The cached BufferWriter must be refreshed from printer.ctx on every
// return path. Previously the error path returned before that sync happened,
// so the defer stored the stale snapshot (freed pointer) into
// this.buffer_writer for the next call to write through.
describe("Transpiler transformSync buffer reuse", () => {
  // The only way transpiler.print() can fail on this path is allocator OOM, so
  // we pin mimalloc to a fixed reserved arena and disallow further OS
  // allocations. After the print buffer reallocates at least once, a later
  // growth returns NULL and transformSync throws. Without the fix, the next
  // transformSync writes through the freed cached pointer — ASAN catches it as
  // a SEGV on write inside BufferWriter.writeAll → MutableString.append.
  //
  // Requires an ASAN-instrumented mimalloc (MI_TRACK_ASAN) to observe the UAF;
  // release builds keep freed large segments mapped so the stale write is
  // silent there. Windows mimalloc reserve semantics differ enough that we
  // skip it.
  const hasASAN = isDebug || isASAN;
  test.skipIf(!hasASAN || isWindows)(
    "does not cache a freed print buffer after transformSync throws",
    async () => {
      const fixture = /* js */ `
        const t = new Bun.Transpiler({ loader: "js" });
        // Prime the cached BufferWriter with a ~500KB allocation so the first
        // growth during the huge print below moves it (freeing this pointer).
        t.transformSync(";");
        const chunk = "a".repeat(500 * 1024);
        t.transformSync('var m = "' + chunk + '";');
        // Many statements: each string literal is one writeAll, so the buffer
        // grows in ~500KB steps and getError() is checked after every statement
        // (the first OOM is reported without millions of retry writes).
        let huge = "";
        for (let i = 0; i < 80; i++) huge += 'var h' + i + ' = "' + chunk + '";\\n';
        let threw = false;
        try { t.transformSync(huge); } catch { threw = true; }
        if (!threw) { process.stdout.write("NO_OOM\\n"); process.exit(0); }
        // With the fix, the cached BufferWriter is printer.ctx (the live buffer
        // at the point of OOM). Without the fix, it is the freed ~500KB pointer
        // and this write trips ASAN.
        const out = t.transformSync("const ok = 1;");
        process.stdout.write(out === "const ok = 1;\\n" ? "RECOVERED_OK\\n" : "BAD:" + JSON.stringify(out) + "\\n");
      `;
      using dir = tempDir("transpiler-buffer-writer", { "repro.js": fixture });

      // 128MiB sits comfortably inside the 64–160MiB window where parse
      // succeeds but the print buffer growth past ~20–30MiB exhausts the
      // reserved arena on current debug/ASAN builds.
      await using proc = Bun.spawn({
        cmd: [bunExe(), "repro.js"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          MIMALLOC_RESERVE_OS_MEMORY: "128M",
          MIMALLOC_DISALLOW_OS_ALLOC: "1",
          MIMALLOC_SHOW_ERRORS: "0",
          MIMALLOC_MAX_ERRORS: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);

      if (stdout.includes("NO_OOM")) {
        // Could not drive the allocator to fail mid-print (e.g. mimalloc tuning
        // changed). The bug is not exercised, but the buffer-reuse path below
        // still is.
        console.warn("transformSync OOM repro: allocator did not fail mid-print; skipping UAF assertion");
      } else {
        expect(stderr).not.toContain("AddressSanitizer");
        expect(stdout.trim()).toBe("RECOVERED_OK");
        expect(exitCode).toBe(0);
      }
    },
    30_000,
  );

  test("pooled print buffer survives repeated growth and shrink", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });

    // First call sizes the cached buffer to the input length (1 byte), so the
    // next large call is guaranteed to reallocate inside the printer.
    expect(transpiler.transformSync(";")).toBe("");

    const filler = Buffer.alloc(64 * 1024, "a").toString();
    const big = transpiler.transformSync(`export const s: string = "${filler}";`);
    expect(big).toBe(`export const s = "${filler}";\n`);

    // Shrink back down and grow again several times to churn the pooled
    // buffer. Each iteration reads through whatever pointer was cached by the
    // previous call.
    for (let i = 0; i < 8; i++) {
      expect(transpiler.transformSync("const n: number = 1;")).toBe("const n = 1;\n");
      const grown = transpiler.transformSync(`export const s: string = "${filler}${filler}${i}";`);
      expect(grown).toBe(`export const s = "${filler}${filler}${i}";\n`);
    }
  });

  test("output is correct after many reallocating transformSync calls", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });

    // Prime the cache with a tiny buffer.
    transpiler.transformSync(";");

    // Monotonically growing output so every call reallocates past the
    // previous capacity. Verify the tail of each result so a stale buffer
    // (truncated or garbage bytes) would fail the assertion, not just crash.
    let body = "";
    for (let i = 0; i < 128; i++) {
      body += `export const v${i}: number = ${i};\n`;
      const out = transpiler.transformSync(body);
      expect(out.endsWith(`export const v${i} = ${i};\n`)).toBe(true);
    }
  });
});
