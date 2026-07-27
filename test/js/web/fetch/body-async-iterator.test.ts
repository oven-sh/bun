import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Response.bytes() with async iterable body does not crash with null deref", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function* gen() {}
      const body = {};
      body[Symbol.asyncIterator] = () => gen();
      const resp = new Response(body);
      try { resp.bytes(); } catch {}
      try { resp.bytes(); } catch(e) { console.log(e.message); }
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).not.toContain("null is not an object");
  expect(exitCode).toBe(0);
});

test("Response.arrayBuffer() with async iterable body does not crash with null deref", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function* gen() {}
      const body = {};
      body[Symbol.asyncIterator] = () => gen();
      const resp = new Response(body);
      try { resp.arrayBuffer(); } catch {}
      try { resp.arrayBuffer(); } catch(e) { console.log(e.message); }
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).not.toContain("null is not an object");
  expect(exitCode).toBe(0);
});

// An async generator that never awaits fulfills every next() synchronously, so the direct
// controller's drive loop would pump it forever (zero event-loop ticks, unbounded buffer)
// without the controller's own backpressure signal. Each face runs in a subprocess whose
// generator has a yield cap: on an unguarded build it hits that cap with ticks=0; with the
// guard the paced consumer's five reads finish first.
describe("Response(async iterable).body: direct-controller pump guard", () => {
  const producer = (cap: number) => `
    const chunk = new Uint8Array(1024);
    let yields = 0;
    let ticks = 0;
    async function* g() {
      while (true) {
        yield chunk;
        if (++yields > ${cap}) {
          process.stdout.write(JSON.stringify({ error: "unbounded", yields, ticks }) + "\\n");
          process.exit(1);
        }
      }
    }
    setInterval(() => ticks++, 10);
  `;
  const report = `
    process.stdout.write(JSON.stringify({ reads, yields, ticks }) + "\\n");
    process.exit(0);
  `;

  async function runFace(consumer: string, cap = 4000) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", producer(cap) + consumer],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    return { result, exitCode };
  }

  test.concurrent.each([
    [
      "getReader()",
      `
      const r = new Response(g()).body.getReader();
      let reads = 0;
      (async () => {
        while (true) {
          const { done } = await r.read();
          if (done) break;
          reads++;
          await new Promise(res => setTimeout(res, 1));
          if (reads === 5) { await r.cancel(); ${report} }
        }
      })();
      `,
    ],
    [
      "for-await",
      `
      let reads = 0;
      (async () => {
        for await (const c of new Response(g()).body) {
          reads++;
          await new Promise(res => setTimeout(res, 1));
          if (reads === 5) { ${report} }
        }
      })();
      `,
    ],
    [
      "pipeTo",
      `
      let reads = 0;
      new Response(g()).body.pipeTo(new WritableStream({
        write() {
          reads++;
          if (reads === 5) { ${report} }
          return new Promise(res => setTimeout(res, 1));
        },
      })).catch(() => {});
      `,
    ],
    [
      "pipeThrough",
      `
      let reads = 0;
      const r = new Response(g()).body.pipeThrough(new TransformStream()).getReader();
      (async () => {
        while (true) {
          const { done } = await r.read();
          if (done) break;
          reads++;
          await new Promise(res => setTimeout(res, 1));
          if (reads === 5) { await r.cancel(); ${report} }
        }
      })();
      `,
    ],
  ])("paced %s consumer is not starved", async (_name, consumer) => {
    const { result, exitCode } = await runFace(consumer);
    expect(result.error).toBeUndefined();
    // Reaching reads === 5 proves the event loop is alive: each step awaited a timer.
    expect(result.reads).toBe(5);
    // Five 64 KiB batches of 1 KiB chunks plus the resume-and-suspend overlap.
    expect(result.yields).toBeLessThan(1000);
    expect(exitCode).toBe(0);
  });

  test.concurrent("cancel while suspended runs the generator's finally", async () => {
    const { result, exitCode } = await runFace(`
      let reads = 0;
      let returnedResolve;
      const returned = new Promise(res => { returnedResolve = res; });
      async function* wrapped() { try { yield* g(); } finally { returnedResolve(true); } }
      const r = new Response(wrapped()).body.getReader();
      (async () => {
        while (true) {
          const { done } = await r.read();
          if (done) break;
          reads++;
          if (reads === 3) {
            await r.cancel();
            process.stdout.write(JSON.stringify({ reads, yields, ticks, returned: await returned }) + "\\n");
            process.exit(0);
          }
        }
      })();
    `);
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ reads: 3, returned: true });
    expect(exitCode).toBe(0);
  });

  test.concurrent("spawn stdin: a full pipe's pending write suspends the pump", async () => {
    // A child that never reads stdin fills the pipe buffer, so FileSink.write() returns a
    // pending promise; the pump must suspend on it instead of buffering without bound.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const chunk = new Uint8Array(65536);
        let yields = 0;
        let ticks = 0;
        async function* g() {
          while (true) {
            yield chunk;
            if (++yields > 2000) {
              process.stdout.write(JSON.stringify({ error: "unbounded", yields, ticks }) + "\\n");
              process.exit(1);
            }
          }
        }
        setInterval(() => ticks++, 10);
        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "setTimeout(() => {}, 120000)"],
          stdin: new Response(g()).body,
          stdout: "ignore",
          stderr: "ignore",
        });
        (async () => {
          while (ticks < 3) await new Promise(res => setTimeout(res, 10));
          child.kill();
          await child.exited;
          process.stdout.write(JSON.stringify({ ticks, yields }) + "\\n");
          process.exit(0);
        })();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.error).toBeUndefined();
    expect(result.ticks).toBeGreaterThanOrEqual(3);
    expect(result.yields).toBeLessThan(2000);
    expect(exitCode).toBe(0);
  });

  // The guard is scoped to the ArrayBuffer sink kind: .text() uses the Text sink and a
  // reader that is always waiting, so the guard must never trip for a finite producer.
  test.concurrent(".text() on a finite producer is not guarded", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const chunk = new Uint8Array(1024).fill(0x61);
        async function* g() { for (let i = 0; i < 5000; i++) yield chunk; }
        const t = await new Response(g()).text();
        process.stdout.write(JSON.stringify({ len: t.length }) + "\\n");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ len: 5000 * 1024 });
    expect(exitCode).toBe(0);
  });

  test.concurrent("bounded producer still delivers every byte", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const chunk = new Uint8Array(1024).fill(0x61);
        async function* g() { for (let i = 0; i < 300; i++) yield chunk; }
        const r = new Response(g()).body.getReader();
        let total = 0;
        while (true) {
          const { done, value } = await r.read();
          if (done) break;
          total += value.byteLength;
        }
        process.stdout.write(JSON.stringify({ total }) + "\\n");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ total: 300 * 1024 });
    expect(exitCode).toBe(0);
  });

  test.concurrent("strategy highWaterMark sets the guard threshold", async () => {
    // A user type:"direct" stream: highWaterMark 8192 with 1 KiB writes means the first
    // negative return (and so the first batch to the reader) is after the 9th write.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let negativeAt = -1;
        const s = new ReadableStream({
          type: "direct",
          async pull(c) {
            for (let i = 1; i <= 200; i++) {
              const n = c.write(new Uint8Array(1024));
              if (typeof n === "number" && n < 0) { negativeAt = i; break; }
            }
            c.close();
          },
        }, { highWaterMark: 8192 });
        const r = s.getReader();
        const first = await r.read();
        await r.cancel();
        process.stdout.write(JSON.stringify({ negativeAt, firstLen: first.value?.byteLength ?? 0 }) + "\\n");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ negativeAt: 9, firstLen: 9 * 1024 });
    expect(exitCode).toBe(0);
  });
});
