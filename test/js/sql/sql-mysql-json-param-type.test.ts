// Object/array parameters are serialized to JSON text and were declared as
// MYSQL_TYPE_JSON (0xf5) in the COM_STMT_EXECUTE parameter-type block.
// MariaDB rejects that type code outright (parameter_type_sanity_check ->
// error 1210 "Incorrect arguments to mysqld_stmt_execute"); MySQL reads a
// JSON parameter through the same string path as MYSQL_TYPE_STRING. The
// client must therefore declare JSON parameters as MYSQL_TYPE_STRING.
//
// This asserts on the bytes the client emits, which only a mock server can
// observe: CI's real-server suites run MySQL, which accepts either type code,
// so a container test cannot catch a regression here. (The "JSON" test in
// sql-mysql.test.ts is MySQL-only: CAST(? AS JSON) is a 1064 syntax error on
// MariaDB, whose json columns are LONGTEXT and read back as strings.)
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  mysqlColumnDefinition,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadLenencInt,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
} from "./wire-frames";

const COM_QUIT = 0x01;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const MYSQL_TYPE_VAR_STRING = 0xfd;
const MYSQL_TYPE_STRING = 0xfe;

test("MySQL: object and array parameters are declared as MYSQL_TYPE_STRING, not MYSQL_TYPE_JSON", async () => {
  const executePayloads: Buffer[] = [];
  const { server, port } = await listeningServer(socket => {
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
        switch (payload[0]) {
          case COM_STMT_PREPARE:
            // INSERT INTO t (a, b) VALUES (?, ?) -> two params, no result columns.
            socket.write(
              Buffer.concat([
                mysqlStmtPrepareOk(1, 1, 0, 2),
                mysqlColumnDefinition(2, { name: "?", type: MYSQL_TYPE_VAR_STRING }),
                mysqlColumnDefinition(3, { name: "?", type: MYSQL_TYPE_VAR_STRING }),
              ]),
            );
            break;
          case COM_STMT_EXECUTE:
            executePayloads.push(Buffer.from(payload));
            socket.write(mysqlOkPacket(seq + 1));
            break;
          case COM_QUIT:
            socket.end();
            break;
          default:
            socket.write(mysqlOkPacket(seq + 1));
        }
      });
    });
    socket.on("error", () => {});
  });

  try {
    {
      await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
      await sql`INSERT INTO t (a, b) VALUES (${{ b: 2 }}, ${[1, "x"]})`;
    }

    expect(executePayloads).toHaveLength(1);
    const payload = executePayloads[0];
    // COM_STMT_EXECUTE: Int<1>(0x17) Int<4>(statement_id) Int<1>(flags)
    // Int<4>(iteration_count) null_bitmap<(params+7)/8> Int<1>(new_params_bind_flag)
    // then per param Int<1>(type) Int<1>(0x80 if unsigned) and the values.
    const statementId = payload.readUInt32LE(1);
    const nullBitmap = payload[10];
    const newParamsBindFlag = payload[11];
    const paramTypes = [payload[12], payload[14]];
    const paramFlags = [payload[13], payload[15]];
    const values: string[] = [];
    let offset = 16;
    for (let i = 0; i < 2; i++) {
      const { value: len, width } = mysqlReadLenencInt(payload, offset);
      offset += width;
      values.push(payload.subarray(offset, offset + len).toString("utf-8"));
      offset += len;
    }
    // Before the fix the two type bytes were 0xf5 (MYSQL_TYPE_JSON), which
    // MariaDB servers reject at execute time.
    expect({
      statementId,
      nullBitmap,
      newParamsBindFlag,
      paramTypes,
      paramFlags,
      values,
      trailing: payload.length - offset,
    }).toEqual({
      statementId: 1,
      nullBitmap: 0,
      newParamsBindFlag: 1,
      paramTypes: [MYSQL_TYPE_STRING, MYSQL_TYPE_STRING],
      paramFlags: [0, 0],
      values: ['{"b":2}', '[1,"x"]'],
      trailing: 0,
    });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
