// The defining assertion here is the parameter's type byte and unsigned flag in
// the COM_STMT_EXECUTE packet Bun emits, which is only readable from the server
// side: a real server's response cannot distinguish `0n` sent as SIGNED from
// `0n` sent as UNSIGNED, and both encodings round-trip identically. Hence a mock
// rather than describeWithContainer.
//
// JSC__isBigIntInInt64Range / JSC__isBigIntInUInt64Range answered the complement
// of the range they were handed, so `123n` threw ERR_OUT_OF_RANGE while `-5n`,
// `u64::MAX` and the out-of-range `2n ** 64n` were accepted and corrupted.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  mysqlBinaryResultSet,
  mysqlColumnDefinition,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
} from "./wire-frames";

const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const MYSQL_TYPE_LONGLONG = 0x08;
const MYSQL_TYPE_VAR_STRING = 0xfd;
// The high bit of a COM_STMT_EXECUTE parameter's second type byte.
const MYSQL_PARAM_UNSIGNED = 0x80;

const I64_MAX = (1n << 63n) - 1n;
const I64_MIN = -(1n << 63n);
const U64_MAX = (1n << 64n) - 1n;

// COM_STMT_EXECUTE — page_protocol_com_stmt_execute.html. For a one-parameter
// statement: Int<1>(0x17) Int<4>(stmt_id) Int<1>(flags) Int<4>(iteration_count)
// Int<1>(null_bitmap) Int<1>(new_params_bound) Int<2>(param_type) value.
function describeSingleParam(payload: Buffer): string {
  if (payload[10] & 1) return "NULL";
  if (payload[11] !== 1) return "no param types bound";
  const type = payload[12];
  if (type !== MYSQL_TYPE_LONGLONG) return `type=0x${type.toString(16)}`;
  return payload[13] & MYSQL_PARAM_UNSIGNED
    ? `LONGLONG UNSIGNED ${payload.readBigUInt64LE(14)}`
    : `LONGLONG SIGNED ${payload.readBigInt64LE(14)}`;
}

test("mysql: BigInt parameters keep their sign and magnitude on the wire", async () => {
  const wire: string[] = [];
  const { port, server } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
          return;
        }
        if (payload[0] === COM_STMT_PREPARE) {
          socket.write(
            Buffer.concat([
              mysqlStmtPrepareOk(1, 1, 1, 1),
              mysqlColumnDefinition(2, { name: "?", type: MYSQL_TYPE_VAR_STRING }), // parameter
              mysqlColumnDefinition(3, { name: "v", type: MYSQL_TYPE_VAR_STRING }), // column
            ]),
          );
        } else if (payload[0] === COM_STMT_EXECUTE) {
          wire.push(describeSingleParam(payload));
          socket.write(mysqlBinaryResultSet(1, [{ name: "v", type: MYSQL_TYPE_VAR_STRING }], [["row1"]]));
        } else {
          socket.write(mysqlOkPacket(1));
        }
      });
    });
    socket.on("error", () => {});
  });

  // Ordered so the two rejections sit between accepted values: a bind that
  // throws must roll its partial packet out of the write buffer, otherwise the
  // binds after it desynchronize and never reach `wire`.
  const cases: [bigint, string][] = [
    [123n, "LONGLONG SIGNED 123"],
    [-5n, "LONGLONG SIGNED -5"],
    [0n, "LONGLONG SIGNED 0"],
    [I64_MAX, "LONGLONG SIGNED 9223372036854775807"],
    [I64_MIN, "LONGLONG SIGNED -9223372036854775808"],
    [I64_MIN - 1n, "ERR_OUT_OF_RANGE"],
    [I64_MAX + 1n, "LONGLONG UNSIGNED 9223372036854775808"],
    [(1n << 63n) + 7n, "LONGLONG UNSIGNED 9223372036854775815"],
    [U64_MAX, "LONGLONG UNSIGNED 18446744073709551615"],
    [U64_MAX + 1n, "ERR_OUT_OF_RANGE"],
    [42n, "LONGLONG SIGNED 42"],
  ];

  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    const rows: unknown[] = [];
    const outcomes: string[] = [];
    for (const [value] of cases) {
      // Index the packet this query produced rather than the last one recorded,
      // so a bind that resolves without reaching COM_STMT_EXECUTE reads
      // undefined instead of silently re-reading the previous query's packet.
      const slot = wire.length;
      outcomes.push(
        await sql.unsafe("SELECT ? AS v", [value]).then(
          (result: unknown) => {
            rows.push(result);
            return wire[slot] ?? "resolved without sending a parameter";
          },
          (err: { code?: string }) => err?.code ?? "threw without a code",
        ),
      );
    }

    expect(outcomes).toEqual(cases.map(([, expected]) => expected));
    // Only the two out-of-range values are rejected, and every accepted bind
    // reached COM_STMT_EXECUTE exactly once.
    expect(wire).toHaveLength(cases.length - 2);
    // The binary result set decodes, so `outcomes` reflects completed queries
    // rather than a stalled protocol stream.
    expect(rows).toEqual(Array.from({ length: cases.length - 2 }, () => [{ v: "row1" }]));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
