import { expect, test } from "bun:test";
import got from "got";
import { tls } from "harness";
import http2 from "http2";
import { once } from "events";

test("can make http2 request using servername", async () => {
  // actually using a servername
  const response = await got("https://example.com", {
    http2: true,
  });
  expect(response.statusCode).toBe(200);
});
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

test("can make POST request to http2 server", async () => {
  const server = http2.createSecureServer(tls);
  const payload = "test data";

  server.on("stream", async (stream, headers) => {
    let body = "";
    for await (const chunk of stream) {
      body += chunk;
    }
    expect(body).toBe(payload);
    expect(headers[":method"]).toBe("POST");

    stream.respond({
      "content-type": "text/plain",
      ":status": 200,
    });
    stream.end("success");
  });

  await once(server.listen(0), "listening");
  const port = (server.address() as any).port;

  const response = await got.post(`https://localhost:${port}`, {
    http2: true,
    https: {
      certificateAuthority: tls.cert,
    },
    body: payload,
  });

  expect(response.statusCode).toBe(200);
  expect(response.body).toBe("success");

  await new Promise(resolve => server.close(resolve));
});

test("can make HEAD request to http2 server", async () => {
  const server = http2.createSecureServer(tls);

  server.on("stream", (stream, headers) => {
    expect(headers[":method"]).toBe("HEAD");
    stream.respond({
      "content-type": "text/plain",
      "content-length": "11",
      ":status": 200,
    });
    stream.end();
  });

  await once(server.listen(0), "listening");
  const port = (server.address() as any).port;

  const response = await got.head(`https://localhost:${port}`, {
    http2: true,
    https: {
      certificateAuthority: tls.cert,
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.body).toBe("");
  expect(response.headers["content-length"]).toBe("11");

  await new Promise(resolve => server.close(resolve));
});
