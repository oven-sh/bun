import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";

test("Http2Stream.state.weight defaults to 16 per RFC 9113", async () => {
  const server = http2.createServer();
  const { promise, resolve } = Promise.withResolvers<number>();
  server.on("stream", stream => {
    resolve(stream.state.weight);
    stream.respond({ ":status": 200 });
    stream.end();
  });
  server.listen(0);
  await once(server, "listening");
  const client = http2.connect(`http://127.0.0.1:${(server.address() as any).port}`);
  const req = client.request({ ":path": "/" });
  req.resume();
  req.end();
  const weight = await promise;
  expect(weight).toBe(16);
  await once(req, "close");
  client.close();
  server.close();
  await once(server, "close");
});
