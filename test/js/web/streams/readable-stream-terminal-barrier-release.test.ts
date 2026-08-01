import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A ReadableStream captures the ambient AsyncLocalStorage context at construction
// time (so pull()/cancel() observe it). Once the stream reaches a terminal state
// and no further source callbacks can run, that captured context should be
// released even while the stream object itself is still reachable. The same
// applies to a type:"direct" stream's retained underlyingSource/pull after close,
// and to the Bun-native $bunNativePtr handle once the adapter owns it.
//
// Each case holds the stream (and for controller.error, the controller) in an
// array across GC, so the only edge to the probe object is the stream's internal
// WriteBarrier. Before this change the probe survived every GC; with eager
// clearing it is collectable once the terminal transition completes.

test("ReadableStream releases source-only WriteBarriers once terminal", async () => {
  using dir = tempDir("rs-terminal-barrier-release", { "f.txt": "x" });
  const src = `
    const { AsyncLocalStorage } = require("node:async_hooks");
    const { heapStats } = require("bun:jsc");
    const als = new AsyncLocalStorage();
    const N = 20;
    const retained = [];
    const results = {};
    const registry = new FinalizationRegistry(name => { results[name]--; });

    async function alsCase(name, body) {
      results[name] = 0;
      for (let i = 0; i < N; i++) {
        const probe = { i };
        results[name]++;
        registry.register(probe, name);
        await als.run({ probe }, () => body(retained));
      }
    }

    await alsCase("default-cancel", async retained => {
      const rs = new ReadableStream({ pull() {} });
      retained.push(rs);
      await rs.cancel();
    });
    await alsCase("default-error", async retained => {
      let ctrl;
      const rs = new ReadableStream({ start(c) { ctrl = c; } });
      retained.push(rs, ctrl);
      ctrl.error(new Error("boom"));
    });
    await alsCase("default-close", async retained => {
      let ctrl;
      const rs = new ReadableStream({ start(c) { ctrl = c; } });
      retained.push(rs, ctrl);
      ctrl.close();
    });
    await alsCase("byte-cancel", async retained => {
      const rs = new ReadableStream({ type: "bytes", pull() {} });
      retained.push(rs);
      await rs.cancel();
    });
    await alsCase("byte-error", async retained => {
      let ctrl;
      const rs = new ReadableStream({ type: "bytes", start(c) { ctrl = c; } });
      retained.push(rs, ctrl);
      ctrl.error(new Error("boom"));
    });
    await alsCase("direct-end", async retained => {
      const rs = new ReadableStream({ type: "direct", pull(c) { c.write("x"); c.end(); } });
      retained.push(rs);
      for await (const _ of rs) {}
    });

    // DirectPending underlyingSource (no ALS: the probe is the source object itself).
    results["direct-pending-cancel"] = 0;
    for (let i = 0; i < N; i++) {
      const source = { type: "direct", pull() {} };
      results["direct-pending-cancel"]++;
      registry.register(source, "direct-pending-cancel");
      const rs = new ReadableStream(source);
      retained.push(rs);
      await rs.cancel();
    }

    // Native $bunNativePtr handle after full consumption.
    for (let i = 0; i < N; i++) {
      const rs = Bun.file(process.env.PROBE_FILE).stream();
      retained.push(rs);
      for await (const _ of rs) {}
    }

    for (let r = 0; r < 8; r++) { Bun.gc(true); await new Promise(f => setImmediate(f)); }
    results["native-consumed"] = heapStats().objectTypeCounts.FileInternalReadableStreamSource ?? 0;

    process.stdout.write(JSON.stringify({ results, N }));
    if (retained.length === 0) throw new Error("retained was cleared");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: { ...bunEnv, PROBE_FILE: `${dir}/f.txt` },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { results, N } = JSON.parse(stdout.trim()) as { results: Record<string, number>; N: number };
  // Before this change every case reported N live probes; allow generous GC slack.
  const threshold = Math.floor(N * 0.2);
  const leaked = Object.entries(results).filter(([, alive]) => alive >= threshold);
  expect({ leaked, results, threshold }).toEqual({ leaked: [], results, threshold });
  expect(exitCode).toBe(0);
});
