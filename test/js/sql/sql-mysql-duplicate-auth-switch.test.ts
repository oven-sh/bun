// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// A server (or MITM on the default non-TLS path) that answers every client
// auth packet with another AuthSwitchRequest (0xFE) drove the client into an
// unbounded auth ping-pong at 100% CPU, and connectionTimeout never fired
// because every arriving handshake packet re-armed the connect-phase timer.
// mysql2 and libmysqlclient refuse a second AuthSwitchRequest; Bun now does
// the same, and connectionTimeout is an absolute connect→ready deadline.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  mysqlAuthSwitchRequest,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
} from "./wire-frames";

test("MySQL: a second AuthSwitchRequest is rejected, not answered again", async () => {
  let responses = 0;
  const sockets = new Set<import("node:net").Socket>();
  const { server, port } = await listeningServer(socket => {
    sockets.add(socket);
    let buffered = Buffer.alloc(0);
    let sawHandshakeResponse = false;
    socket.write(mysqlHandshakeV10());
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), seq => {
        if (!sawHandshakeResponse) {
          sawHandshakeResponse = true;
          socket.write(mysqlAuthSwitchRequest(seq + 1, "mysql_native_password", Buffer.alloc(20, 0x61)));
          return;
        }
        responses++;
        if (responses >= 50) {
          socket.destroy();
          return;
        }
        socket.write(mysqlAuthSwitchRequest(seq + 1, "mysql_native_password", Buffer.alloc(20, 0x62)));
      });
    });
  });

  const db = new SQL({
    adapter: "mysql",
    hostname: "127.0.0.1",
    port,
    username: "u",
    password: "pw",
    database: "d",
    tls: false,
    max: 1,
    connectionTimeout: 30,
  });
  let err: any;
  try {
    await db.unsafe("SELECT 1");
    err = { code: "UNEXPECTED_SUCCESS" };
  } catch (e: any) {
    err = { code: e?.code ?? String(e) };
  } finally {
    await db.close({ timeout: 0 });
    for (const s of sockets) s.destroy();
    await new Promise<void>(r => server.close(() => r()));
  }
  // The client must answer the first AuthSwitchRequest (responses == 1) and
  // then error on the duplicate without answering it. Before the fix
  // `responses` hit the limit.
  expect({ err, responses }).toEqual({
    err: { code: "ERR_MYSQL_UNEXPECTED_PACKET" },
    responses: 1,
  });
});

test("MySQL: a single AuthSwitchRequest then OK still connects", async () => {
  // Boundary: the normal one-switch happy path must still work.
  let responses = 0;
  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let phase = 0;
    socket.write(mysqlHandshakeV10({ authPlugin: "caching_sha2_password" }));
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), seq => {
        if (phase === 0) {
          phase = 1;
          socket.write(mysqlAuthSwitchRequest(seq + 1, "mysql_native_password", Buffer.alloc(20, 0x62)));
        } else if (phase === 1) {
          phase = 2;
          responses++;
          socket.write(mysqlOkPacket(seq + 1));
        }
      });
    });
  });

  try {
    await using db = new SQL({
      adapter: "mysql",
      hostname: "127.0.0.1",
      port,
      username: "u",
      password: "pw",
      database: "d",
      tls: false,
      max: 1,
    });
    await expect(db.connect()).resolves.toBeDefined();
    expect(responses).toBe(1);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test("MySQL: connectionTimeout bounds the whole handshake, not per packet", async () => {
  // Server that trickles the greeting one byte at a time, each well under
  // connectionTimeout. Before the fix each byte re-armed the connect timer so
  // the client waited indefinitely; now it fails once the overall deadline
  // passes.
  const greeting = mysqlHandshakeV10();
  const sockets = new Set<import("node:net").Socket>();
  const { server, port } = await listeningServer(socket => {
    sockets.add(socket);
    let i = 0;
    const id = setInterval(() => {
      if (socket.destroyed || i >= greeting.length) {
        clearInterval(id);
        return;
      }
      socket.write(greeting.subarray(i, i + 1));
      i++;
    }, 200);
    socket.on("error", () => {});
    socket.on("close", () => {
      clearInterval(id);
      sockets.delete(socket);
    });
  });

  const t0 = performance.now();
  const db = new SQL({
    adapter: "mysql",
    hostname: "127.0.0.1",
    port,
    username: "u",
    password: "pw",
    database: "d",
    tls: false,
    max: 1,
    connectionTimeout: 1,
  });
  try {
    const err = await db.unsafe("SELECT 1").then(
      () => ({ code: "UNEXPECTED_SUCCESS" }),
      (e: any) => ({ code: e?.code ?? String(e) }),
    );
    const elapsed = performance.now() - t0;
    // The greeting is ~80 bytes @ 200ms/byte ≈ 16s; the 1s connectionTimeout
    // must win well before then. Allow generous slack for debug/ASAN.
    expect(err).toEqual({ code: "ERR_MYSQL_CONNECTION_TIMEOUT" });
    expect(elapsed).toBeLessThan(8000);
  } finally {
    await db.close({ timeout: 0 });
    for (const s of sockets) s.destroy();
    await new Promise<void>(r => server.close(() => r()));
  }
});
