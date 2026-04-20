import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";

test("server rejects request with non-zero content-length and END_STREAM per RFC 9113 8.6", async () => {
  const server = http2.createServer();
  let streamCount = 0;
  server.on("stream", stream => {
    streamCount++;
    stream.respond({ ":status": 200 });
    stream.end();
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as any).port;

  const client = http2.connect("http://127.0.0.1:" + port);
  try {
    const req = client.request({ ":method": "POST", "content-length": "10" }, { endStream: true });
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    req.on("error", () => {});
    req.on("close", () => resolve());
    req.end();
    await closed;

    expect(streamCount).toBe(0);
    expect(req.rstCode).toBe(http2.constants.NGHTTP2_PROTOCOL_ERROR);
  } finally {
    client.close();
    server.close();
    await once(server, "close");
  }
});

test("server accepts request with content-length, body, and trailers", async () => {
  const server = http2.createServer();
  const { promise: gotTrailers, resolve: resolveTrailers } = Promise.withResolvers<Record<string, string>>();
  server.on("stream", stream => {
    stream.on("trailers", headers => resolveTrailers(headers as Record<string, string>));
    stream.on("error", () => {});
    stream.respond({ ":status": 200 });
    stream.resume();
    stream.end();
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as any).port;

  const client = http2.connect("http://127.0.0.1:" + port);
  try {
    const req = client.request(
      { ":method": "POST", "content-length": "10" },
      { endStream: false, waitForTrailers: true },
    );
    req.on("error", () => {});
    req.on("wantTrailers", () => req.sendTrailers({ "x-trailer": "ok" }));
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    req.on("close", () => resolve());
    req.write("0123456789");
    req.end();
    const trailers = await gotTrailers;
    await closed;

    expect(trailers["x-trailer"]).toBe("ok");
    expect(req.rstCode).toBe(http2.constants.NGHTTP2_NO_ERROR);
  } finally {
    client.close();
    server.close();
    await once(server, "close");
  }
});
