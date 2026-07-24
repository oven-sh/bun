// Spec-compliance self-test for the wire-frames builders. The fault-injection
// tests in this directory hand-roll Postgres/MySQL protocol frames; if a
// builder's byte layout ever drifts from what Bun's own parser accepts, this
// file goes red before any of the dependent tests do.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  mysqlHandshakeV10,
  mysqlLenencInt,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlTextResultSet,
  pgAuthenticationOk,
  pgCommandComplete,
  pgCopyData,
  pgCopyDone,
  pgCopyOutResponse,
  pgDataRow,
  pgErrorResponse,
  pgMinimalReadyServer,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

test("mysqlLenencInt encodes per page_protocol_basic_dt_integers.html", () => {
  expect(mysqlLenencInt(0)).toEqual(Buffer.from([0x00]));
  expect(mysqlLenencInt(250)).toEqual(Buffer.from([0xfa]));
  expect(mysqlLenencInt(251)).toEqual(Buffer.from([0xfc, 0xfb, 0x00]));
  expect(mysqlLenencInt(0xffff)).toEqual(Buffer.from([0xfc, 0xff, 0xff]));
  expect(mysqlLenencInt(0x1_0000)).toEqual(Buffer.from([0xfd, 0x00, 0x00, 0x01]));
  expect(mysqlLenencInt(0xff_ffffn)).toEqual(Buffer.from([0xfd, 0xff, 0xff, 0xff]));
  expect(mysqlLenencInt(0x1_00_0000n)).toEqual(Buffer.from([0xfe, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]));
});

test("pgErrorResponse encodes per §55.7", () => {
  expect(pgErrorResponse({ S: "FATAL", C: "57P03", M: "x" })).toEqual(
    Buffer.from("E\x00\x00\x00\x16SFATAL\x00C57P03\x00Mx\x00\x00", "binary"),
  );
});

test("postgres: pgAuthenticationOk + pgReadyForQuery are accepted by Bun's parser", async () => {
  // Minimal Postgres mock: on the startup packet, reply AuthenticationOk +
  // ReadyForQuery. connect() resolving proves both frames decode.
  const { port, server } = await listeningServer(socket => {
    socket.once("data", () => {
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
    });
  });
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1 });
  try {
    await expect(db.connect()).resolves.toBeDefined();
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

test("postgres: COPY OUT response frames are consumed and the following result set decodes", async () => {
  const { port, server } = await listeningServer(socket => {
    socket.on("error", () => {});
    let startup = true;
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      if (data[0] !== 0x51) return;
      socket.end(
        Buffer.concat([
          pgCopyOutResponse([0]),
          pgCopyData(Buffer.from("1\n")),
          pgCopyData(Buffer.from("2\n")),
          pgCopyDone(),
          pgCommandComplete("COPY 2"),
          pgRowDescription([{ name: "y", typeOid: 25 }]),
          pgDataRow([Buffer.from("2")]),
          pgCommandComplete("SELECT 1"),
          pgReadyForQuery(),
        ]),
      );
    });
  });

  const db = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });
  try {
    const result = await db`copy t to stdout; select 2 as y`.simple();
    expect(result).toEqual([[], [{ y: "2" }]]);
  } finally {
    await db.close().catch(() => {});
    await new Promise<void>(r => server.close(() => r()));
  }
});

test("postgres: pgMinimalReadyServer satisfies connect()", async () => {
  const { port, server } = await pgMinimalReadyServer();
  const db = new SQL({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1 });
  try {
    await expect(db.connect()).resolves.toBeDefined();
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

test("mysql: mysqlHandshakeV10 + mysqlOkPacket are accepted by Bun's parser", async () => {
  // Minimal MySQL mock: send HandshakeV10 on accept, reply OK to the
  // HandshakeResponse41. connect() resolving proves both frames decode.
  const { port, server } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), seq => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
        }
      });
    });
    socket.on("error", () => {});
  });
  // Empty password so the mysql_native_password scramble is empty and the mock
  // can OK it without validating.
  const db = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
  try {
    await expect(db.connect()).resolves.toBeDefined();
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});

// Every server->client frame trickles out one byte per event-loop turn, so the
// client's `on_data()` sees a partial packet, stashes the tail in
// `read_buffer`, and resumes through the buffered reader on the next chunk.
// Reaching the final row means `mark_message_start` / `set_offset_from_start` /
// `skip` kept the buffered reader's cursor consistent across every packet
// boundary (handshake, auth OK, column count, column defs, rows, terminator).
test("mysql: byte-at-a-time framing drives the buffered-reader resume path through a full result set", async () => {
  const COM_QUERY = 0x03;
  const MYSQL_TYPE_VAR_STRING = 0xfd;
  // One byte per event-loop turn so the kernel cannot coalesce consecutive
  // writes into a single TCP segment before the client's on_data fires.
  const trickle = async (socket: import("node:net").Socket, frame: Buffer) => {
    for (let i = 0; i < frame.length; i++) {
      socket.write(frame.subarray(i, i + 1));
      await new Promise<void>(r => setImmediate(r));
    }
  };
  const { port, server } = await listeningServer(socket => {
    socket.setNoDelay(true);
    let buffered = Buffer.alloc(0);
    let authed = false;
    void trickle(socket, mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          void trickle(socket, mysqlOkPacket(seq + 1));
          return;
        }
        if (payload[0] === COM_QUERY) {
          void trickle(
            socket,
            mysqlTextResultSet(
              1,
              [
                { name: "a", type: MYSQL_TYPE_VAR_STRING },
                { name: "b", type: MYSQL_TYPE_VAR_STRING },
              ],
              [
                ["one", "1"],
                ["two", "2"],
              ],
            ),
          );
        } else {
          socket.end();
        }
      });
    });
    socket.on("error", () => {});
  });

  const db = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
  try {
    const rows = await db`SELECT a, b`.simple();
    expect(rows).toEqual([
      { a: "one", b: "1" },
      { a: "two", b: "2" },
    ]);
  } finally {
    await db.close({ timeout: 0 });
    server.close();
  }
});
