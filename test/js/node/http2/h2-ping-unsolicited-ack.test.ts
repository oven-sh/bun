import { test, expect } from "bun:test";
import http2 from "node:http2";
import net from "node:net";
import { once } from "node:events";

const kSettings = Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]);
const kPingAck = Buffer.from([0, 0, 8, 6, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

test("server treats unsolicited PING ACK as a protocol error per RFC 9113 §6.7", async () => {
  const server = http2.createServer();
  const { promise: errored, resolve, reject } = Promise.withResolvers<Error>();
  server.on("session", session => {
    session.on("error", err => resolve(err as Error));
    session.on("close", () => reject(new Error("session closed without error")));
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;

  const conn = net.connect(port);
  conn.on("error", () => {});
  await once(conn, "connect");
  conn.write(Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "ascii"));
  conn.write(kSettings);
  conn.write(kPingAck);

  const err = await errored;
  expect(err).toBeInstanceOf(Error);
  expect((err as NodeJS.ErrnoException).code).toMatch(/^ERR_HTTP2/);

  conn.destroy();
  server.close();
  await once(server, "close");
});
