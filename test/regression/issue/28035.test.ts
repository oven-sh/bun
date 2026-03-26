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
      // causing uWS to report backpressure.
      const { promise: done, resolve: finish } = Promise.withResolvers<void>();

      const conn = await Bun.connect({
        hostname: "localhost",
        port: proxy.port,
        socket: {
          open(socket) {
            socket.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n");
            socket.pause();
          },
          data() {},
          close() { finish(); },
          error() { finish(); },
          connectError() { finish(); },
        },
      });

      // Poll until production stabilizes (backpressure stalls it) or
      // all chunks are consumed (no backpressure). Awaiting a
      // condition instead of sleeping a fixed duration.
      let stableCount = 0;
      let lastProduced = 0;
      while (chunksProduced < TOTAL_CHUNKS && stableCount < 5) {
        await Bun.sleep(200);
        if (chunksProduced === lastProduced) {
          stableCount++;
        } else {
          stableCount = 0;
          lastProduced = chunksProduced;
        }
      }
      const chunksWhilePaused = chunksProduced;

      // Resume reading so the connection can close cleanly
      conn.resume();
      await done;
      proxy.stop(true);
      upstream.stop(true);
      console.log(JSON.stringify({
        chunksWhilePaused,
        TOTAL_CHUNKS,
        backpressureObserved: chunksWhilePaused < TOTAL_CHUNKS,
      }));
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
  expect(jsonLine).toBeDefined();
  const result = JSON.parse(jsonLine!);
  expect(result.chunksWhilePaused).toBeGreaterThan(0);

  // With backpressure: production stalls before all chunks are consumed
  // Without backpressure: all chunks consumed eagerly
  expect(result.backpressureObserved).toBe(true);
  expect(exitCode).toBe(0);
});

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
});
