import { describe, expect, test } from "bun:test";
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

// element.onEndTag(fn) heap-allocates an EndTag.Handler and JSValueProtect()s
// the callback, then hands both to lol-html as opaque user_data. lol-html's
// end-tag handler is FnOnce — it fires at most once and is then dropped —
// but nothing ever freed the Zig allocation or unprotected the callback.
// Calling onEndTag() twice on the same element additionally leaked the first
// allocation because LOLHTML.Element.onEndTag clears the Rust-side handler
// list without telling us.
//
// Detection: protected JSValues are GC roots, so every leaked handler pins
// one Function in heapStats().protectedObjectTypeCounts. After the fix the
// protected-Function count returns to its pre-loop baseline; before the fix
// it grows by exactly one per onEndTag() call.
describe("element.onEndTag does not leak the handler allocation / protected callback", () => {
  async function run(setup: string) {
    const code = /* js */ `
      const { heapStats } = require("bun:jsc");
      const protectedFns = () => heapStats().protectedObjectTypeCounts.Function ?? 0;

      ${setup}

      async function pass(n) {
        for (let i = 0; i < n; i++) {
          await rw.transform(new Response("<div></div>")).text();
        }
        Bun.gc(true);
        return protectedFns();
      }

      // Warm up so baseline reflects any steady-state roots.
      await pass(10);
      const before = await pass(10);
      const after = await pass(500);

      process.stdout.write(JSON.stringify({ before, after, delta: after - before }) + "\\n");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "-e", code],
      env: bunEnv,
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
    const { delta } = JSON.parse(stdout.trim());

    // Unfixed: delta == 500 per onEndTag() call per iteration. Fixed: 0.
    // Allow a little slack for unrelated protected functions.
    expect(delta).toBeLessThan(10);
    expect(exitCode).toBe(0);
  }

  test("single registration", async () => {
    await run(`
      const rw = new HTMLRewriter().on("div", {
        element(el) { el.onEndTag(() => {}); },
      });
    `);
  });

  test("re-registration on the same element", async () => {
    await run(`
      const rw = new HTMLRewriter().on("div", {
        element(el) {
          el.onEndTag(() => {});
          el.onEndTag(() => {});
        },
      });
    `);
  });

  // Each matching selector gets its own Zig Element wrapper around the same
  // underlying lol-html element; the second wrapper's onEndTag must still be
  // able to find and free the first wrapper's handler.
  test("re-registration across overlapping selectors", async () => {
    await run(`
      const rw = new HTMLRewriter()
        .on("div", { element(el) { el.onEndTag(() => {}); } })
        .on("*",   { element(el) { el.onEndTag(() => {}); } });
    `);
  });
});
