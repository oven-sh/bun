/**
 * A client request that ends with its HEADERS frame may declare a content-length. The client
 * sends it as given. The server compares the declared length with the body it received
 * (RFC 9113 section 8.1.1): 0 matches an empty body, any other value is a stream
 * PROTOCOL_ERROR from the server.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-request-content-length.test.ts
 *   node --test test/js/node/http2/node-http2-request-content-length.test.ts
 */
import assert from "node:assert";
import http2 from "node:http2";
import { test } from "node:test";

const { NGHTTP2_PROTOCOL_ERROR } = http2.constants;

type Outcome = { status: number | undefined; code: string | undefined; rstCode: number };

test("a bodiless request that declares content-length is judged by the server", async () => {
  const server = http2.createServer();
  const seen: [string, string][] = [];
  server.on("stream", (stream, headers) => {
    seen.push([headers[":method"] as string, headers["content-length"] as string]);
    stream.respond({ ":status": 200 });
    stream.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const client = http2.connect(`http://127.0.0.1:${port}`);
  const sessionError = new Promise<never>((_, reject) => client.once("error", reject));

  const send = (method: string, contentLength: string): Promise<Outcome> =>
    Promise.race([
      sessionError,
      new Promise<Outcome>(resolve => {
        const req = client.request({ ":method": method, ":path": "/x", "content-length": contentLength });
        let status: number | undefined;
        let code: string | undefined;
        req.on("response", headers => (status = headers[":status"]));
        req.on("error", err => (code = (err as NodeJS.ErrnoException).code));
        req.on("close", () => resolve({ status, code, rstCode: req.rstCode }));
        req.resume();
      }),
    ]);

  try {
    assert.deepStrictEqual(await send("DELETE", "0"), { status: 200, code: undefined, rstCode: 0 });
    assert.deepStrictEqual(await send("GET", "0"), { status: 200, code: undefined, rstCode: 0 });
    assert.deepStrictEqual(await send("HEAD", "0"), { status: 200, code: undefined, rstCode: 0 });
    assert.deepStrictEqual(await send("DELETE", "5"), {
      status: undefined,
      code: "ERR_HTTP2_STREAM_ERROR",
      rstCode: NGHTTP2_PROTOCOL_ERROR,
    });
    assert.deepStrictEqual(seen, [
      ["DELETE", "0"],
      ["GET", "0"],
      ["HEAD", "0"],
    ]);
  } finally {
    client.close();
    server.close();
  }
});
