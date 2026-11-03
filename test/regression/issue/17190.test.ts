// https://github.com/oven-sh/bun/issues/17190
import { expect, test } from "bun:test";
import { tls as selfSigned } from "harness";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import tls from "node:tls";

test("tls.connect() followed at once by end() reports a self-signed certificate", async () => {
  const server = tls.createServer(selfSigned, socket => socket.on("error", () => {}));
  server.on("tlsClientError", () => {});
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const socket = tls.connect({
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      rejectUnauthorized: true,
    });
    const { promise, resolve } = Promise.withResolvers<string>();
    socket.on("error", err => resolve(`error ${(err as NodeJS.ErrnoException).code}`));
    socket.on("close", () => resolve("close with no error"));
    socket.end();
    expect(await promise).toBe("error DEPTH_ZERO_SELF_SIGNED_CERT");
  } finally {
    server.close();
  }
});
