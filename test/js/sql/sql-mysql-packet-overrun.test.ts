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
  mysqlStmtPrepareOk,
  mysqlTextResultSetRow,
} from "./wire-frames";

const MYSQL_TYPE_LONG = 0x03;
const MYSQL_TYPE_LONGLONG = 0x08;
const MYSQL_TYPE_VAR_STRING = 0xfd;
const COM_QUERY = 0x03;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;

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
      if (payload[0] !== COM_QUERY) return;
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
        if (payload[0] !== COM_QUERY || answered) return;
        answered = true;
        socket.write(full.subarray(0, split));
        // Yield twice so the first write reaches the client's on_data before
        // the second is sent (immediates run before I/O polling, so a single
        // setImmediate would let both chunks coalesce into one client read).
        setImmediate(() => setImmediate(() => socket.write(full.subarray(split))));
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

// --- prepared-statement path (binary rows + prepare-OK metadata) ------------

// Mock server for the prepared-statement path: authenticates, answers
// COM_STMT_PREPARE with `prepareReply`, answers COM_STMT_EXECUTE with
// `executeReply` (if given), and otherwise goes silent so a wedge shows as a
// test timeout. Returns the caught error code / row objects.
async function runPrepared(opts: { prepareReply: Buffer; executeReply?: Buffer }): Promise<Outcome> {
  const { server, port } = await listeningServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (_seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(2));
          return;
        }
        if (payload[0] === COM_STMT_PREPARE) socket.write(opts.prepareReply);
        else if (payload[0] === COM_STMT_EXECUTE && opts.executeReply) socket.write(opts.executeReply);
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
    return await sql`select a, b, c from t`.then(
      rows => ({ ok: rows as unknown[] }),
      e => ({ err: e?.code ?? String(e) }),
    );
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
    await new Promise<void>(r => server.close(() => r()));
  }
}

// Three fixed-width binary-protocol columns so the row decoder has bytes to
// consume past the header: LONG (4 bytes), LONGLONG (8 bytes), VAR_STRING
// (lenenc). Shared by the prepare response and the execute result-set header.
const threeColDefs = (startSeq: number) =>
  Buffer.concat([
    mysqlColumnDefinition(startSeq, { name: "a", type: MYSQL_TYPE_LONG }),
    mysqlColumnDefinition(startSeq + 1, { name: "b", type: MYSQL_TYPE_LONGLONG }),
    mysqlColumnDefinition(startSeq + 2, { name: "c", type: MYSQL_TYPE_VAR_STRING }),
  ]);

test("mysql: a binary-protocol row truncated to its 0x00 header is rejected, not decoded from the next packet", async () => {
  // The binary row packet body is [0x00]: the row header byte and nothing else,
  // so the null-bitmap and the three fixed-width cells lie past the packet
  // boundary. An unbounded decoder reads them out of the OK terminator's
  // framing bytes and returns garbage column values (b == the terminator's
  // header bytes reinterpreted as an i64). The per-packet bound rejects the
  // row at the null-bitmap read, before any next-packet bytes are touched.
  const got = await runPrepared({
    prepareReply: Buffer.concat([mysqlStmtPrepareOk(1, 1, 3, 0), threeColDefs(2)]),
    executeReply: Buffer.concat([
      mysqlRawPacket(1, mysqlLenencInt(3)),
      threeColDefs(2),
      mysqlRawPacket(5, Buffer.from([0x00])),
      mysqlOkPacket(6, 0xfe),
    ]),
  });
  expect(got).toEqual({ err: "ERR_MYSQL_MALFORMED_PACKET" });
});

test("mysql: a prepare-OK claiming 60000 columns is rejected instead of allocating and waiting forever", async () => {
  // num_columns is server-controlled and drives both the ColumnDefinition41
  // Vec allocation and how many follow-up packets the client waits for.
  // MySQL caps a result set at 4096 columns (MAX_FIELDS); a prepare-OK
  // claiming more is a hostile 12-byte packet. num_params is NOT capped:
  // MySQL accepts up to 65535 placeholders (ER_PS_MANY_PARAM fires only at
  // the u16 boundary), and large IN-lists / bulk inserts legitimately exceed
  // 4096.
  const got = await runPrepared({ prepareReply: mysqlStmtPrepareOk(1, 1, 60000, 0) });
  expect(got).toEqual({ err: "ERR_MYSQL_INVALID_PREPARE_OK_PACKET" });
});

// --- boundary: a value that exactly fills the packet still decodes ---------

test("mysql: a row whose single field exactly fills the packet still decodes", async () => {
  const got = await run(Buffer.concat([oneColumnHeader, mysqlTextResultSetRow(3, ["ab"]), mysqlOkPacket(4, 0xfe)]));
  expect(got).toEqual({ ok: ["ab"] });
});

test("mysql: a well-formed binary-protocol row that exactly fills the packet still decodes", async () => {
  // Binary row body: Int<1>(0x00) header, null-bitmap (1 byte, bit 2 set so
  // column c is NULL), Int<4> for LONG a=7, Int<8> for LONGLONG b=9.
  const body = Buffer.alloc(14);
  body[0] = 0x00;
  body[1] = 1 << (2 + 2); // null-bitmap: column index 2 is NULL (offset +2 reserved bits)
  body.writeInt32LE(7, 2);
  body.writeBigInt64LE(9n, 6);
  const got = await runPrepared({
    prepareReply: Buffer.concat([mysqlStmtPrepareOk(1, 1, 3, 0), threeColDefs(2)]),
    executeReply: Buffer.concat([
      mysqlRawPacket(1, mysqlLenencInt(3)),
      threeColDefs(2),
      mysqlRawPacket(5, body),
      mysqlOkPacket(6, 0xfe),
    ]),
  });
  expect(got).toEqual({ ok: [{ a: 7, b: 9, c: null }] });
});
