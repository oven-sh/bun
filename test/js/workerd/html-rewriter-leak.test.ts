import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// Each .on() / .onDocument() call heap-allocates an ElementHandler / DocumentHandler
// struct via bun.default_allocator. When the HTMLRewriter is garbage-collected,
// LOLHTMLContext.deinit() must destroy those allocations. Previously it only
// unprotected the held JSValues and leaked the struct memory.
//
// RSS is a high-water mark — Bun.gc(true) collects every wrapper and its
// lol-html builder, but the allocators don't promptly hand pages back to the
// OS. So warmup runs the *same* workload as the measured phase: the allocator
// footprint is established before the baseline, and any growth past that is
// what's actually retained.
//
// Skipped in debug: at this N a debug pass is ~40s and the extra debug-build
// allocation tracking adds enough RSS noise to drown the signal. CI has no
// debug test lane; release + ASAN cover the regression.
test.skipIf(isDebug)(
  "HTMLRewriter does not leak element/document handler allocations",
  async () => {
    const code = /* js */ `
      const noop = { element() {}, comments() {}, text() {} };
      const docNoop = { doctype() {}, comments() {}, text() {}, end() {} };

      function once() {
        const rw = new HTMLRewriter();
        for (let i = 0; i < 32; i++) rw.on("div", noop);
        for (let i = 0; i < 32; i++) rw.onDocument(docNoop);
      }

      const N = 4000;
      function pass() {
        for (let i = 0; i < N; i++) once();
        Bun.gc(true);
        return process.memoryUsage.rss();
      }

      pass(); pass();
      const before = pass();
      pass(); pass();
      const after = pass();

      process.stdout.write(
        JSON.stringify({ before, after, deltaMB: (after - before) / 1024 / 1024 }) + "\\n",
      );
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "-e", code],
      env: {
        ...bunEnv,
        // Don't inherit the runner's GC_LEVEL=1 — it changes the per-pass live set.
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
        // ASAN's freed-block quarantine is exactly the thing that pins RSS at
        // peak; disable it so freed lol-html builders get reused across passes.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
          .filter(Boolean)
          .join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const filteredStderr = stderr
      .split("\n")
      .filter(line => !line.startsWith("WARNING: ASAN interferes"))
      .join("\n")
      .trim();
    expect(filteredStderr).toBe("");

    const { deltaMB } = JSON.parse(stdout.trim());

    // Unfixed: ~50 MB over 3 measured passes. Fixed: ±1 MB plateau.
    // Threshold sits at ~half the unfixed signal.
    expect(deltaMB).toBeLessThan(25);
    expect(exitCode).toBe(0);
  },
  15_000,
);
