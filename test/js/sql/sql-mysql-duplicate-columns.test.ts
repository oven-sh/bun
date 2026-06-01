import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { once } from "events";
import net from "net";

// Duplicate result-set column names, driven through a mock server so the test
// runs without docker. The statement decode path retags every occurrence but
// the last as a duplicate (src/sql_jsc/shared/CachedStructure.rs
// `mark_duplicate_columns`): object rows keep only the last occurrence, while
// `.values()` keeps every cell.
describe("duplicate column names (mock server, no docker)", () => {
  const MYSQL_TYPE_VAR_STRING = 0xfd;

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
  function lenencStr(s: string): Buffer {
    const buf = Buffer.from(s, "utf-8");
    if (buf.length >= 0xfb) throw new Error("lenenc: long form not needed for this test");
    return Buffer.concat([Buffer.from([buf.length]), buf]);
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
  function varStringColumn(name: string): Buffer {
    return Buffer.concat([
      lenencStr("def"),
      lenencStr(""),
      lenencStr("t"),
      lenencStr("t"),
      lenencStr(name),
      lenencStr(name),
      Buffer.from([0x0c]),
      u16le(33), // utf8_general_ci
      u32le(1024),
      Buffer.from([MYSQL_TYPE_VAR_STRING]),
      u16le(0),
      Buffer.from([0]),
      Buffer.from([0, 0]),
    ]);
  }

  // Both columns are named "a"; the row carries distinct values so the test
  // can tell which occurrence the object row kept.
  const FIRST = "first";
  const LAST = "last";

  // Text-protocol result set: count, two identically-named columns, one row.
  function textResultSet(startSeq: number): Buffer {
    let seq = startSeq;
    return Buffer.concat([
      packet(seq++, Buffer.from([0x02])),
      packet(seq++, varStringColumn("a")),
      packet(seq++, varStringColumn("a")),
      packet(seq++, Buffer.concat([lenencStr(FIRST), lenencStr(LAST)])),
      okPacket(seq++, 0xfe),
    ]);
  }
  function stmtPrepareOK(startSeq: number, stmtId: number): Buffer {
    let seq = startSeq;
    return Buffer.concat([
      packet(
        seq++,
        Buffer.concat([Buffer.from([0x00]), u32le(stmtId), u16le(2), u16le(0), Buffer.from([0x00]), u16le(0)]),
      ),
      packet(seq++, varStringColumn("a")),
      packet(seq++, varStringColumn("a")),
    ]);
  }
  // Binary row: 0x00 header, 1-byte NULL bitmap (2 columns + 2 reserved bits
  // fit in one byte), then each value as a length-encoded string.
  function binaryResultSet(startSeq: number): Buffer {
    let seq = startSeq;
    return Buffer.concat([
      packet(seq++, Buffer.from([0x02])),
      packet(seq++, varStringColumn("a")),
      packet(seq++, varStringColumn("a")),
      packet(seq++, Buffer.concat([Buffer.from([0x00]), Buffer.from([0x00]), lenencStr(FIRST), lenencStr(LAST)])),
      okPacket(seq++, 0xfe),
    ]);
  }

  function startMockServer(): net.Server {
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
            socket.write(textResultSet(seq + 1));
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

  test("object rows keep the last occurrence; .values() keeps every cell", async () => {
    const server = startMockServer();
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

      // Binary protocol (prepared statement): last one wins in object mode.
      expect(await sql`select 1 as a, 2 as a`).toEqual([{ a: LAST }]);
      // Text protocol decodes the same way.
      expect(await sql`select 1 as a, 2 as a`.simple()).toEqual([{ a: LAST }]);
      // `.values()` is positional and must keep both cells.
      expect(await sql`select 1 as a, 2 as a`.values()).toEqual([[FIRST, LAST]]);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
