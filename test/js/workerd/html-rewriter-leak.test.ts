import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow, isASAN, isDebug, tempDir } from "harness";

// `wire_input`'s materialized-body path transfers the body's `+1` (a
// `WTFStringImpl` for an all-ASCII `new Response("...")`) into an `AnyBlob`
// that it must `.detach()` after feeding. `WTFStringImpl` is native-heap, so
// the Response-count tests below would not catch this.
test("transform(new Response(ascii)) releases the input WTFStringImpl", async () => {
  const code = /* js */ `
    const rss = process.memoryUsage.rss;
    // ~64 KB of ASCII so the leak dominates allocator noise.
    const html = "<!doctype html>" + Buffer.alloc(64 * 1024, "x").toString() + "<p>.</p>";
    const rw = new HTMLRewriter().on("p", { element() {} });

    async function pass(n) {
      for (let i = 0; i < n; i++) await rw.transform(new Response(html)).text();
      Bun.gc(true);
      return rss();
    }

    await pass(200); // warmup
    const before = await pass(200);
    await pass(200); await pass(200);
    const after = await pass(200);
    process.stdout.write(JSON.stringify({ deltaMB: (after - before) / 1024 / 1024 }) + "\\n");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", code],
    env: {
      ...bunEnv,
      BUN_GARBAGE_COLLECTOR_LEVEL: "0",
      // ASAN's quarantine pins freed blocks and keeps RSS at peak.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(
    stderr
      .split("\n")
      .filter(l => !l.startsWith("WARNING: ASAN"))
      .join("\n")
      .trim(),
  ).toBe("");
  // A crash leaves stdout empty; surface it (and the exit code) instead of a
  // generic JSON.parse SyntaxError.
  expect({ stdout: stdout.trim(), exitCode }).toEqual({
    stdout: expect.stringMatching(/^\{"deltaMB":/),
    exitCode: 0,
  });
  const { deltaMB } = JSON.parse(stdout.trim());
  // Unfixed: ~38 MB (3 × 200 × 64 KB). Fixed: ~0.
  expect(deltaMB).toBeLessThan(15);
}, 30_000);

// https://github.com/oven-sh/bun/issues/31804
test("exceptions thrown from handlers do not leak protected Exception roots", async () => {
  const code = /* js */ `
    const { heapStats } = require("bun:jsc");

    async function settle() {
      for (let i = 0; i < 8; i++) {
        Bun.gc(true);
        await Bun.sleep(0);
      }
    }

    function counts() {
      const stats = heapStats();
      return {
        Exception: stats.objectTypeCounts.Exception ?? 0,
        protectedException: stats.protectedObjectTypeCounts.Exception ?? 0,
      };
    }

    await settle();
    const before = counts();

    let caught = 0;
    for (let i = 0; i < 100; i++) {
      const rewriter = new HTMLRewriter().on("div", {
        element() {
          throw new Error("handler failed");
        },
      });
      try {
        rewriter.transform("<div>hello</div>");
      } catch (error) {
        if (error?.message !== "handler failed") throw error;
        caught++;
      }
    }

    await settle();
    const after = counts();

    console.log(JSON.stringify({ caught, before, after }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");

  const { caught, before, after } = JSON.parse(stdout.trim());
  expect(caught).toBe(100);
  // Unfixed: after.protectedException == before.protectedException + 100.
  expect(after.protectedException).toBeLessThanOrEqual(before.protectedException);
  expect(after.Exception).toBeLessThanOrEqual(before.Exception + 1);
  expect(exitCode).toBe(0);
});

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
//
// One rewriter serves every round. `.on()` protects the listener and its
// `element` method until the rewriter's wrapper is swept, while end-tag
// handlers are dropped when the rewrite finishes. Sharing the rewriter keeps
// the count independent of which wrappers the GC has swept.
test("onEndTag callbacks are released after the rewrite", () => {
  const rewriter = new HTMLRewriter().on("p", {
    element(element) {
      element.onEndTag(() => {});
    },
  });

  const rewriteWithEndTagHandlers = (count: number) => {
    let document = "";
    for (let i = 0; i < count; i++) document += "<p></p>";
    rewriter.transform(document);
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
      const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
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
        return rss();
      }

      pass(); pass(); pass();
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

    // Unfixed: ~50 MB over 3 measured passes. Fixed: a plateau, but RSS is a
    // high-water mark and allocator jitter has been observed to reach ~30 MB
    // on release lanes, so the bound sits between that and the unfixed signal.
    expect(deltaMB).toBeLessThan(35);
    expect(exitCode).toBe(0);
  },
  15_000,
);

// `fail()` / `cancel_from_output()` on a native ByteStream/FileReader input
// must detach the source's sink backref and let the Transform cell become
// unreachable, or every rewrite pins its output Response. Covers the
// suspend-then-reject, suspend-then-resume-throw, and output-cancel paths;
// the materialized-body test above never wires a native source.
test("async handler reject/cancel on native-stream input releases the pipe", async () => {
  using dir = tempDir("hr-native-leak", { "in.html": "<p>a</p><p>b</p><div>x</div>" });
  const file = `${dir}/in.html`;

  const rewrites = async (count: number) => {
    for (let i = 0; i < count; i++) {
      // suspend-then-reject (on_handler_reject → fail)
      await new HTMLRewriter()
        .on("p", {
          async element() {
            await new Promise(r => setTimeout(r, 0));
            throw new Error("x");
          },
        })
        .transform(new Response(Bun.file(file)))
        .text()
        .catch(e => e.message);

      // output-reader cancel while suspended (cancel_from_output). The handler
      // promise is resolved explicitly after the cancel so the suspension ref
      // is released through `on_handler_resolve`'s early-Done exit rather than
      // depending on GC-driven abandon (covered by the never-settling test).
      const { promise, resolve } = Promise.withResolvers<void>();
      const out = new HTMLRewriter().on("p", { element: () => promise }).transform(new Response(Bun.file(file)));
      const reader = out.body!.getReader();
      const first = reader.read();
      await reader.cancel();
      resolve();
      await first.catch(() => {});

      // suspend-then-resume-then-sync-throw (resume_rewrite → fail)
      await new HTMLRewriter()
        .on("p", { async element() {} })
        .on("div", {
          element() {
            throw new Error("y");
          },
        })
        .transform(new Response(Bun.file(file)))
        .text()
        .catch(e => e.message);
    }
  };

  const responses = () => {
    Bun.gc(true);
    return heapStats().objectTypeCounts.Response ?? 0;
  };

  await rewrites(20);
  const before = responses();
  await rewrites(60);
  const after = responses();

  // Unfixed: ~180 leaked Responses (one input + one output per rewrite that
  // detached a native source without releasing the input ref).
  expect(after - before).toBeLessThan(30);
});

// A handler that cancels the output reader synchronously does so while
// `feed()` is still on the stack. `write()` must re-check `done` after
// `feed()` and return `Done` so the native caller's snapshot `sink.end()`
// detaches the upstream; otherwise it keeps dispatching into a terminal pipe
// and the output Response stays pinned.
test("cancelling the output reader from inside a handler releases the pipe", async () => {
  // The server emits the second chunk only after the client signals the handler
  // has run on the first (so `has_received_last_chunk` is false at cancel time),
  // and the client awaits the server's close before moving on. No timing guesses.
  let sawFirst = Promise.withResolvers<void>();
  let serverClosed = Promise.withResolvers<void>();
  await using server = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(
        new ReadableStream({
          async start(c) {
            c.enqueue(new TextEncoder().encode("<p>a</p>"));
            await sawFirst.promise;
            c.enqueue(new TextEncoder().encode("<p>b</p>"));
            c.close();
            serverClosed.resolve();
          },
        }),
      );
    },
  });
  const url = `http://localhost:${server.port}/`;

  const rewrites = async (count: number) => {
    for (let i = 0; i < count; i++) {
      // Alternate sync vs async handler: the async variant cancels and THEN
      // suspends, covering `write()`'s `feed() == false` branch.
      const async = i % 2 === 1;
      sawFirst = Promise.withResolvers();
      serverClosed = Promise.withResolvers();
      let reader: ReadableStreamDefaultReader | null;
      const upstream = await fetch(url);
      const out = new HTMLRewriter()
        .on("p", {
          element: async
            ? async () => {
                reader?.cancel();
                reader = null;
                await new Promise(r => setTimeout(r, 0));
              }
            : () => {
                reader?.cancel();
                reader = null;
              },
        })
        .transform(upstream);
      reader = out.body!.getReader();
      await reader.read().catch(() => {});
      sawFirst.resolve();
      await serverClosed.promise;
    }
  };

  // The pipe's own release is synchronous; the upstream fetch's Response can
  // lag a few turns after the server closes.
  const responses = async () => {
    let last = Infinity;
    for (let i = 0; i < 20; i++) {
      Bun.gc(true);
      const now = heapStats().objectTypeCounts.Response ?? 0;
      if (now === last) return now;
      last = now;
      await new Promise(r => setImmediate(r));
    }
    return last;
  };

  await rewrites(10);
  const before = await responses();
  await rewrites(40);
  const after = await responses();

  // Unfixed: ~40 leaked Responses (one output per rewrite).
  expect(after - before).toBeLessThan(15);
});

// A suspension parks the rewritable unit's JS wrapper and the boxed lol-html
// rewriter, and the handler promise's reaction roots the Transform cell, so
// everything is released only once that promise settles. A general canary for
// the settle path.
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
// The promise is collected unsettled, the reaction rooting the Transform cell
// goes with it, and the cell's finalizer defers to
// `RewriterPipe::abandon_suspension`, which rejects the body and releases the
// parked wrapper.
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
    // Every body must have settled by now; assert it so a regression that
    // strands one fails with a count instead of hanging on the await below.
    expect(settled.length).toBe(count);
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

// Same abandon path, but with a NATIVE (FileReader) input wired through a raw
// SinkHandle. The Transform cell and the input NewSource can be swept in the
// same GC cycle here, so the pipe's finalizer must not write into the source:
// the source's `sinkOwner` slot roots the cell while the source is alive, and
// the abandon task clears the stale handle raw instead of unpiping through it.
// The materialized bodies in the test above never wire a native source, so
// only this exercises that ordering under ASAN.
test("never-settling handler promises on a file-backed input are abandoned", async () => {
  using dir = tempDir("hr-abandon-file", { "in.html": "<p>a</p><p>b</p>" });
  const file = `${dir}/in.html`;
  const N = 20;

  const bodies = [];
  for (let i = 0; i < N; i++) {
    bodies.push(
      new HTMLRewriter()
        .on("p", {
          async element() {
            await new Promise(() => {});
          },
        })
        .transform(new Response(Bun.file(file)))
        .text()
        .then(
          () => "resolved",
          e => e.message,
        ),
    );
  }
  const settled: string[] = [];
  for (let i = 0; i < 100 && settled.length < N; i++) {
    Bun.gc(true);
    await new Promise(r => setTimeout(r, 1));
    settled.length = 0;
    settled.push(
      ...(await Promise.all(bodies.map(b => Promise.race([b, Promise.resolve(undefined)])))).filter(Boolean),
    );
  }
  expect(settled.length).toBe(N);
  const results = await Promise.all(bodies);
  expect(results.every(m => m.includes("will never settle"))).toBe(true);
});

// The abandon path with a realized output stream. Holding the reader keeps
// the Transform cell reachable (reader -> stream -> NewSource `owner` slot),
// so collecting the cell cannot be what detects the dead handler promise:
// the promise context's destructor is, and it must error the live stream.
test("a held reader's read() rejects when the handler promise is collected", async () => {
  const out = new HTMLRewriter()
    .on("p", {
      async element() {
        await new Promise(() => {});
      },
    })
    .transform(new Response("<p>x</p>"));
  const reader = out.body!.getReader();
  const read = reader.read().then(
    () => "resolved",
    e => e.message,
  );

  let msg: string | undefined;
  for (let i = 0; i < 100 && msg === undefined; i++) {
    Bun.gc(true);
    await new Promise(r => setTimeout(r, 1));
    msg = await Promise.race([read, Promise.resolve(undefined)]);
  }
  expect(msg).toContain("will never settle");
});

// Same, but nothing is held: realizing `.body` installs the body's `readable`
// Strong inside the Response native, which the pipe's own `+1` used to keep
// alive, closing a Strong-rooted loop through the output source's `owner`
// slot that GC could never break. The promise-context abandon makes the
// rewrite terminal (clearing the `owner` edges), so everything collapses.
test("never-settling handler promises with a realized body release their parked state", async () => {
  const N = 30;

  const abandonAll = async (count: number) => {
    const reads = [];
    for (let i = 0; i < count; i++) {
      reads.push(
        new HTMLRewriter()
          .on("p", {
            async element() {
              await new Promise(() => {});
            },
          })
          .transform(new Response("<p>x</p>"))
          .body!.getReader()
          .read()
          .then(
            () => "resolved",
            e => e.message,
          ),
      );
    }
    const settled: string[] = [];
    for (let i = 0; i < 100 && settled.length < count; i++) {
      Bun.gc(true);
      await new Promise(r => setTimeout(r, 1));
      settled.length = 0;
      settled.push(
        ...(await Promise.all(reads.map(b => Promise.race([b, Promise.resolve(undefined)])))).filter(Boolean),
      );
    }
    expect(settled.length).toBe(count);
    return await Promise.all(reads);
  };

  const responses = () => {
    Bun.gc(true);
    return heapStats().objectTypeCounts.Response ?? 0;
  };

  const warm = await abandonAll(10);
  expect(warm.every(m => m.includes("will never settle"))).toBe(true);

  const before = responses();
  const results = await abandonAll(N);
  const after = responses();

  expect(results.every(m => m.includes("will never settle"))).toBe(true);
  expect(after - before).toBeLessThan(N / 3);
});

// Abandoning a transform whose JS-pump input stream never closes makes the
// Transform cell and the pump's sink controller garbage in the same GC cycle.
// The controller's destructor dispatches `__controllerDetached`/`__finalize`
// into the shared RewriterPipe, and cells sweep in unspecified order, so the
// pipe must survive whichever cell dies first (unfixed: ASAN
// heap-use-after-free in `js_controller_detached`, Sink.rs). Only ASAN builds
// observe the stale read, so release lanes skip it.
test.skipIf(!isASAN)(
  "abandoned transforms over a never-closing JS stream survive GC sweep order",
  async () => {
    const code = /* js */ `
      function once() {
        const rs = new ReadableStream({
          pull(c) {
            c.enqueue(new TextEncoder().encode("<p>x</p>"));
            return new Promise(() => {});
          },
        });
        new HTMLRewriter().on("p", { element() {} }).transform(new Response(rs));
      }
      for (let round = 0; round < 10; round++) {
        for (let i = 0; i < 150; i++) once();
        await Bun.sleep(0);
        Bun.gc(true);
      }
      console.log("done");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(
      stderr
        .split("\n")
        .filter(l => !l.startsWith("WARNING: ASAN"))
        .join("\n")
        .trim(),
    ).toBe("");
    expect(stdout.trim()).toBe("done");
    expect(exitCode).toBe(0);
  },
  30_000,
);

// Input-side sibling of the realized-body case: a `type: 'direct'` pull
// parked on `await controller.flush(true)` holds a pending-flush promise
// whose reactions reach back to the Transform cell through the pump promise.
// Abandon must not depend on the cell becoming unreachable: the dead handler
// promise's context destructor fires it, and `fail()` settles the parked
// flush so the whole graph collapses.
test("a direct-stream pull parked on flush(true) is released when the handler promise is collected", async () => {
  const text = new HTMLRewriter()
    .on("p", {
      async element() {
        await new Promise(() => {});
      },
    })
    .transform(
      new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            controller.write(new TextEncoder().encode("<p>x</p>"));
            await controller.flush(true);
            controller.close();
          },
        }),
      ),
    )
    .text()
    .then(
      () => "resolved",
      e => e.message,
    );

  let msg: string | undefined;
  for (let i = 0; i < 100 && msg === undefined; i++) {
    Bun.gc(true);
    await new Promise(r => setTimeout(r, 1));
    msg = await Promise.race([text, Promise.resolve(undefined)]);
  }
  expect(msg).toContain("will never settle");
});

test("element.attributes iterator does not leak names/values", async () => {
  const code = /* js */ `
    const big = Buffer.alloc(256 * 1024, "a").toString();
    const html = '<a x="' + big + '"></a>';
    async function once() {
      let n = 0;
      await new HTMLRewriter().on("a", { element(el) { for (const [k, v] of el.attributes) n += v.length; } }).transform(new Response(html)).text();
      return n;
    }
    for (let i = 0; i < 20; i++) await once();
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 400; i++) await once();
    Bun.gc(true);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;

  // Unfixed: ~120 MiB. Fixed: allocator slack only.
  await expectRssDeltaBelow(["--smol", "-e", code], { release: 50, debug: 70 });
});
