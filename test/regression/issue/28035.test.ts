import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Verify that backpressure propagates through fetch().body.pipeThrough(TransformStream)
// https://github.com/oven-sh/bun/issues/28035
test("fetch body piped through TransformStream propagates backpressure", async () => {
  using dir = tempDir("28035", {
    "test.ts": `
      const TOTAL_CHUNKS = 3000;
      let chunksProduced = 0;

      const upstream = Bun.serve({
        port: 0,
        idleTimeout: 255,
        fetch() {
          chunksProduced = 0;
          return new Response(
            new ReadableStream({
              pull(controller) {
                if (chunksProduced >= TOTAL_CHUNKS) { controller.close(); return; }
                controller.enqueue(Buffer.alloc(32000, 65));
                chunksProduced++;
              },
            }),
          );
        },
      });

      const proxy = Bun.serve({
        port: 0,
        idleTimeout: 255,
        async fetch() {
          const res = await fetch("http://localhost:" + upstream.port + "/");
          const transform = new TransformStream({
            transform(chunk, ctrl) { ctrl.enqueue(chunk); },
          });
          return new Response(res.body!.pipeThrough(transform));
        },
      });

      // Connect and immediately pause reading to create TCP backpressure.
      // With the socket paused, kernel send/receive buffers fill up,
      // causing uWS to report backpressure. The fix should then pause
      // reading from the upstream to limit memory usage.
      const { promise, resolve } = Promise.withResolvers<void>();
      const conn = await Bun.connect({
        hostname: "localhost",
        port: proxy.port,
        socket: {
          open(socket) {
            socket.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n");
            socket.pause();
            setTimeout(() => socket.resume(), 4000);
          },
          data() {},
          close() { resolve(); },
          error() { resolve(); },
          connectError() { resolve(); },
        },
      });

      // Wait while socket is paused and measure upstream consumption
      await Bun.sleep(2500);
      const chunksWhilePaused = chunksProduced;

      await promise;
      proxy.stop(true);
      upstream.stop(true);
      console.log(JSON.stringify({ chunksWhilePaused, TOTAL_CHUNKS }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.trim().split("\n");
  const jsonLine = lines.find(l => l.startsWith("{"));
  if (!jsonLine) {
    console.log("stdout:", stdout.slice(0, 500));
    console.log("stderr:", stderr.slice(0, 2000));
  }
  expect(exitCode).toBe(0);
  const result = JSON.parse(jsonLine!);

  // Without backpressure: all 3000 chunks consumed eagerly (~96MB buffered)
  // With backpressure: upstream consumption should be bounded by TCP
  // buffer capacity + polling overhead (~50-60MB max)
  expect(result.chunksWhilePaused).toBeLessThan(result.TOTAL_CHUNKS * 0.9);
}, 30_000);

// Verify basic streaming through TransformStream delivers all data correctly
test("TransformStream proxy delivers all data", async () => {
  const TOTAL_CHUNKS = 500;

  await using upstream = Bun.serve({
    port: 0,
    idleTimeout: 255,
    fetch() {
      let i = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (i >= TOTAL_CHUNKS) {
              controller.close();
              return;
            }
            controller.enqueue(Buffer.alloc(25000, 65));
            i++;
          },
        }),
      );
    },
  });

  await using proxy = Bun.serve({
    port: 0,
    idleTimeout: 255,
    async fetch() {
      const res = await fetch(`http://localhost:${upstream.port}/`);
      const transform = new TransformStream({
        transform(chunk, ctrl) {
          ctrl.enqueue(chunk);
        },
      });
      return new Response(res.body!.pipeThrough(transform));
    },
  });

  const response = await fetch(`http://localhost:${proxy.port}/`);
  const body = await response.bytes();
  expect(body.length).toBe(TOTAL_CHUNKS * 25000);
}, 30_000);
