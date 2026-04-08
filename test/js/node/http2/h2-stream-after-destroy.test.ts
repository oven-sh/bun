import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";

test("stream.session is undefined and stream.state is {} after session.destroy()", async () => {
  const server = http2.createServer();
  let resolveStream: (s: any) => void;
  const streamP = new Promise<any>(r => (resolveStream = r));
  server.on("stream", s => {
    s.respond({ ":status": 200 });
    s.end();
    resolveStream(s);
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as any).port;
  const client = http2.connect(`http://127.0.0.1:${port}`);
  const req = client.request({ ":path": "/" });
  req.resume();
  req.end();
  const serverStream = await streamP;
  await once(req, "end");
  serverStream.session?.destroy();
  await Bun.sleep(50);
  expect(serverStream.session).toBeUndefined();
  expect(serverStream.state).toEqual({});
  client.close();
  server.close();
});
