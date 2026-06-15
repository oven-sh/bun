// The binary-protocol row decoder skipped the `index` / `is_indexed_column`
// assignments for cells marked NULL in the null bitmap (it `continue;`d out
// of the loop right after writing the null cell). For columns whose name is
// all digits, those fields tell SQLClient.cpp which object index to place the
// value at, so a NULL value on such a column landed at index 0 instead of the
// column's numeric name (and tripped `ASSERT(cell.isIndexedColumn())` in
// debug builds). The text-protocol decoder already handled this correctly.
//
// Uses a minimal mock MySQL server so the test runs without Docker.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { once } from "events";
import net from "net";

function u16le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff]);
}
function u24le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
}
function u32le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}
function packet(seq: number, payload: Buffer): Buffer {
  return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]);
}
function lenenc(n: number): Buffer {
  if (n < 0xfb) return Buffer.from([n]);
  if (n < 0xffff) return Buffer.concat([Buffer.from([0xfc]), u16le(n)]);
  throw new Error("lenenc: not needed for this test");
}
function lenencStr(s: string): Buffer {
  const buf = Buffer.from(s, "utf-8");
  return Buffer.concat([lenenc(buf.length), buf]);
}

const CLIENT_PROTOCOL_41 = 1 << 9;
const CLIENT_SECURE_CONNECTION = 1 << 15;
const CLIENT_PLUGIN_AUTH = 1 << 19;
const CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = 1 << 21;
const CLIENT_DEPRECATE_EOF = 1 << 24;
const SERVER_CAPS =
  CLIENT_PROTOCOL_41 |
  CLIENT_SECURE_CONNECTION |
  CLIENT_PLUGIN_AUTH |
  CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA |
  CLIENT_DEPRECATE_EOF;

const MYSQL_TYPE_LONG = 0x03;

function handshakeV10(): Buffer {
  const authData1 = Buffer.alloc(8, 0x61);
  const authData2 = Buffer.alloc(13, 0x62);
  authData2[12] = 0;
  return packet(
    0,
    Buffer.concat([
      Buffer.from([10]),
      Buffer.from("mock-5.7.0\0"),
      u32le(1),
      authData1,
      Buffer.from([0]),
      u16le(SERVER_CAPS & 0xffff),
      Buffer.from([0x2d]),
      u16le(0x0002),
      u16le((SERVER_CAPS >>> 16) & 0xffff),
      Buffer.from([21]),
      Buffer.alloc(10, 0),
      authData2,
      Buffer.from("mysql_native_password\0"),
    ]),
  );
}

function okPacket(seq: number, header = 0x00): Buffer {
  return packet(seq, Buffer.from([header, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

function columnDef(name: string, type: number, flags = 0): Buffer {
  return Buffer.concat([
    lenencStr("def"),
    lenencStr(""),
    lenencStr("t"),
    lenencStr("t"),
    lenencStr(name),
    lenencStr(name),
    Buffer.from([0x0c]),
    u16le(33),
    u32le(1024),
    Buffer.from([type]),
    u16le(flags),
    Buffer.from([0]),
    Buffer.from([0, 0]),
  ]);
}

// All columns are digit-named so ColumnIdentifier classifies them as
// Index(n). Column "2" carries a non-NULL value to prove that NULL placement
// (and not just presence) is what's being checked.
const columns = [columnDef("5", MYSQL_TYPE_LONG), columnDef("2", MYSQL_TYPE_LONG), columnDef("7", MYSQL_TYPE_LONG)];

function stmtPrepareOK(startSeq: number, stmtId: number): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;
  packets.push(
    packet(
      seq++,
      Buffer.concat([
        Buffer.from([0x00]),
        u32le(stmtId),
        u16le(columns.length),
        u16le(0),
        Buffer.from([0x00]),
        u16le(0),
      ]),
    ),
  );
  for (const c of columns) packets.push(packet(seq++, c));
  return Buffer.concat(packets);
}

function binaryResultSet(startSeq: number): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;
  packets.push(packet(seq++, Buffer.from([columns.length])));
  for (const c of columns) packets.push(packet(seq++, c));
  // Null bitmap: 2 reserved bits, then one bit per column. For 3 columns the
  // bitmap is (3+7+2)/8 = 1 byte. Mark columns 0 ("5") and 2 ("7") NULL.
  // bit2=col0, bit3=col1, bit4=col2 → 0x04 | 0x10 = 0x14.
  packets.push(
    packet(
      seq++,
      Buffer.concat([
        Buffer.from([0x00]), // row header
        Buffer.from([0x14]), // null bitmap
        u32le(42), // column 1 ("2")
      ]),
    ),
  );
  packets.push(packet(seq++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])));
  return Buffer.concat(packets);
}

function textResultSet(startSeq: number): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;
  packets.push(packet(seq++, Buffer.from([columns.length])));
  for (const c of columns) packets.push(packet(seq++, c));
  // Text row: 0xfb marks NULL, everything else is a length-prefixed string.
  packets.push(packet(seq++, Buffer.concat([Buffer.from([0xfb]), lenencStr("42"), Buffer.from([0xfb])])));
  packets.push(packet(seq++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])));
  return Buffer.concat(packets);
}

function startMockServer() {
  const server = net.createServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    let stmtId = 0;
    socket.write(handshakeV10());
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
        if (buffered.length < 4 + len) break;
        const seq = buffered[3];
        const payload = buffered.subarray(4, 4 + len);
        buffered = buffered.subarray(4 + len);
        if (!authed) {
          authed = true;
          socket.write(okPacket(seq + 1));
          continue;
        }
        const cmd = payload[0];
        if (cmd === 0x16 /* COM_STMT_PREPARE */) {
          socket.write(stmtPrepareOK(seq + 1, ++stmtId));
        } else if (cmd === 0x17 /* COM_STMT_EXECUTE */) {
          socket.write(binaryResultSet(seq + 1));
        } else if (cmd === 0x03 /* COM_QUERY */) {
          // The driver fires an "onconnect" COM_QUERY before the first
          // statement; answer those with OK. A user `.simple()` query asks
          // for columns 5/2/7, so answer that one with the text result set.
          const q = payload.subarray(1).toString("utf-8");
          if (q.includes("SELECT")) {
            socket.write(textResultSet(seq + 1));
          } else {
            socket.write(okPacket(seq + 1));
          }
        } else if (cmd === 0x19 /* COM_STMT_CLOSE */) {
          // no response expected
        } else {
          socket.end();
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  return server;
}

test("binary-protocol NULL in a digit-named column lands at that column's index", async () => {
  const server = startMockServer();
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    // Prepared → binary protocol. Before the fix, the two NULL cells kept
    // index=0 / is_indexed_column=0, so the indexed-only fast path in
    // SQLClient.cpp wrote both nulls to slot 0 and dropped keys "5" and "7".
    const [binaryRow] = await sql`SELECT NULL AS \`5\`, 42 AS \`2\`, NULL AS \`7\``;
    expect(binaryRow).toEqual({ "2": 42, "5": null, "7": null });

    // .simple() → text protocol. This path was already correct; the two
    // protocols must agree.
    const [textRow] = await sql`SELECT NULL AS \`5\`, 42 AS \`2\`, NULL AS \`7\``.simple();
    expect(textRow).toEqual({ "2": 42, "5": null, "7": null });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
