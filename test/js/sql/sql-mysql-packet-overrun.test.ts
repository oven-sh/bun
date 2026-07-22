// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// Every MySQL packet carries an Int<3> payload length in its header. The body
// decoders (result-set rows, column definitions, OK packets) then read
// length-encoded fields whose claimed sizes are themselves server-controlled.
// A lenenc length that exceeds the enclosing packet's payload_length is a
// malformed packet (mysql2: "Malformed packet"), and a decoder that trusts the
// inner lenenc over the outer packet boundary either (a) reads the next,
// already-buffered packet's header/body bytes and returns them as column data,
// or (b) returns ShortRead when no next packet is buffered, which the dispatch
// loop treats as "wait for more socket data" so the query and everything queued
// behind it pend forever. Both must reject with ERR_MYSQL_MALFORMED_PACKET.
import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
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

const MYSQL_TYPE_VAR_STRING = 0xfd;

// One mock MySQL server for the whole file: completes the handshake, OKs the
// client's HandshakeResponse41, then replies to the first COM_QUERY with
// whatever `nextReply` holds and ignores later queries. Leaving the socket open
// after replying is deliberate: a ShortRead-wedged client only fails if the
// socket closes, so closing here would mask the wedge face.
let nextReply!: Buffer;
const sockets = new Set<import("node:net").Socket>();
const mock = await listeningServer(socket => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  const reply = nextReply;
  let buffered = Buffer.alloc(0);
  let authed = false;
  let answered = false;
  socket.write(mysqlHandshakeV10());
  socket.on("data", chunk => {
    buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (_seq, payload) => {
      if (!authed) {
        authed = true;
        socket.write(mysqlOkPacket(2));
        return;
      }
      if (payload[0] !== 0x03 /* COM_QUERY */) return;
      if (answered) return;
      answered = true;
      socket.write(reply);
    });
  });
  socket.on("error", () => {});
});
afterAll(() => {
  for (const s of sockets) s.destroy();
  return new Promise<void>(r => mock.server.close(() => r()));
});

type Outcome = { ok: unknown[] } | { err: string };

async function run(reply: Buffer): Promise<Outcome> {
  nextReply = reply;
  const sql = new SQL({
    adapter: "mysql",
    hostname: "127.0.0.1",
    port: mock.port,
    username: "u",
    password: "",
    database: "d",
    tls: false,
    max: 1,
  });
  try {
    return await sql
      .unsafe("select x")
      .simple()
      .then(
        rows => ({ ok: (rows as unknown as { x: unknown }[]).map(r => r.x) }),
        e => ({ err: e?.code ?? String(e) }),
      );
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
  }
}

// A single VAR_STRING column "x" so the row-decoding branch is reached.
const oneColumnHeader = Buffer.concat([
  mysqlRawPacket(1, mysqlLenencInt(1)),
  mysqlColumnDefinition(2, { name: "x", type: MYSQL_TYPE_VAR_STRING }),
]);

// --- (b) wedge: lenenc claims bytes that never arrive -----------------------

const wedgeCases: { name: string; reply: Buffer }[] = [
  {
    // Row body is [0xfc, 0x2c, 0x01, 'a', 'b', 'c'] — a lenenc-string claiming
    // 300 bytes but supplying 3. With no per-packet bound the decoder returns
    // ShortRead and the dispatch loop waits forever for bytes that never come.
    name: "text-protocol row whose lenenc field overruns the packet",
    reply: Buffer.concat([
      oneColumnHeader,
      mysqlRawPacket(3, Buffer.concat([Buffer.from([0xfc, 0x2c, 0x01]), Buffer.from("abc")])),
    ]),
  },
  {
    // ColumnDefinition41's first field is string<lenenc> catalog. Claim 300
    // bytes in a packet that only has 3 so the overrun fires during column
    // definition decoding (before any rows).
    name: "column definition whose lenenc catalog overruns the packet",
    reply: Buffer.concat([
      mysqlRawPacket(1, mysqlLenencInt(1)),
      mysqlRawPacket(2, Buffer.concat([Buffer.from([0xfc, 0x2c, 0x01]), Buffer.from("def")])),
    ]),
  },
];

test.each(wedgeCases)("mysql: $name fails the query instead of wedging", async ({ reply }) => {
  // Pre-fix this test times out: the query never settles.
  expect(await run(reply)).toEqual({ err: "ERR_MYSQL_MALFORMED_PACKET" });
});

// --- (a) leak: overrun reads into the NEXT packet's bytes -------------------

test("mysql: a lenenc field overrunning into an already-buffered next packet is rejected, not served as data", async () => {
  // Row packet body is [0x08] — a lenenc-string claiming 8 bytes but supplying 0.
  // The next row packet and the 0xFE terminator are sent in the same write, so
  // an unbounded decoder reads the following packet's header/body bytes as this
  // row's column value and still finds a terminator, returning a phantom row
  // whose bytes are protocol framing. With the per-packet bound the row packet
  // is rejected before any next-packet bytes are touched.
  const got = await run(
    Buffer.concat([
      oneColumnHeader,
      mysqlRawPacket(3, Buffer.from([0x08])),
      mysqlTextResultSetRow(4, ["real"]),
      mysqlOkPacket(5, 0xfe),
    ]),
  );
  expect(got).toEqual({ err: "ERR_MYSQL_MALFORMED_PACKET" });
});

test("mysql: a zero-length row packet is rejected, not decoded from the next packet's header", async () => {
  // A length-0 row packet has no lenenc byte at all; an unbounded peek() reads
  // the following packet's header byte as the lenenc prefix. Here that byte is
  // 0x05 (the next packet's payload_length low byte), so the unbounded decoder
  // reads 5 "data" bytes out of the NEXT packet's framing and body.
  const got = await run(
    Buffer.concat([
      oneColumnHeader,
      mysqlRawPacket(3, Buffer.alloc(0)),
      mysqlTextResultSetRow(4, ["real"]),
      mysqlOkPacket(5, 0xfe),
    ]),
  );
  expect(got).toEqual({ err: "ERR_MYSQL_MALFORMED_PACKET" });
});

// --- buffered-reader path: a packet split across two reads ------------------

test("mysql: a lenenc overrun on the buffered-reader path is rejected, not served as data", async () => {
  // Splitting the reply mid-row forces the first chunk into the connection's
  // read_buffer (ShortRead on packet 3), so the second chunk is decoded via the
  // buffered `Reader` impl of the per-packet bound instead of the fast-path
  // `StackReader`. Both impls must enforce the same limit.
  const full = Buffer.concat([
    oneColumnHeader,
    mysqlRawPacket(3, Buffer.from([0x08])),
    mysqlTextResultSetRow(4, ["real"]),
    mysqlOkPacket(5, 0xfe),
  ]);
  // Split inside packet 3's body so its header is buffered but its body is not.
  const split = oneColumnHeader.length + 4;
  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    let answered = false;
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (_seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(2));
          return;
        }
        if (payload[0] !== 0x03 /* COM_QUERY */ || answered) return;
        answered = true;
        socket.write(full.subarray(0, split));
        setImmediate(() => socket.write(full.subarray(split)));
      });
    });
    socket.on("error", () => {});
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
    const got = await sql
      .unsafe("select x")
      .simple()
      .then(
        rows => ({ ok: (rows as unknown as { x: unknown }[]).map(r => r.x) }),
        e => ({ err: e?.code ?? String(e) }),
      );
    expect(got).toEqual({ err: "ERR_MYSQL_MALFORMED_PACKET" });
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
    await new Promise<void>(r => server.close(() => r()));
  }
});

// --- boundary: a value that exactly fills the packet still decodes ---------

test("mysql: a row whose single field exactly fills the packet still decodes", async () => {
  const got = await run(Buffer.concat([oneColumnHeader, mysqlTextResultSetRow(3, ["ab"]), mysqlOkPacket(4, 0xfe)]));
  expect(got).toEqual({ ok: ["ab"] });
});
