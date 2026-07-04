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

// A suspension parks the sink (+1), the rewritable unit's JS wrapper (+1), a
// Strong on the output Response, and the boxed lol-html rewriter. All of it is
// owned by the handler's promise reaction, so it is released only when that
// promise settles. A general canary for the settle path.
test("suspended rewrites release their parked state once the handler settles", async () => {
  const suspendingRewrites = async (count: number) => {
    for (let i = 0; i < count; i++) {
      await new HTMLRewriter()
        .on("p", {
          async element(element) {
            await new Promise(r => setTimeout(r, 0));
            element.setInnerContent("x");
          },
        })
        .transform(new Response("<p>y</p>"))
        .text();
    }
  };

  const counts = () => {
    Bun.gc(true);
    const { objectTypeCounts, protectedObjectTypeCounts } = heapStats();
    return {
      responses: objectTypeCounts.Response ?? 0,
      functions: protectedObjectTypeCounts.Function ?? 0,
    };
  };

  await suspendingRewrites(40);
  const before = counts();
  await suspendingRewrites(120);
  const after = counts();

  expect(after.responses - before.responses).toBeLessThan(30);
  expect(after.functions - before.functions).toBeLessThan(30);
});

// The abandon path: a handler awaiting a promise nothing will ever resolve.
// The promise is collected unsettled, its GC-managed reaction context goes with
// it, and `SuspensionContext::abandon` fails the body and releases the parked
// wrapper / Strong / sink.
//
// This is the only guard for that mechanism, so it has to assert the release,
// not just the rejection. Poll for the rejections rather than forcing exactly N
// GCs, so a slow ASAN lane doesn't turn a pass into a 5s hang.
test("never-settling handler promises are abandoned and release their parked state", async () => {
  const N = 60;

  const abandonAll = async (count: number) => {
    const bodies = [];
    for (let i = 0; i < count; i++) {
      bodies.push(
        new HTMLRewriter()
          .on("p", {
            async element() {
              await new Promise(() => {});
            },
          })
          .transform(new Response("<p>x</p>"))
          .text()
          .then(
            () => "resolved",
            e => e.message,
          ),
      );
    }
    // The handler promises are unreachable now; collect until every body has
    // been abandoned, rather than guessing a GC count.
    const settled: string[] = [];
    for (let i = 0; i < 100 && settled.length < count; i++) {
      Bun.gc(true);
      await new Promise(r => setTimeout(r, 1));
      settled.length = 0;
      settled.push(
        ...(await Promise.all(bodies.map(b => Promise.race([b, Promise.resolve(undefined)])))).filter(Boolean),
      );
    }
    return await Promise.all(bodies);
  };

  const counts = () => {
    Bun.gc(true);
    const { objectTypeCounts, protectedObjectTypeCounts } = heapStats();
    return {
      responses: objectTypeCounts.Response ?? 0,
      functions: protectedObjectTypeCounts.Function ?? 0,
    };
  };

  // Warm up so one-time allocations don't land in the measured delta.
  const warm = await abandonAll(10);
  expect(warm.every(m => m.includes("will never settle"))).toBe(true);

  const before = counts();
  const results = await abandonAll(N);
  const after = counts();

  // Every one was abandoned with the real reason...
  expect(results.every(m => m.includes("will never settle"))).toBe(true);
  // ...and nothing it parked is still pinned. A regression that keeps rejecting
  // the body but stops releasing would show up as ~N leaked Responses.
  expect(after.responses - before.responses).toBeLessThan(N / 4);
  expect(after.functions - before.functions).toBeLessThan(N / 4);
});
