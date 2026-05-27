import { expect, it } from "bun:test";
import http, { Server } from "node:http";
import type { AddressInfo } from "node:net";

// https://github.com/oven-sh/bun/issues/31474
// A refused connection must surface the full Node.js error shape
// (errno/syscall/address/port and a `connect ECONNREFUSED <host>:<port>`
// message), not a bare `Error: ECONNREFUSED`.

// Bind then release a port so connecting to it is refused.
async function refusedPort(): Promise<number> {
  const probe = new Server();
  const port = await new Promise<number>(resolve => {
    probe.listen(0, "127.0.0.1", () => resolve((probe.address() as AddressInfo).port));
  });
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

it("request to a refused port reports a Node-shaped ECONNREFUSED", async () => {
  const port = await refusedPort();

  const { promise, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException>();
  const req = http.request({ hostname: "127.0.0.1", port, path: "/", method: "GET", timeout: 5000 }, () =>
    reject(new Error("Expected request to fail")),
  );
  req.on("error", resolve);
  req.end();

  const error = await promise;
  // uv's negative errno for a refused connection (identical in Bun and Node).
  const { UV_ECONNREFUSED } = process.binding("uv");
  expect(error.code).toBe("ECONNREFUSED");
  expect(error.errno).toBe(UV_ECONNREFUSED);
  expect(error.syscall).toBe("connect");
  expect(error.address).toBe("127.0.0.1");
  expect(error.port).toBe(port);
  expect(error.message).toBe(`connect ECONNREFUSED 127.0.0.1:${port}`);
});

it("reports error.port as a number even when options.port is a string", async () => {
  const port = await refusedPort();

  const { promise, resolve, reject } = Promise.withResolvers<NodeJS.ErrnoException>();
  // Pass the port as a string — Node normalizes error.port to a number.
  const req = http.request({ hostname: "127.0.0.1", port: String(port), path: "/", method: "GET", timeout: 5000 }, () =>
    reject(new Error("Expected request to fail")),
  );
  req.on("error", resolve);
  req.end();

  const error = await promise;
  expect(error.code).toBe("ECONNREFUSED");
  expect(error.port).toBe(port);
  expect(typeof error.port).toBe("number");
  expect(error.message).toBe(`connect ECONNREFUSED 127.0.0.1:${port}`);
});
