import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A ReadableStream captures the ambient AsyncLocalStorage context at construction
// time (so pull()/cancel() observe it). Once the stream reaches a terminal state
// and no further source callbacks can run, that captured context should be
// released even while the stream object itself is still reachable. The same
// applies to a type:"direct" stream's retained underlyingSource/pull after close.
//
// Each case holds the stream (and for controller.error, the controller) in an
// array across GC, so the only edge to the probe object is the stream's internal
// WriteBarrier. Before this change the probe survived every GC; with eager
// clearing it is collectable once the terminal transition completes.

const timeout = 60_000;

async function run(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim()) as { alive: number; total: number };
}

// Shared child-process scaffolding: runs `body` N times under an AsyncLocalStorage
// store keyed by a fresh probe object tracked by a FinalizationRegistry, awaits
// microtasks, then GC-storms and reports how many probes survived.
function fixture(body: string) {
  return `
    const { AsyncLocalStorage } = require("node:async_hooks");
    const als = new AsyncLocalStorage();
    const N = 200;
    const retained = [];
    let alive = 0;
    const registry = new FinalizationRegistry(() => { alive--; });

    for (let i = 0; i < N; i++) {
      const probe = { i };
      alive++;
      registry.register(probe, undefined);
      await als.run({ probe }, async () => { ${body} });
    }

    for (let r = 0; r < 20; r++) { Bun.gc(true); await new Promise(f => setImmediate(f)); }
    process.stdout.write(JSON.stringify({ alive, total: N }));
    if (retained.length === 0) throw new Error("retained was cleared");
  `;
}

describe.concurrent("ReadableStream releases its captured async context once terminal", () => {
  test(
    "default controller: cancel()",
    async () => {
      const { alive, total } = await run(
        fixture(`
          const rs = new ReadableStream({ pull() {} });
          retained.push(rs);
          await rs.cancel();
        `),
      );
      expect(alive).toBeLessThan(total * 0.2);
    },
    timeout,
  );

  test(
    "default controller: controller.error()",
    async () => {
      const { alive, total } = await run(
        fixture(`
          let ctrl;
          const rs = new ReadableStream({ start(c) { ctrl = c; } });
          retained.push(rs, ctrl);
          ctrl.error(new Error("boom"));
        `),
      );
      expect(alive).toBeLessThan(total * 0.2);
    },
    timeout,
  );

  test(
    "default controller: controller.close()",
    async () => {
      const { alive, total } = await run(
        fixture(`
          let ctrl;
          const rs = new ReadableStream({ start(c) { ctrl = c; } });
          retained.push(rs, ctrl);
          ctrl.close();
        `),
      );
      expect(alive).toBeLessThan(total * 0.2);
    },
    timeout,
  );

  test(
    "byte controller: cancel()",
    async () => {
      const { alive, total } = await run(
        fixture(`
          const rs = new ReadableStream({ type: "bytes", pull() {} });
          retained.push(rs);
          await rs.cancel();
        `),
      );
      expect(alive).toBeLessThan(total * 0.2);
    },
    timeout,
  );

  test(
    "byte controller: controller.error()",
    async () => {
      const { alive, total } = await run(
        fixture(`
          let ctrl;
          const rs = new ReadableStream({ type: "bytes", start(c) { ctrl = c; } });
          retained.push(rs, ctrl);
          ctrl.error(new Error("boom"));
        `),
      );
      expect(alive).toBeLessThan(total * 0.2);
    },
    timeout,
  );

  test(
    "direct stream: cancel() before materialize drops the pending underlyingSource",
    async () => {
      // No ALS here: the probe is the underlyingSource object itself, which the
      // DirectPending stream stores in m_directUnderlyingSource until first use.
      const src = `
        const N = 200;
        const retained = [];
        let alive = 0;
        const registry = new FinalizationRegistry(() => { alive--; });
        for (let i = 0; i < N; i++) {
          const src = { type: "direct", pull() {} };
          alive++;
          registry.register(src, undefined);
          const rs = new ReadableStream(src);
          retained.push(rs);
          await rs.cancel();
        }
        for (let r = 0; r < 20; r++) { Bun.gc(true); await new Promise(f => setImmediate(f)); }
        process.stdout.write(JSON.stringify({ alive, total: N }));
        if (retained.length === 0) throw new Error("retained was cleared");
      `;
      const { alive, total } = await run(src);
      expect(alive).toBeLessThan(total * 0.2);
    },
    timeout,
  );

  test(
    "direct controller: end() drops underlyingSource and async context",
    async () => {
      const { alive, total } = await run(
        fixture(`
          const src = { type: "direct", pull(c) { c.write("x"); c.end(); } };
          const rs = new ReadableStream(src);
          retained.push(rs);
          for await (const _ of rs) {}
        `),
      );
      expect(alive).toBeLessThan(total * 0.2);
    },
    timeout,
  );
});
