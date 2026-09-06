// A parameter whose conversion throws in JS (a BigInt inside an object that is
// JSON-serialised, a cyclic object, a throwing toJSON) is only converted after
// the server answers COM_STMT_PREPARE. On a statement text that is not yet in
// the prepared-statement cache, that bind runs from the queue (PREPARE_OK ->
// advance -> run), not from the JS caller. The error raised there must reach
// the query's reject path: before the fix the promise never settled and the
// connection stayed checked out (sql.begin hung the whole pool).
//
// The mock server is here so the test runs without docker; the same sequence
// happens against a real MySQL server, see the matching test in
// sql-mysql.test.ts.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlColumnDefinition,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
} from "./wire-frames";

const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const MYSQL_TYPE_VAR_STRING = 253;

test("MySQL: a bind error after PREPARE_OK rejects the query instead of hanging it", async () => {
  const prepared: string[] = [];
  let executed = 0;
  let statementId = 0;
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
        if (mysqlAckSessionSetup(socket, payload)) return;
        if (payload[0] === COM_STMT_PREPARE) {
          const text = payload.subarray(1).toString("utf8");
          prepared.push(text);
          const numParams = text.split("?").length - 1;
          let s = 1;
          const frames = [mysqlStmtPrepareOk(s++, ++statementId, 1, numParams)];
          for (let i = 0; i < numParams; i++) {
            frames.push(mysqlColumnDefinition(s++, { name: "?", type: MYSQL_TYPE_VAR_STRING }));
          }
          frames.push(mysqlColumnDefinition(s++, { name: "v", type: MYSQL_TYPE_VAR_STRING }));
          socket.write(Buffer.concat(frames));
        } else if (payload[0] === COM_STMT_EXECUTE) {
          executed++;
          socket.write(mysqlOkPacket(1));
        } else {
          // COM_QUERY for START TRANSACTION / ROLLBACK / COMMIT
          socket.write(mysqlOkPacket(1));
        }
      });
    });
    socket.on("error", () => {});
  });

  try {
    const fixture = /* js */ `
      const { SQL } = require("bun");
      const sql = new SQL({ url: "mysql://root@127.0.0.1:${port}/db", max: 1, idleTimeout: 0 });
      const cyclic = { x: 1 };
      cyclic.self = cyclic;
      const steps = {
        bigintInObject: () => sql\`select \${{ id: 10n }} as a\`,
        cyclic: () => sql\`select \${cyclic} as c, \${2} as d\`,
        throwingToJSON: () => sql\`select \${{ toJSON() { throw new Error("boom"); } }} as t\`,
        next: () => sql\`select \${"fine"} as v\`,
        inTransaction: () => sql.begin(tx => tx\`select \${{ big: 1n }} as intx\`),
        afterTransaction: () => sql\`select \${"after"} as v\`,
      };
      const out = {};
      for (const [name, step] of Object.entries(steps)) {
        // A promise that never settles is the bug; bound the wait so the
        // subprocess reports it instead of hanging the test. A pending step
        // holds the only pooled connection, so stop at the first one.
        out[name] = await Promise.race([
          step().then(() => "resolved", e => "rejected: " + e.message),
          Bun.sleep(2000).then(() => "pending"),
        ]);
        if (out[name] === "pending") break;
      }
      console.log(JSON.stringify(out));
      process.exit(0);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stderr, stdout: JSON.parse(stdout.trim() || "null"), executed }).toEqual({
      stderr: expect.any(String),
      stdout: {
        bigintInObject: "rejected: JSON.stringify cannot serialize BigInt.",
        cyclic: expect.stringMatching(/^rejected: JSON\.stringify cannot serialize cyclic structures/),
        throwingToJSON: "rejected: boom",
        next: "resolved",
        inTransaction: "rejected: JSON.stringify cannot serialize BigInt.",
        afterTransaction: "resolved",
      },
      // The two healthy queries are the only COM_STMT_EXECUTEs on the wire;
      // every failed bind leaves its prepared statement unexecuted.
      executed: 2,
    });
    expect(prepared.map(text => text.replace(/\s+/g, " "))).toEqual([
      "select ? as a",
      "select ? as c, ? as d",
      "select ? as t",
      "select ? as v",
      "select ? as intx",
    ]);
    expect(exitCode).toBe(0);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
