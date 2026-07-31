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

// #5640: a Response body built from an async iterable with no awaited I/O must not starve
// the event loop or run the pump unbounded while a paced reader is consuming it.
describe("Response(async iterable).body with an unpaced producer", () => {
  const yieldLimit = 2000;
  const makeScript = (consumer: string) => `
    const chunk = new Uint8Array(1024);
    let yields = 0;
    async function* g() {
      while (true) {
        yield chunk;
        // Without backpressure the pump runs in a tight promise-reaction loop and nothing
        // below the generator ever runs; the yield cap is the only way out.
        if (++yields > ${yieldLimit}) {
          process.stdout.write(JSON.stringify({ error: "unbounded", yields }) + "\\n");
          process.exit(1);
        }
      }
    }
    ${consumer}
  `;
  const readerLoop = `
    let reads = 0;
    const body = new Response(g()).body;
    (async () => {
      const r = body.getReader();
      while (true) {
        const { done } = await r.read();
        if (done) break;
        reads++;
        await new Promise(res => setTimeout(res, 1));
        if (reads === 5) {
          await r.cancel();
          process.stdout.write(JSON.stringify({ reads, yields }) + "\\n");
          process.exit(0);
        }
      }
    })();
  `;
  const forAwaitLoop = `
    let reads = 0;
    (async () => {
      for await (const c of new Response(g()).body) {
        reads++;
        await new Promise(res => setTimeout(res, 1));
        if (reads === 5) {
          process.stdout.write(JSON.stringify({ reads, yields }) + "\\n");
          process.exit(0);
        }
      }
    })();
  `;
  const pipeToLoop = `
    let reads = 0;
    new Response(g()).body.pipeTo(new WritableStream({
      write() {
        reads++;
        if (reads === 5) {
          process.stdout.write(JSON.stringify({ reads, yields }) + "\\n");
          process.exit(0);
        }
        return new Promise(res => setTimeout(res, 1));
      },
    })).catch(() => {});
  `;

  test.concurrent.each([
    ["getReader()", readerLoop],
    ["for-await", forAwaitLoop],
    ["pipeTo", pipeToLoop],
  ])("paced %s consumer is not starved", async (_name, consumer) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", makeScript(consumer)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.error).toBeUndefined();
    // Reaching reads === 5 proves the event loop is alive: each step awaited a timer.
    expect(result.reads).toBe(5);
    // Each read() drives the generator at most to the 64 KiB batch boundary: 5 reads of
    // 1 KiB chunks is at most 5 * 64 yields.
    expect(result.yields).toBeLessThanOrEqual(5 * 64);
    expect(exitCode).toBe(0);
  });

  test.concurrent("spawn stdin ReadableStream backpressure suspends the pump", async () => {
    // A child that never reads stdin fills the pipe buffer, so FileSink's write() goes
    // pending; the pump must suspend on that promise instead of buffering without bound.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const chunk = new Uint8Array(65536);
        let yields = 0;
        async function* g() {
          while (true) {
            yield chunk;
            if (++yields > ${yieldLimit}) {
              process.stdout.write(JSON.stringify({ error: "unbounded", yields }) + "\\n");
              process.exit(1);
            }
          }
        }
        let ticks = 0;
        setInterval(() => ticks++, 10);
        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "setTimeout(() => {}, 120000)"],
          stdin: new Response(g()).body,
          stdout: "ignore",
          stderr: "ignore",
        });
        (async () => {
          // Once the pipe is full the pump suspends; wait for the event loop to prove it.
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
    expect(result.yields).toBeLessThan(yieldLimit);
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
});
