import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const childScript = `let n = 0; for await (const c of process.stdin) n += c.length; process.stdout.write("n=" + n);`;

describe("spawnSync with ReadableStream stdin", () => {
  test("JS-authored ReadableStream is buffered before spawn", () => {
    const stream = new ReadableStream({
      async start(controller) {
        await 42;
        controller.enqueue(new TextEncoder().encode("test data"));
        controller.close();
      },
    });

    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "-e", childScript],
      stdin: stream,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toBe("n=9");
    expect(exitCode).toBe(0);
  });

  test("ReadableStream with multiple async chunks", () => {
    let pulls = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        await Promise.resolve();
        if (pulls++ === 4) return controller.close();
        controller.enqueue(new Uint8Array(16).fill(97));
      },
    });

    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "-e", childScript],
      stdin: stream,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toBe("n=64");
    expect(exitCode).toBe(0);
  });

  test("ReadableStream that errors rejects the spawnSync call", () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new Error("boom from stream"));
      },
    });

    expect(() =>
      spawnSync({
        cmd: [bunExe(), "-e", childScript],
        stdin: stream,
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      }),
    ).toThrow("boom from stream");
  });

  test("empty ReadableStream", () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "-e", childScript],
      stdin: stream,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toBe("n=0");
    expect(exitCode).toBe(0);
  });

  // The stdin drain runs on the main event loop (before the child is
  // spawned and before the isolated loop is entered), so queued microtasks
  // fire while the stream is being buffered. This is the same as if the
  // caller had written `const b = await res.bytes(); spawnSync({ stdin: b
  // })`. The isolated-loop invariants (no microtasks/timers while the child
  // runs) still hold because the child has not started yet. Timers may also
  // fire if the drain reaches `auto_tick()` (e.g. for a network body), but
  // that is not deterministic for a pure-microtask stream so only the
  // microtask is asserted here.
  test("main-loop microtasks run during the pre-spawn stdin drain", () => {
    let microtask: "before" | "during" | undefined;
    let inSpawnSync = false;
    queueMicrotask(() => {
      microtask = inSpawnSync ? "during" : "before";
    });
    let pulls = 0;
    const stream = new ReadableStream({
      async pull(c) {
        await Promise.resolve();
        if (pulls++ === 0) return c.enqueue(new TextEncoder().encode("x"));
        c.close();
      },
    });
    inSpawnSync = true;
    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), "-e", childScript],
      stdin: stream,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    inSpawnSync = false;
    expect(microtask).toBe("during");
    expect(stdout.toString()).toBe("n=1");
    expect(exitCode).toBe(0);
  });

  test("stdout/stderr ReadableStream still rejected in sync mode", () => {
    const stream = new ReadableStream({ start: c => c.close() });
    expect(() =>
      spawnSync({
        cmd: [bunExe(), "-e", ""],
        stdout: stream as any,
        env: bunEnv,
      }),
    ).toThrow(/ReadableStream cannot be used in sync mode/);
  });
});

// https://github.com/oven-sh/bun/issues/5991
describe("spawnSync with streaming fetch Response stdin", () => {
  async function makeServer(totalBytes: number, chunk = 32 * 1024) {
    return Bun.serve({
      port: 0,
      async fetch() {
        let sent = 0;
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(c: any) {
              const buf = Buffer.alloc(chunk, "a");
              while (sent < totalBytes) {
                const n = Math.min(chunk, totalBytes - sent);
                c.write(buf.subarray(0, n));
                await c.flush();
                sent += n;
              }
              c.close();
            },
          }),
        );
      },
    });
  }

  test("Response whose body is still arriving", async () => {
    const total = 128 * 1024;
    await using server = await makeServer(total);
    const res = await fetch(server.url);
    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "-e", childScript],
      stdin: res,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toBe(`n=${total}`);
    expect(exitCode).toBe(0);
  });

  test("res.body (ReadableStream) directly", async () => {
    const total = 64 * 1024;
    await using server = await makeServer(total);
    const res = await fetch(server.url);
    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "-e", childScript],
      stdin: res.body!,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    expect(stderr.toString()).toBe("");
    expect(stdout.toString()).toBe(`n=${total}`);
    expect(exitCode).toBe(0);
  });

  test("Response whose body has been consumed throws", async () => {
    await using server = await makeServer(1024, 1024);
    const res = await fetch(server.url);
    await res.arrayBuffer();
    expect(() =>
      spawnSync({
        cmd: [bunExe(), "-e", childScript],
        stdin: res,
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      }),
    ).toThrow(/already.*used/i);
  });
});
