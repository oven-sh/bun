// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  mysqlColumnDefinition,
  mysqlHandshakeV10,
  mysqlLenencInt,
  mysqlOkPacket,
  mysqlRawPacket,
  mysqlReadPackets,
  mysqlTextResultSetRow,
} from "./wire-frames";

// Build a single-column text result set starting at `seq` (column-count packet,
// one ColumnDefinition41, one row, OK-with-0xFE terminator). Returns the bytes
// and the sequence id that would follow the terminator.
function textResultSet(seq: number, columnName: string, value: string): { bytes: Buffer; nextSeq: number } {
  const parts = [
    mysqlRawPacket(seq, mysqlLenencInt(1)),
    mysqlColumnDefinition(seq + 1, { name: columnName, type: 0xfd /* VAR_STRING */ }),
    mysqlTextResultSetRow(seq + 2, [value]),
    mysqlOkPacket(seq + 3, 0xfe),
  ];
  return { bytes: Buffer.concat(parts), nextSeq: seq + 4 };
}

type Settled = { state: "ok"; value: unknown } | { state: "rej"; code: string };
function track(q: Promise<unknown>, into: Record<string, Settled | "unsettled">, key: string) {
  into[key] = "unsettled";
  q.then(
    v => (into[key] = { state: "ok", value: v }),
    e => (into[key] = { state: "rej", code: String(e?.code ?? e) }),
  );
  return q;
}

// A and B share max:1. The server appends an unsolicited GHOST result set
// (seq 5..8) after A's terminator in the same write; B's real response would
// restart at seq 1, so the ghost must fail the connection instead of reaching B.
test("MySQL residual bytes after a completed result set are not delivered to the next queued query", async () => {
  const a = textResultSet(1, "a", "Arow");
  const ghost = textResultSet(a.nextSeq, "g", "GHOST");
  let seenQueries = 0;
  const sockets: import("node:net").Socket[] = [];

  const { port, server } = await listeningServer(socket => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.on("error", () => {});
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      buffered = mysqlReadPackets(buffered, (_seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(2));
          return;
        }
        if (payload[0] === 0x01 /* COM_QUIT */) return socket.end();
        if (payload[0] !== 0x03 /* COM_QUERY */) return socket.write(mysqlOkPacket(1));
        seenQueries += 1;
        // Answer A, and in the same segment append the unsolicited ghost.
        // B's COM_QUERY (seenQueries === 2) is never answered.
        if (seenQueries === 1) socket.write(Buffer.concat([a.bytes, ghost.bytes]));
      });
    });
  });

  const sql = new SQL({
    adapter: "mysql",
    hostname: "127.0.0.1",
    port,
    username: "u",
    password: "",
    database: "d",
    tls: false,
    max: 1,
  });
  try {
    const r: Record<string, Settled | "unsettled"> = {};
    const qa = track(sql.unsafe("select a").simple(), r, "A");
    const qb = track(sql.unsafe("select b").simple(), r, "B");
    await Promise.allSettled([qa, qb]);

    // A settles with its real row regardless of the fix.
    expect(r.A).toEqual({ state: "ok", value: [{ a: "Arow" }] });
    // B MUST NOT resolve with the ghost rows. The connection must fail on the
    // out-of-order packet, rejecting B and every later query.
    expect(r.B).toEqual({ state: "rej", code: "ERR_MYSQL_PACKETS_OUT_OF_ORDER" });
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
    for (const s of sockets) s.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// Same shape with A receiving an ERR packet: trailing ghost bytes carrying
// continuation sequence ids must not be routed to B after the queue advances.
test("MySQL residual bytes after an ERR packet are not delivered to the next queued query", async () => {
  // ERR_Packet: Int<1>(0xff) Int<2>(error_code) '#' String<5>(sql_state) String<EOF>(message)
  const errForA = mysqlRawPacket(
    1,
    Buffer.concat([Buffer.from([0xff, 0x28, 0x04]), Buffer.from("#42000"), Buffer.from("syntax error")]),
  );
  const ghost = textResultSet(2, "g", "GHOST");
  let seenQueries = 0;
  const sockets: import("node:net").Socket[] = [];

  const { port, server } = await listeningServer(socket => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.on("error", () => {});
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      buffered = mysqlReadPackets(buffered, (_seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(2));
          return;
        }
        if (payload[0] === 0x01 /* COM_QUIT */) return socket.end();
        if (payload[0] !== 0x03 /* COM_QUERY */) return socket.write(mysqlOkPacket(1));
        seenQueries += 1;
        if (seenQueries === 1) socket.write(Buffer.concat([errForA, ghost.bytes]));
      });
    });
  });

  const sql = new SQL({
    adapter: "mysql",
    hostname: "127.0.0.1",
    port,
    username: "u",
    password: "",
    database: "d",
    tls: false,
    max: 1,
  });
  try {
    const r: Record<string, Settled | "unsettled"> = {};
    const qa = track(sql.unsafe("select a").simple(), r, "A");
    const qb = track(sql.unsafe("select b").simple(), r, "B");
    await Promise.allSettled([qa, qb]);

    // A was rejected by the server's ERR packet (errno 1064).
    expect(r.A).toMatchObject({ state: "rej" });
    expect((r.A as Settled & { code?: string }).code).not.toBe("ERR_MYSQL_PACKETS_OUT_OF_ORDER");
    // B MUST NOT resolve with the ghost rows.
    expect(r.B).toEqual({ state: "rej", code: "ERR_MYSQL_PACKETS_OUT_OF_ORDER" });
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
    for (const s of sockets) s.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// Baseline: well-formed responses restarting at seq 1 are accepted and each
// query receives its own rows.
test("MySQL sequential queries on one connection each receive their own rows", async () => {
  const answers = [textResultSet(1, "a", "one").bytes, textResultSet(1, "b", "two").bytes];
  let seenQueries = 0;
  const sockets: import("node:net").Socket[] = [];

  const { port, server } = await listeningServer(socket => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.on("error", () => {});
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      buffered = mysqlReadPackets(buffered, (_seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(2));
          return;
        }
        if (payload[0] === 0x01 /* COM_QUIT */) return socket.end();
        if (payload[0] !== 0x03 /* COM_QUERY */) return socket.write(mysqlOkPacket(1));
        const answer = answers[seenQueries++];
        if (answer) socket.write(answer);
      });
    });
  });

  const sql = new SQL({
    adapter: "mysql",
    hostname: "127.0.0.1",
    port,
    username: "u",
    password: "",
    database: "d",
    tls: false,
    max: 1,
  });
  try {
    const [ra, rb] = await Promise.all([sql.unsafe("select a").simple(), sql.unsafe("select b").simple()]);
    expect({ ra, rb }).toEqual({ ra: [{ a: "one" }], rb: [{ b: "two" }] });
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
    for (const s of sockets) s.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// Baseline: a result set with >256 packets wraps the u8 sequence id through
// 255 -> 0; the validation must accept the wrapped sequence and the follow-up
// query must still be accepted after the reset.
test("MySQL sequence-id validation accepts the 255->0 wrap within a result set", async () => {
  const rowCount = 300;
  function bigResultSet(): Buffer {
    let seq = 1;
    const parts: Buffer[] = [
      mysqlRawPacket(seq++, mysqlLenencInt(1)),
      mysqlColumnDefinition(seq++, { name: "n", type: 0xfd }),
    ];
    for (let i = 0; i < rowCount; i++) parts.push(mysqlTextResultSetRow(seq++ & 0xff, [String(i)]));
    parts.push(mysqlOkPacket(seq & 0xff, 0xfe));
    return Buffer.concat(parts);
  }
  const answers = [bigResultSet(), textResultSet(1, "after", "ok").bytes];
  let seenQueries = 0;
  const sockets: import("node:net").Socket[] = [];

  const { port, server } = await listeningServer(socket => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.on("error", () => {});
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      buffered = mysqlReadPackets(buffered, (_seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(2));
          return;
        }
        if (payload[0] === 0x01 /* COM_QUIT */) return socket.end();
        if (payload[0] !== 0x03 /* COM_QUERY */) return socket.write(mysqlOkPacket(1));
        const answer = answers[seenQueries++];
        if (answer) socket.write(answer);
      });
    });
  });

  const sql = new SQL({
    adapter: "mysql",
    hostname: "127.0.0.1",
    port,
    username: "u",
    password: "",
    database: "d",
    tls: false,
    max: 1,
  });
  try {
    const big = (await sql.unsafe("select n").simple()) as Array<{ n: string }>;
    expect(big.length).toBe(rowCount);
    expect({ first: big[0], last: big[rowCount - 1] }).toEqual({
      first: { n: "0" },
      last: { n: String(rowCount - 1) },
    });
    const after = await sql.unsafe("select after").simple();
    expect(after).toEqual([{ after: "ok" }]);
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
    for (const s of sockets) s.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
