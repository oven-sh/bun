import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";

test("CONNECT method pseudo-header validation per RFC 9113 §8.5", async () => {
  const server = http2.createServer();
  server.on("stream", s => s.close());
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as any).port;
  const client = http2.connect("http://127.0.0.1:" + port);
  await once(client, "connect");

  try {
    expect(() => client.request({ ":method": "CONNECT" })).toThrow(
      expect.objectContaining({ code: "ERR_HTTP2_CONNECT_AUTHORITY" }),
    );
    expect(() => client.request({ ":method": "CONNECT", ":authority": "" })).toThrow(
      expect.objectContaining({ code: "ERR_HTTP2_CONNECT_AUTHORITY" }),
    );
    expect(() => client.request({ ":method": "CONNECT", ":authority": "example.com:443", ":scheme": "https" })).toThrow(
      expect.objectContaining({ code: "ERR_HTTP2_CONNECT_SCHEME" }),
    );
    expect(() => client.request({ ":method": "CONNECT", ":authority": "example.com:443", ":path": "/" })).toThrow(
      expect.objectContaining({ code: "ERR_HTTP2_CONNECT_PATH" }),
    );
  } finally {
    client.destroy();
    server.close();
    await once(server, "close");
  }
});
