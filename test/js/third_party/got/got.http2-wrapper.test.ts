import { expect, test } from "bun:test";
import got from "got";
import { tls } from "harness";
import http2 from "http2";
import { once } from "events";

test("can make http2 request to local http2 server", async () => {
  const server = http2.createSecureServer(tls);

  server.on("stream", (stream, headers) => {
    stream.respond({
      "content-type": "text/plain",
      ":status": 200,
    });
    stream.end("hello world");
  });

  await once(server.listen(0), "listening");
  const port = (server.address() as any).port;

  const response = await got(`https://localhost:${port}`, {
    http2: true,
    https: {
      certificateAuthority: tls.cert,
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.body).toBe("hello world");

  await new Promise(resolve => server.close(resolve));
});

test("handles http2 stream errors", async () => {
  const server = http2.createSecureServer(tls);

  server.on("stream", stream => {
    stream.destroy(new Error("Stream error"));
  });

  await once(server.listen(0), "listening");
  const port = (server.address() as any).port;

  await expect(
    got(`https://localhost:${port}`, {
      http2: true,
      https: {
        certificateAuthority: tls.cert,
      },
    }),
  ).rejects.toThrow("Stream error");

  await new Promise(resolve => server.close(resolve));
});
