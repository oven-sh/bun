import { createTest } from "node-harness";
import { request } from "node:http";
const { expect } = createTest(import.meta.path);

// just simulate some file that will take forever to download
const payload = Buffer.alloc(128 * 1024, "X");
for (let i = 0; i < 5; i++) {
  let sendedByteLength = 0;
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      let running = true;
      req.signal.onabort = () => (running = false);
      return new Response(async function* () {
        while (running) {
          sendedByteLength += payload.byteLength;
          yield payload;
          await Bun.sleep(10);
        }
      });
    },
  });

  async function run() {
    let receivedByteLength = 0;
    let { promise, resolve } = Promise.withResolvers();
    const req = request(server.url, res => {
      res.on("data", data => {
        receivedByteLength += data.length;
        if (resolve) {
          resolve();
          resolve = null;
        }
      });
    });
    req.end();
    await promise;
    req.destroy();
    await Bun.sleep(10);
    const initialByteLength = receivedByteLength;
    // we should receive the same amount of data we sent
    expect(initialByteLength).toBeLessThanOrEqual(sendedByteLength);
    await Bun.sleep(10);
    // we should not receive more data after destroy
    expect(initialByteLength).toBe(receivedByteLength);
    await Bun.sleep(10);
  }

  const runCount = 50;
  const runs = Array.from({ length: runCount }, run);
  await Promise.all(runs);
  Bun.gc(true);
  await Bun.sleep(10);
}
