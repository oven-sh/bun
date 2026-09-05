// Fault-injection test: requires a server that answers COM_STMT_PREPARE with a
// valid prepare-OK and then observes whether the client ever sends the
// matching COM_STMT_EXECUTE. DO NOT COPY THIS PATTERN for anything a real
// server can produce; see describeWithContainer for that.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// Regression: a parameterized query whose COM_STMT_EXECUTE payload reaches the
// 24-bit MySQL packet-length limit on the *first use* of the statement text
// never settled its JS promise. The PREPARE is small and succeeds; when
// PREPARE_OK arrives, `MySQLRequestQueue::advance()` re-enters
// `JSMySQLQuery::run()` to write the execute. `Packet::end()` refuses the
// oversized payload (Overflow) and `run()` returns Err, but the errdefer guard
// in `run()` had already flipped the query's status to `Fail`, so the
// subsequent `on_error` -> `reject_with_js_value` saw `fail()` return false and
// early-returned without ever calling the JS reject callback. The request was
// discarded from the queue and the connection moved on, leaking the promise.
//
// The already-prepared path (same statement text used a second time) reached
// the same overflow synchronously inside `do_run`, whose thrown exception is
// caught in sql.ts and turned into a rejection, so only the unprepared path
// hung.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import {
  listeningServer,
  mysqlColumnDefinition,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
} from "./wire-frames";

const COM_QUERY = 0x03;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const MYSQL_TYPE_VAR_STRING = 0xfd;

test("MySQL: overflow on first-use COM_STMT_EXECUTE rejects instead of leaking the promise", async () => {
  // The mock server runs in the test process (pure node:net, never touches
  // Bun's MySQL code); only the client runs in a subprocess so the unfixed
  // hang is observable as a missing result line / non-zero exit.
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
          // Valid prepare-OK with one parameter and no result columns.
          socket.write(
            Buffer.concat([
              mysqlStmtPrepareOk(1, 1, 0, 1),
              mysqlColumnDefinition(2, { name: "?", type: MYSQL_TYPE_VAR_STRING }),
            ]),
          );
        } else if (cmd === COM_STMT_EXECUTE) {
          // Should never arrive: the oversized execute is rejected client-side
          // before any bytes reach the wire.
          sawStmtExecute = true;
          socket.end();
        } else if (cmd === COM_QUERY) {
          // The small follow-up simple query: answer with a bare OK so it
          // resolves, giving the fixture a deterministic "processing is
          // complete" signal on unfixed builds where `big` never settles.
          socket.write(mysqlOkPacket(1));
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

      // 17 MiB parameter: COM_STMT_EXECUTE payload exceeds 0xFFFFFF.
      const payload = Buffer.alloc(17 * 1024 * 1024, 0x78);

      let bigResult = "pending";
      sql.unsafe("SELECT ?", [payload]).then(
        () => (bigResult = { state: "resolved" }),
        e => (bigResult = { state: "rejected", code: e?.code ?? String(e) }),
      );

      // A simple COM_QUERY on the same max:1 connection. On unfixed builds the
      // oversized request has been silently discarded from the native queue so
      // this still reaches the server and resolves; on fixed builds the
      // rejection has already fired by the time this round-trips.
      const after = await sql.unsafe("SELECT 1").then(
        () => "ok",
        e => "err:" + (e?.code ?? String(e)),
      );

      // Drain a microtask so big's settlement handlers have run.
      await Promise.resolve();

      console.log(JSON.stringify({ bigResult, after }));
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

    // Unfixed builds print `bigResult: "pending"` (the promise was leaked and
    // never settled) while `after` is "ok" because the connection moved on.
    // With the fix, the overflow surfaces as an `ERR_MYSQL_OVERFLOW`
    // rejection and the execute never reaches the wire. stderr is included so
    // its contents appear in the toEqual diff on failure.
    expect({ stderr, stdout: stdout.trim(), sawStmtExecute }).toEqual({
      stderr: expect.any(String),
      stdout: JSON.stringify({
        bigResult: { state: "rejected", code: "ERR_MYSQL_OVERFLOW" },
        after: "ok",
      }),
      sawStmtExecute: false,
    });
    expect(exitCode).toBe(0);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
