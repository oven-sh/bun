import { expect, test } from "bun:test";
import { tls } from "harness";
import http from "http";
import type { AutoRequestOptions } from "http2-wrapper";
import http2Wrapper from "http2-wrapper";

async function doRequest(options: AutoRequestOptions) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const request = await http2Wrapper.auto(options, (response: http.IncomingMessage) => {
    if (response.statusCode !== 200) {
      return reject(new Error(`expected status code 200 rejected: ${response.statusCode}`));
    }

    const body: Array<Buffer> = [];
    response.on("error", reject);
    response.on("data", (chunk: Buffer) => body.push(chunk));
    response.on("end", () => {
      resolve(Buffer.concat(body).toString());
    });
  });

  request.on("error", reject);

  request.end("123456");
  const body = (await promise) as string;
  expect(body).toBeString();
  const parsed = JSON.parse(body);
  expect(parsed.data).toBe("123456");
}

test("should allow http/1.1 when using http2-wrapper", async () => {
  {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(
          JSON.stringify({
            data: await req.text(),
          }),
          {
            headers: {
              "content-type": "application/json",
            },
          },
        );
      },
    });

    await doRequest({
      host: "localhost",
      port: server.port,
      protocol: "http:",
      path: "/post",
      method: "POST",
      headers: {
        "content-length": 6,
      },
    });
  }

  {
    using server = Bun.serve({
      tls,
      port: 0,
      hostname: "localhost",
      async fetch(req) {
        return new Response(
          JSON.stringify({
            data: await req.text(),
          }),
          {
            headers: {
              "content-type": "application/json",
            },
          },
        );
      },
    });
    await doRequest({
      host: "localhost",
      port: server.port,
      protocol: "https:",
      path: "/post",
      method: "POST",
      ca: tls.cert,
      headers: {
        "content-length": 6,
      },
    });
  }
});
