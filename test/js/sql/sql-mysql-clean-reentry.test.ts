// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// MySQLRequestQueue.clean() runs JS for each request it rejects. That JS can call
// MySQLConnection.close() while clean() still has requests to reject.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import path from "node:path";

// Absolute path so the spawned fixture (which lives in a temp dir) can import
// the shared frame builders instead of inlining Buffer construction.
const wireFrames = path.join(import.meta.dir, "wire-frames.ts");

// The failure mode is a debug assert or a UAF under ASAN, so only run where it is observable.
test.skipIf(!isDebug && !isASAN)(
  "MySQL: clean() is safe when reject callback re-enters via connection.close()",
  async () => {
    using dir = tempDir("mysql-clean-reentry", {
      "fixture.ts": /* js */ `
      import net from "node:net";
      import { SQL } from "bun";
      import { mysqlAckSessionSetup, mysqlHandshakeV10, mysqlOkPacket } from ${JSON.stringify(wireFrames)};

      let socketRef;
      const server = net.createServer(socket => {
        socketRef = socket;
        let buffered = Buffer.alloc(0), authed = false;
        socket.write(mysqlHandshakeV10());
        socket.on("data", chunk => {
          buffered = Buffer.concat([buffered, chunk]);
          while (buffered.length >= 4) {
            const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
            if (buffered.length < 4 + len) break;
            const seq = buffered[3];
            const payload = buffered.subarray(4, 4 + len);
            buffered = buffered.subarray(4 + len);
            if (!authed) { authed = true; socket.write(mysqlOkPacket(seq + 1)); }
            else mysqlAckSessionSetup(socket, payload);
            // Never respond to user queries -> they stay in the native request queue.
          }
        });
        socket.on("error", () => {});
      });

      server.listen(0, "127.0.0.1");
      await new Promise(r => server.on("listening", r));
      const { port } = server.address();

      const sql = new SQL({ url: \`mysql://root@127.0.0.1:\${port}/db\`, max: 1 });

      // Obtain the native MySQLConnection (and observe when every query has
      // actually been enqueued natively) by shadowing each query handle's
      // .run(connection, query) with an own-property before the pool invokes it.
      let nativeConnection;
      let runCount = 0;
      let protoRun;
      const queries = [sql\`select 0\`, sql\`select 1\`, sql\`select 2\`, sql\`select 3\`, sql\`select 4\`];
      // Starting a query makes its native MySQLQuery handle. run() comes when the pool has dialed.
      const settled = queries.map(q =>
        q.catch(err => {
          // Runs in the microtask drain that follows each rejection inside clean().
          try { nativeConnection?.close(); } catch {}
          return err?.code ?? String(err);
        })
      );
      for (const q of queries) {
        const handleSym = Object.getOwnPropertySymbols(q).find(s => s.description === "handle");
        const handle = q[handleSym];
        protoRun ??= Object.getPrototypeOf(handle).run;
        Object.defineProperty(handle, "run", {
          configurable: true,
          writable: true,
          value(connection, query) {
            nativeConnection = connection;
            runCount++;
            return protoRun.call(this, connection, query);
          },
        });
      }

      // Wait until the pool has handed the native connection to every query
      // (requires real event-loop ticks, not just microtasks).
      while (runCount < queries.length) await new Promise(r => setImmediate(r));

      // Drop the socket -> on_close -> fail_with_js_value
      // -> MySQLRequestQueue.clean() with all 5 requests still pending.
      socketRef.destroy();

      const codes = await Promise.all(settled);

      // Yield to the event loop so the native clean() stack frame that invoked
      // our .catch() handlers resumes and finishes.
      await new Promise(r => setImmediate(r));

      console.log("ok", JSON.stringify(codes));
      process.exit(0);
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      env: {
        ...bunEnv,
        // A crash here writes a multi-GB core dump that outlives the default
        // test timeout; the stderr panic trace is the useful signal.
        ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=1",
        BUN_ENABLE_CRASH_REPORTING: "0",
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toStartWith("ok ");
    // Every pending query must have been rejected exactly once.
    const codes = JSON.parse(stdout.slice(3));
    expect(codes).toEqual([
      "ERR_MYSQL_CONNECTION_CLOSED",
      "ERR_MYSQL_CONNECTION_CLOSED",
      "ERR_MYSQL_CONNECTION_CLOSED",
      "ERR_MYSQL_CONNECTION_CLOSED",
      "ERR_MYSQL_CONNECTION_CLOSED",
    ]);
    expect(exitCode).toBe(0);
  },
);
