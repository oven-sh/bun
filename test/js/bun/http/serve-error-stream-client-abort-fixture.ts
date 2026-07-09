// A rejected async fetch handler routes through handle_reject(), which renders
// the error() handler's Response. When that body is a ReadableStream,
// handle_reject() then fell through to render_missing(), which end()'d and
// detached the uWS response while the JS stream pump still held the raw res
// pointer in its HTTPResponseSink. The client aborting freed the uWS
// allocation, and the next pull() write read the freed state. ASAN:
// heap-use-after-free in uws_res_has_responded via HTTPServerWritable::write.
//
// The sync-throw path never enters handle_reject(), so it was unaffected.

import net from "node:net";

async function run(variant: "arej" | "await") {
  const handlers = {
    arej: async () => {
      throw new Error("boom");
    },
    await: async () => {
      await Bun.sleep(1);
      throw new Error("boom");
    },
  } as const;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    development: false,
    fetch: handlers[variant],
    error() {
      let n = 0;
      return new Response(
        new ReadableStream({
          async pull(c) {
            if (n++ > 50) return c.close();
            c.enqueue(Buffer.alloc(64, "P").toString());
            await Bun.sleep(4);
          },
        }),
        { status: 597 },
      );
    },
  });

  let aborted = 0;
  try {
    for (let i = 0; i < 4; i++) {
      // Read the first chunk of the error() body, then RST the socket so the
      // server's close path runs while the stream pump is parked in pull().
      await new Promise<void>((resolve, reject) => {
        const s = net.connect(server.port, "127.0.0.1", () => {
          s.write("GET /x HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        });
        s.once("data", () => {
          s.resetAndDestroy();
          aborted++;
          resolve();
        });
        s.once("error", reject);
      });

      // A round-trip after the abort guarantees the server processed the
      // closed socket and is still answering requests.
      await new Promise<void>((resolve, reject) => {
        const s = net.connect(server.port, "127.0.0.1", () => {
          s.write("GET /x HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        });
        let buf = "";
        s.on("data", d => (buf += d.toString()));
        s.on("end", () => (buf.includes("597") ? resolve() : reject(new Error(`no 597 in ${JSON.stringify(buf)}`))));
        s.on("error", reject);
      });
    }
  } finally {
    server.stop(true);
  }
  return aborted;
}

const results: Record<string, number> = {};
for (const variant of ["arej", "await"] as const) {
  results[variant] = await run(variant);
}
console.log(JSON.stringify({ ok: true, ...results }));
