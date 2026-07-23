// Fault-injection test: requires a server that sends a protocol-invalid frame,
// which a healthy container will not do on demand. DO NOT COPY THIS PATTERN —
// anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

// A COM_STMT_PREPARE response carrying statement_id = 0 must be rejected as a
// protocol error; see StmtPrepareOKPacket::decode_internal for the invariant.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { listeningServer, mysqlHandshakeV10, mysqlOkPacket, mysqlReadPackets, mysqlStmtPrepareOk } from "./wire-frames";

const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;

test("MySQL: prepare-OK with statement_id 0 is a protocol error and is never executed", async () => {
  // The mock server runs in the test process (pure node:net, never touches Bun's
  // MySQL code); only the client runs in a subprocess so that the debug-assert
  // abort on unfixed builds is observable as a missing result line.
  const executedStatementIds: number[] = [];
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
        if (payload[0] === COM_STMT_PREPARE) {
          // The hostile frame: a well-formed prepare-OK whose statement_id is 0.
          socket.write(mysqlStmtPrepareOk(1, 0, 0, 0));
        } else if (payload[0] === COM_STMT_EXECUTE) {
          // COM_STMT_EXECUTE: Int<1>(0x17) Int<4>(statement_id) ...
          executedStatementIds.push(payload.readUInt32LE(1));
          socket.end();
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
      const err = await sql\`SELECT 1\`.catch(e => e);
      await sql.close().catch(() => {});
      console.log(JSON.stringify({ code: err?.code ?? null }));
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

    // Unfixed debug builds abort inside bind_and_execute before the result line
    // is printed, so stdout is empty; unfixed release builds accept the id and
    // the mock records the COM_STMT_EXECUTE it receives for statement id 0.
    // With the fix the prepare-OK is rejected at decode time, the pending query
    // rejects with the protocol error, and no execute ever reaches the wire.
    // stderr is included only so it appears in the toEqual diff on failure.
    expect({ stderr, stdout: stdout.trim(), executedStatementIds }).toEqual({
      stderr: expect.any(String),
      stdout: JSON.stringify({ code: "ERR_MYSQL_INVALID_PREPARE_OK_PACKET" }),
      executedStatementIds: [],
    });
    expect(exitCode).toBe(0);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
