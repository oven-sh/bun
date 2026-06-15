// JSC__isBigIntInInt64Range / JSC__isBigIntInUInt64Range had their (min,max)
// parameters swapped relative to the Rust callers AND used OR where the
// inclusive range check needs AND. Net effect: they returned true exactly
// when the value was OUT of range. Through the MySQL parameter binder this
// rejected every in-range BigInt with ERR_OUT_OF_RANGE and silently accepted
// (then truncated) out-of-range ones.
//
// Uses a minimal mock MySQL server so the test runs without Docker.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { once } from "events";
import net from "net";

// --- MySQL wire helpers ----------------------------------------------------

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

const MYSQL_TYPE_LONGLONG = 0x08;

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

type Captured = { type: number; unsigned: boolean; raw: Buffer };

function startMockServer(onExecute: (c: Captured) => void) {
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
          // 1 param, 1 column ("x" BIGINT).
          let s = seq + 1;
          const packets: Buffer[] = [];
          packets.push(
            packet(
              s++,
              Buffer.concat([
                Buffer.from([0x00]),
                u32le(++stmtId),
                u16le(1), // num_columns
                u16le(1), // num_params
                Buffer.from([0x00]),
                u16le(0),
              ]),
            ),
          );
          packets.push(packet(s++, columnDef("?", MYSQL_TYPE_LONGLONG)));
          packets.push(packet(s++, columnDef("x", MYSQL_TYPE_LONGLONG)));
          socket.write(Buffer.concat(packets));
        } else if (cmd === 0x17 /* COM_STMT_EXECUTE */) {
          // Decode the single bound parameter. Layout for 1 param:
          //   cmd(1) stmt_id(4) flags(1) iter(4) null_bitmap(1)
          //   new_params_bind(1) [type(1) flags(1)] value(8)
          let o = 1 + 4 + 1 + 4;
          const nullBitmap = payload[o++];
          const newBind = payload[o++];
          let type = MYSQL_TYPE_LONGLONG;
          let unsigned = false;
          if (newBind) {
            type = payload[o++];
            unsigned = (payload[o++] & 0x80) !== 0;
          }
          const raw = Buffer.from(payload.subarray(o, o + 8));
          if (nullBitmap === 0) onExecute({ type, unsigned, raw });

          // Reply with a 1-column BIGINT result echoing the bound value.
          let s = seq + 1;
          const packets: Buffer[] = [];
          packets.push(packet(s++, Buffer.from([1])));
          packets.push(packet(s++, columnDef("x", MYSQL_TYPE_LONGLONG, unsigned ? 1 << 5 : 0)));
          packets.push(packet(s++, Buffer.concat([Buffer.from([0x00]), Buffer.from([0x00]), raw])));
          packets.push(packet(s++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])));
          socket.write(Buffer.concat(packets));
        } else if (cmd === 0x03 /* COM_QUERY */) {
          socket.write(okPacket(seq + 1));
        } else if (cmd === 0x19 /* COM_STMT_CLOSE */ || cmd === 0x1a /* COM_STMT_RESET */) {
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

const I64_MIN = -9223372036854775808n;
const I64_MAX = 9223372036854775807n;
const U64_MAX = 18446744073709551615n;

describe("MySQL BigInt parameter binding", () => {
  test("in-range BigInt params are accepted and round-trip on the wire", async () => {
    const captured: Captured[] = [];
    const server = startMockServer(c => captured.push(c));
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

      const cases: Array<{ in: bigint; signed: boolean }> = [
        { in: 5n, signed: true },
        { in: 0n, signed: true },
        { in: -1n, signed: true },
        { in: I64_MAX, signed: true },
        { in: I64_MIN, signed: true },
        // Above i64::MAX but within u64 range: bound as unsigned LONGLONG.
        { in: I64_MAX + 1n, signed: false },
        { in: U64_MAX, signed: false },
      ];

      for (const c of cases) {
        captured.length = 0;
        await sql.unsafe("SELECT ? AS x", [c.in]);
        expect(captured.length).toBe(1);
        const got = captured[0];
        const wire = got.unsigned ? got.raw.readBigUInt64LE(0) : got.raw.readBigInt64LE(0);
        expect({ in: c.in, type: got.type, unsigned: got.unsigned, wire }).toEqual({
          in: c.in,
          type: MYSQL_TYPE_LONGLONG,
          unsigned: !c.signed,
          wire: c.in,
        });
      }
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("out-of-range BigInt params reject with ERR_OUT_OF_RANGE", async () => {
    const captured: Captured[] = [];
    const server = startMockServer(c => captured.push(c));
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

      for (const v of [U64_MAX + 1n, I64_MIN - 1n, 2n ** 100n, -(2n ** 100n)]) {
        captured.length = 0;
        const result = await sql.unsafe("SELECT ? AS x", [v]).then(
          rows => ({ ok: true as const, rows }),
          err => ({ ok: false as const, code: (err as any)?.code, message: String((err as any)?.message ?? err) }),
        );
        expect({ v, result, executed: captured.length }).toEqual({
          v,
          result: {
            ok: false,
            code: "ERR_OUT_OF_RANGE",
            message: expect.stringContaining("out of range"),
          },
          executed: 0,
        });
      }
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
