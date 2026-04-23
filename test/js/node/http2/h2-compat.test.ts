import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";

test("Http2Stream.state.weight defaults to 16 per RFC 9113", async () => {
  const server = http2.createServer();
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  server.on("stream", stream => {
    try {
      resolve(stream.state.weight);
    } catch (e) {
      reject(e);
    }
    stream.respond({ ":status": 200 });
    stream.end();
  });
  server.on("error", reject);
  server.listen(0);
  await once(server, "listening");
  const client = http2.connect(`http://127.0.0.1:${(server.address() as any).port}`);
  client.on("error", reject);
  try {
    const req = client.request({ ":path": "/" });
    req.on("error", reject);
    req.resume();
    req.end();
    const weight = await promise;
    expect(weight).toBe(16);
    await once(req, "close");
  } finally {
    client.close();
    server.close();
    await once(server, "close").catch(() => {});
  }
});
