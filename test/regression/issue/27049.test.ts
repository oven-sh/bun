import { expect, test } from "bun:test";
import http from "node:http";

test("ClientRequest.setHeaders should not throw ERR_HTTP_HEADERS_SENT on new request", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(req.headers.get("x-test") ?? "missing");
    },
  });

  const { resolve, reject, promise } = Promise.withResolvers<string>();

  const req = http.request(`http://localhost:${server.port}/test`, { method: "GET" }, res => {
    let data = "";
    res.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    res.on("end", () => resolve(data));
  });

  req.on("error", reject);

  // This should not throw - headers haven't been sent yet
  req.setHeaders(new Headers({ "x-test": "value" }));

  req.end();

  const body = await promise;
  expect(body).toBe("value");
});

test("ClientRequest.setHeaders works with Map", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(req.headers.get("x-map-test") ?? "missing");
    },
  });

  const { resolve, reject, promise } = Promise.withResolvers<string>();

  const req = http.request(`http://localhost:${server.port}/test`, { method: "GET" }, res => {
    let data = "";
    res.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    res.on("end", () => resolve(data));
  });

  req.on("error", reject);

  req.setHeaders(new Map([["x-map-test", "map-value"]]));

  req.end();

  const body = await promise;
  expect(body).toBe("map-value");
});

test("ServerResponse.setHeaders should not throw before headers are sent", async () => {
  const { resolve, reject, promise } = Promise.withResolvers<string>();

  const server = http.createServer((req, res) => {
    // This should not throw - headers haven't been sent yet
    res.setHeaders(new Headers({ "x-custom": "server-value" }));
    res.writeHead(200);
    res.end("ok");
  });

  try {
    server.listen(0, () => {
      const port = (server.address() as any).port;
      try {
        const req = http.request(`http://localhost:${port}/test`, res => {
          resolve(res.headers["x-custom"] as string);
        });
        req.on("error", reject);
        req.end();
      } catch (e) {
        reject(e);
      }
    });

    expect(await promise).toBe("server-value");
  } finally {
    server.close();
  }
});
