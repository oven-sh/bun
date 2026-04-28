/**
 * Regression test for GitHub Issue #14958
 *
 * http2.connect() should accept a TLSSocket supplied via createConnection
 * even when socket.alpnProtocol is not the string "h2" (e.g. undefined, as
 * happens with sockets from http2-wrapper). Node.js does not validate
 * alpnProtocol on the client side; it simply records the value.
 */
import { expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import tls from "node:tls";

test("http2.connect accepts TLSSocket via createConnection when alpnProtocol is undefined", async () => {
  const server = http2.createSecureServer({ key: tlsCert.key, cert: tlsCert.cert });
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const socket = tls.connect({ host: "127.0.0.1", port, ALPNProtocols: ["h2"], rejectUnauthorized: false });
  await once(socket, "secureConnect");
  // Simulate http2-wrapper-style sockets where alpnProtocol is not propagated.
  Object.defineProperty(socket, "alpnProtocol", { value: undefined, configurable: true });

  const client = http2.connect(`https://127.0.0.1:${port}`, { createConnection: () => socket });
  const errors: Error[] = [];
  client.on("error", err => errors.push(err));
  await once(client, "connect");
  expect(errors).toEqual([]);

  const req = client.request({ ":path": "/" });
  req.setEncoding("utf8");
  let body = "";
  req.on("data", c => (body += c));
  req.end();
  const [headers] = await once(req, "response");
  expect(headers[":status"]).toBe(200);
  await once(req, "end");
  expect(body).toBe("ok");

  const closed = new Promise<void>(r => client.close(() => r()));
  await closed;
  server.close();
  await once(server, "close");
});
