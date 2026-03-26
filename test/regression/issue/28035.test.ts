import { expect, test } from "bun:test";

// Verify that backpressure propagates through fetch().body.pipeThrough(TransformStream)
// so the proxy doesn't eagerly buffer the entire upstream response.
// https://github.com/oven-sh/bun/issues/28035
test("fetch body piped through TransformStream propagates backpressure", async () => {
  const TOTAL_CHUNKS = 800;
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
            controller.enqueue(Buffer.alloc(64000, 65));
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
      const res = await fetch(`http://localhost:${upstream.port}/`);
      const transform = new TransformStream({
        transform(chunk, ctrl) { ctrl.enqueue(chunk); },
      });
      return new Response(res.body!.pipeThrough(transform));
    },
  });

  try {
    const conn = await Bun.connect({
      hostname: "localhost",
      port: proxy.port,
      socket: {
        open(socket) {
          socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
          socket.pause();
        },
        data() {},
        close() {},
        error() {},
        connectError() {},
      },
    });

    // Poll until production stabilizes or all chunks consumed
    let stableCount = 0;
    let lastProduced = 0;
    while (chunksProduced < TOTAL_CHUNKS && stableCount < 3) {
      await Bun.sleep(50);
      if (chunksProduced === lastProduced) stableCount++;
      else { stableCount = 0; lastProduced = chunksProduced; }
    }

    expect(chunksProduced).toBeGreaterThan(0);
    expect(chunksProduced).toBeLessThan(TOTAL_CHUNKS);

    // Resume before stopping to avoid abort assertion with active onWritable
    conn.resume();
    await Bun.sleep(50);
  } finally {
    // Graceful stop — don't forcefully close active connections
    proxy.stop();
    upstream.stop();
  }
});

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
            if (i >= TOTAL_CHUNKS) { controller.close(); return; }
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
        transform(chunk, ctrl) { ctrl.enqueue(chunk); },
      });
      return new Response(res.body!.pipeThrough(transform));
    },
  });

  const response = await fetch(`http://localhost:${proxy.port}/`);
  const body = await response.bytes();
  expect(body.length).toBe(TOTAL_CHUNKS * 25000);
});
