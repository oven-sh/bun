import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// Every `element.onEndTag(fn)` call JSValue::protect()s its callback. The old
// lol-html C-API binding parked that protection in a per-call heap handler it
// handed to lol-html as raw userdata and never freed on the success path, so
// every registered end-tag callback (and whatever its closure captured) stayed
// GC-rooted for the life of the process. The lol_html Rust-crate binding hands
// lol-html an owning `FnOnce` box, which is dropped (releasing the protection)
// whether or not the end tag is ever reached.
//
// `heapStats().protectedObjectTypeCounts` reports the exact count of
// protect()'d objects by type, so unlike an RSS high-water mark this needs no
// threshold and is stable on debug builds.
test("onEndTag callbacks are released after the rewrite", () => {
  const rewriteWithEndTagHandlers = (count: number) => {
    let document = "";
    for (let i = 0; i < count; i++) document += "<p></p>";
    new HTMLRewriter()
      .on("p", {
        element(element) {
          element.onEndTag(() => {});
        },
      })
      .transform(document);
  };

  const protectedFunctions = () => {
    Bun.gc(true);
    return heapStats().protectedObjectTypeCounts.Function ?? 0;
  };

  rewriteWithEndTagHandlers(400);
  const before = protectedFunctions();
  rewriteWithEndTagHandlers(400);
  rewriteWithEndTagHandlers(400);
  const after = protectedFunctions();

  // Unfixed, every one of the 800 callbacks registered after the baseline was
  // still protected here.
  expect(after - before).toBe(0);
});

// Each .on() / .onDocument() call heap-allocates an ElementHandler / DocumentHandler
// struct via bun.default_allocator. When the HTMLRewriter is garbage-collected,
// LOLHTMLContext.deinit() must destroy those allocations. Previously it only
// unprotected the held JSValues and leaked the struct memory.
//
// RSS is a high-water mark across the allocator's committed segments. mimalloc
// hands a ~30 MB segment back to the OS on its own schedule, so a single
// `Bun.gc(true); rss()` sample lands on either side of that release — the
// 4-vCPU Windows CI lane saw `after` at the peak and `before` in the trough
// for a +31 MB "delta" with nothing retained. Per-window *peak* RSS is the
// stable observable: a leak raises it every pass (~50 MB over 3), while freed
// memory leaves it flat regardless of when the decommit fires.
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

      function peakOver(passes) {
        let peak = 0;
        for (let i = 0; i < passes; i++) peak = Math.max(peak, pass());
        return peak;
      }

      const before = peakOver(3);
      const after = peakOver(3);

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

    // Unfixed: ~50 MB over 3 measured passes. Fixed: <1 MB.
    // Threshold sits at ~half the unfixed signal.
    expect(deltaMB).toBeLessThan(25);
    expect(exitCode).toBe(0);
  },
  15_000,
);
