// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlBinaryResultSetRow,
  mysqlColumnDefinition,
  mysqlErrPacket,
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
const MYSQL_TYPE_TIME = 0x0b;
const MYSQL_TYPE_VAR_STRING = 0xfd;
const COM_QUERY = 0x03;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;

type Outcome = { rows: unknown[] } | { code: string; message: string };

/**
 * Runs `query` against a server that answers each command once with the bytes scripted for it and is silent
 * otherwise. It never closes the socket: that would settle a query that waits for bytes which never come.
 */
async function against(
  replies: { [command: number]: Buffer },
  query: (sql: SQL) => Promise<unknown[]>,
): Promise<Outcome> {
  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    const pending = { ...replies };
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (_seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(2));
          return;
        }
        if (mysqlAckSessionSetup(socket, payload)) return;
        const reply = pending[payload[0]];
        delete pending[payload[0]];
        if (reply) socket.write(reply);
      });
    });
    socket.on("error", () => {});
  });
  const sql = new SQL({ url: `mysql://u@127.0.0.1:${port}/d`, max: 1 });
  try {
    return await query(sql).then(
      rows => ({ rows: [...rows] }),
      e => ({ code: e.code, message: e.message }),
    );
  } finally {
    await sql.close({ timeout: 0 });
    server.close();
  }
}

const simple = (reply: Buffer) => against({ [COM_QUERY]: reply }, sql => sql.unsafe("select x").simple());

const oneColumn = Buffer.concat([
  mysqlRawPacket(1, mysqlLenencInt(1)),
  mysqlColumnDefinition(2, { name: "x", type: MYSQL_TYPE_VAR_STRING }),
]);
/** string<lenenc> that claims 300 bytes and has 3. */
const claims300 = Buffer.concat([Buffer.from([0xfc, 0x2c, 0x01]), Buffer.from("abc")]);
const restOfTheResult = Buffer.concat([mysqlTextResultSetRow(4, ["real"]), mysqlOkPacket(5, 0xfe)]);

test.each([
  [
    "a text row whose field overruns the packet, nothing behind it",
    Buffer.concat([oneColumn, mysqlRawPacket(3, claims300)]),
  ],
  [
    "a column definition whose catalog overruns the packet, nothing behind it",
    Buffer.concat([mysqlRawPacket(1, mysqlLenencInt(1)), mysqlRawPacket(2, claims300)]),
  ],
  [
    "a text row whose field overruns into the next packet",
    Buffer.concat([oneColumn, mysqlRawPacket(3, Buffer.from([0x08])), restOfTheResult]),
  ],
  [
    // 600 KB do not fit in one read, so what follows the first row is decoded from the connection's read buffer.
    "a text row whose field overruns into the next packet, behind a row that takes two reads",
    Buffer.concat([
      oneColumn,
      mysqlTextResultSetRow(3, [Buffer.alloc(600 * 1024, "a")]),
      mysqlRawPacket(4, Buffer.from([0x08])),
      mysqlTextResultSetRow(5, ["real"]),
      mysqlOkPacket(6, 0xfe),
    ]),
  ],
])("%s is malformed", async (_name, reply) => {
  expect(await simple(reply)).toMatchObject({ code: "ERR_MYSQL_MALFORMED_PACKET" });
});

test("an empty row packet is not decoded from the next packet's header", async () => {
  expect(await simple(Buffer.concat([oneColumn, mysqlRawPacket(3, Buffer.alloc(0)), restOfTheResult]))).toMatchObject({
    code: "ERR_MYSQL_MALFORMED_PACKET",
  });
});

test("an error message ends where its packet ends", async () => {
  const reply = Buffer.concat([mysqlErrPacket(1, 1064, "42000", "boom"), mysqlOkPacket(2)]);
  expect(await simple(reply)).toMatchObject({ message: "boom" });
});

const threeColumns = (startSeq: number) =>
  Buffer.concat([
    mysqlColumnDefinition(startSeq, { name: "a", type: MYSQL_TYPE_LONG }),
    mysqlColumnDefinition(startSeq + 1, { name: "b", type: MYSQL_TYPE_LONGLONG }),
    mysqlColumnDefinition(startSeq + 2, { name: "c", type: MYSQL_TYPE_VAR_STRING }),
  ]);
const prepared = (row: Buffer) =>
  against(
    {
      [COM_STMT_PREPARE]: Buffer.concat([mysqlStmtPrepareOk(1, 1, 3, 0), threeColumns(2)]),
      [COM_STMT_EXECUTE]: Buffer.concat([
        mysqlRawPacket(1, mysqlLenencInt(3)),
        threeColumns(2),
        mysqlRawPacket(5, row),
        mysqlOkPacket(6, 0xfe),
      ]),
    },
    sql => sql`select a, b, c from t`,
  );

test("a binary row cut after its header is not decoded from the terminator's bytes", async () => {
  expect(await prepared(Buffer.from([0x00]))).toMatchObject({ code: "ERR_MYSQL_MALFORMED_PACKET" });
});

test("fields that fill their packet exactly still decode", async () => {
  // header, NULL bitmap (c is NULL: bit 2 + 2), Int<4> a, Int<8> b
  const row = Buffer.alloc(14);
  row[1] = 1 << 4;
  row.writeInt32LE(7, 2);
  row.writeBigInt64LE(9n, 6);
  expect({
    text: await simple(Buffer.concat([oneColumn, mysqlTextResultSetRow(3, ["ab"]), mysqlOkPacket(4, 0xfe)])),
    binary: await prepared(row),
  }).toEqual({ text: { rows: [{ x: "ab" }] }, binary: { rows: [{ a: 7, b: 9, c: null }] } });
});

// Int<1> length, Int<1> is_negative, Int<4> days, Int<1> hours, minutes, seconds, Int<4> microseconds
function binaryTime(decimals: number, value: number[]) {
  const column = mysqlColumnDefinition(2, { name: "t", type: MYSQL_TYPE_TIME, decimals });
  return against(
    {
      [COM_STMT_PREPARE]: Buffer.concat([mysqlStmtPrepareOk(1, 1, 1, 0), column]),
      [COM_STMT_EXECUTE]: Buffer.concat([
        mysqlRawPacket(1, mysqlLenencInt(1)),
        column,
        mysqlBinaryResultSetRow(3, [Buffer.from(value)]),
        mysqlOkPacket(4, 0xfe),
      ]),
    },
    sql => sql`select t`,
  );
}

test("a binary TIME no server sends", async () => {
  expect({
    "a length of 9": await binaryTime(6, [9, 0, 0, 0, 0, 0, 1, 2, 3, 0]),
    "1,000,000 microseconds": await binaryTime(6, [12, 0, 0, 0, 0, 0, 1, 2, 3, 0x40, 0x42, 0x0f, 0x00]),
    "999,999 microseconds": await binaryTime(6, [12, 0, 0, 0, 0, 0, 1, 2, 3, 0x3f, 0x42, 0x0f, 0x00]),
    "a column of 31 decimals": await binaryTime(31, [12, 0, 0, 0, 0, 0, 1, 2, 3, 0x20, 0xa1, 0x07, 0x00]),
    "4,294,967,295 days": await binaryTime(0, [8, 0, 0xff, 0xff, 0xff, 0xff, 0, 59, 58]),
  }).toMatchObject({
    "a length of 9": { code: "ERR_MYSQL_INVALID_BINARY_VALUE" },
    "1,000,000 microseconds": { code: "ERR_MYSQL_INVALID_BINARY_VALUE" },
    "999,999 microseconds": { rows: [{ t: "01:02:03.999999" }] },
    "a column of 31 decimals": { rows: [{ t: "01:02:03.500000" }] },
    "4,294,967,295 days": { rows: [{ t: "103079215080:59:58" }] },
  });
});
