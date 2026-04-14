import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";

const kSettings = Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]);
function pingAck(payload: Buffer) {
  return Buffer.concat([Buffer.from([0, 0, 8, 6, 1, 0, 0, 0, 0]), payload]);
}
const kPingAck = pingAck(Buffer.alloc(8));

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
  try {
    await once(conn, "connect");
    conn.write(Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "ascii"));
    conn.write(kSettings);
    conn.write(kPingAck);

    const err = await errored;
    expect(err).toBeInstanceOf(Error);
    expect((err as NodeJS.ErrnoException).code).toMatch(/^ERR_HTTP2/);
  } finally {
    conn.destroy();
    server.close();
    await once(server, "close");
  }
});

test("server treats PING ACK with mismatched payload as a protocol error per RFC 9113 §6.7", async () => {
  const sentPayload = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const server = http2.createServer();
  const { promise: errored, resolve, reject } = Promise.withResolvers<Error>();
  server.on("session", session => {
    // send a real PING so outStandingPings > 0; the ACK we send back will have a different payload
    session.ping(sentPayload, () => {});
    session.on("error", err => resolve(err as Error));
    session.on("close", () => reject(new Error("session closed without error")));
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;

  const conn = net.connect(port);
  conn.on("error", () => {});
  try {
    await once(conn, "connect");
    conn.write(Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "ascii"));
    conn.write(kSettings);
    // ACK with a payload that does NOT match the PING the server sent
    conn.write(pingAck(Buffer.from([9, 9, 9, 9, 9, 9, 9, 9])));

    const err = await errored;
    expect(err).toBeInstanceOf(Error);
    expect((err as NodeJS.ErrnoException).code).toMatch(/^ERR_HTTP2/);
  } finally {
    conn.destroy();
    server.close();
    await once(server, "close");
  }
});

test("server accepts PING ACK whose payload matches an outstanding PING", async () => {
  const sentPayload = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const server = http2.createServer();
  const { promise: result, resolve, reject } = Promise.withResolvers<Buffer>();
  server.on("session", session => {
    session.ping(sentPayload, (err, _duration, payload) => {
      if (err) reject(err);
      else resolve(payload);
    });
    session.on("error", err => reject(err));
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;

  const conn = net.connect(port);
  conn.on("error", () => {});
  try {
    await once(conn, "connect");
    conn.write(Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "ascii"));
    conn.write(kSettings);
    // ACK with the exact payload the server sent
    conn.write(pingAck(sentPayload));

    const payload = await result;
    expect(Buffer.compare(payload, sentPayload)).toBe(0);
  } finally {
    conn.destroy();
    server.close();
    await once(server, "close");
  }
});
