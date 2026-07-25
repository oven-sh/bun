// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

// Regression test: MySQLConnection.handleResultSet frees statement.columns and then
// `try alloc()`s a new slice sized by the server-provided field_count. If that alloc
// fails, statement.columns was left pointing at the freed buffer, and the subsequent
// MySQLStatement.deinit() (reached via JSMySQLConnection.deinit -> MySQLConnection.cleanup
// when the connection is torn down) iterated and freed it again.
//
// We force the alloc to fail by driving a mock MySQL server that reports an absurd
// field_count (lenenc 0xFE + 0xFF*8 = 2^64-1). Under ASAN, builds without the fix abort
// with use-after-poison inside ColumnDefinition41.deinit; with the fix, the error path
// leaves columns = &.{} and the process exits cleanly after rejecting the query.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import {
  listeningServer,
  mysqlColumnDefinition,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlRawPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
} from "./wire-frames";

const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const MYSQL_TYPE_VAR_STRING = 0xfd;

// Deliberately-malformed result-set header claiming 2^64-1 columns via a length-encoded
// integer with a 0xFE prefix. Bun reads this as field_count, sees it differs from the 1
// column cached at prepare time, frees the old slice, and attempts
// alloc(ColumnDefinition41, 2^64-1), which fails with OutOfMemory. Built via mysqlRawPacket
// because the typed builders refuse to encode an unrepresentable column count.
function hugeResultSetHeader(seq: number): Buffer {
  return mysqlRawPacket(seq, Buffer.from([0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
}

test("MySQL: OOM reallocating statement.columns does not leave a dangling slice", async () => {
  // The mock server runs in the test process (pure node:net, never touches Bun's MySQL code);
  // only the client runs in a subprocess so an ASAN abort there is observable as exitCode != 0.
  let sawStmtExecute = false;
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
        const cmd = payload[0];
        if (cmd === COM_STMT_PREPARE) {
          socket.write(
            Buffer.concat([
              mysqlStmtPrepareOk(1, 1, 1, 1),
              mysqlColumnDefinition(2, { name: "p", type: MYSQL_TYPE_VAR_STRING }), // param definition
              mysqlColumnDefinition(3, { name: "c", type: MYSQL_TYPE_VAR_STRING }), // column definition
            ]),
          );
        } else if (cmd === COM_STMT_EXECUTE) {
          sawStmtExecute = true;
          socket.write(hugeResultSetHeader(1));
        } else {
          socket.end();
        }
      });
    });
    socket.on("error", () => {});
  });

  try {
    const fixture = /* js */ `
      const { SQL } = require("bun");
      const sql = new SQL({ url: "mysql://root@127.0.0.1:${port}/db", max: 1 });

      const err = await sql\`SELECT \${1}\`.catch(e => e);
      // Force the connection object through full teardown so that
      // JSMySQLConnection.deinit -> MySQLConnection.cleanup runs and derefs the
      // cached prepared statement, triggering MySQLStatement.deinit.
      await sql.close().catch(() => {});
      Bun.gc(true);
      await Bun.sleep(0);
      Bun.gc(true);

      console.log(JSON.stringify({ code: err?.code ?? null, name: err?.name ?? null }));
      process.exit(0);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // On the unfixed build the subprocess aborts inside MySQLStatement.deinit
    // before it can print the JSON result line, so stdout is empty. With the
    // fix the query is rejected cleanly and the JSON result line is printed.
    // stderr is included only so its contents appear in the toEqual diff on
    // failure; the pass/fail signal comes from stdout and exitCode.
    // sawStmtExecute proves the mock actually sent the huge result-set header
    // (a JSON error before execute would otherwise satisfy the stdout check).
    expect({ stderr, stdout: stdout.trim(), sawStmtExecute }).toEqual({
      stderr: expect.any(String),
      stdout: expect.stringMatching(/^\{.*\}$/),
      sawStmtExecute: true,
    });
    const result = JSON.parse(stdout.trim());
    expect(typeof result.code === "string" || typeof result.name === "string").toBe(true);
    expect(exitCode).toBe(0);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
