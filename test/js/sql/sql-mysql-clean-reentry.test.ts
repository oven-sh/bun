// MySQLRequestQueue.clean() iterated the live queue while running reject
// callbacks. rejectWithJSValue() runs JS via event_loop.runCallback(), whose
// exit() drains microtasks when the outer entered_event_loop_count is 0.
// User code reachable from that drain can call MySQLConnection.close(),
// which re-enters clean(). The inner call deref()'d + discard()'d the same
// requests out from under the outer loop; when the outer loop resumed it
// called LinearFifo.discard(1) on an empty fifo (debug assert -> panic) and
// deref() on an already-deref'd request (release -> double free / UAF).
//
// Uses a minimal mock MySQL server so it can run without Docker.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// The failure mode is a debug assert in LinearFifo.discard() (and a UAF under
// ASAN); in release builds the underflow is UB and may not crash, so only run
// where it is observable.
test.skipIf(!isDebug && !isASAN)(
  "MySQL: clean() is safe when reject callback re-enters via connection.close()",
  async () => {
    using dir = tempDir("mysql-clean-reentry", {
      "fixture.js": /* js */ `
      const net = require("net");
      const { SQL } = require("bun");

      function u16le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff]); }
      function u24le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]); }
      function u32le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]); }
      function packet(seq, payload) { return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]); }

      const SERVER_CAPS = (1 << 9) | (1 << 15) | (1 << 19) | (1 << 21) | (1 << 24);
      function handshakeV10() {
        const authData1 = Buffer.alloc(8, 0x61);
        const authData2 = Buffer.alloc(13, 0x62);
        authData2[12] = 0;
        return packet(0, Buffer.concat([
          Buffer.from([10]), Buffer.from("mock-5.7.0\\0"), u32le(1), authData1,
          Buffer.from([0]), u16le(SERVER_CAPS & 0xffff), Buffer.from([0x2d]),
          u16le(0x0002), u16le((SERVER_CAPS >>> 16) & 0xffff), Buffer.from([21]),
          Buffer.alloc(10, 0), authData2, Buffer.from("mysql_native_password\\0"),
        ]));
      }
      function okPacket(seq) { return packet(seq, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])); }

      let socketRef;
      const server = net.createServer(socket => {
        socketRef = socket;
        let buffered = Buffer.alloc(0), authed = false;
        socket.write(handshakeV10());
        socket.on("data", chunk => {
          buffered = Buffer.concat([buffered, chunk]);
          while (buffered.length >= 4) {
            const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
            if (buffered.length < 4 + len) break;
            const seq = buffered[3];
            buffered = buffered.subarray(4 + len);
            if (!authed) { authed = true; socket.write(okPacket(seq + 1)); }
            // Never respond to queries -> they stay in the native request queue.
          }
        });
        socket.on("error", () => {});
      });

      server.listen(0, "127.0.0.1");
      await new Promise(r => server.on("listening", r));
      const { port } = server.address();

      const sql = new SQL({ url: \`mysql://root@127.0.0.1:\${port}/db\`, max: 1 });

      // Obtain the native MySQLConnection by shadowing the first query handle's
      // .run(connection, query) with an own-property before the pool invokes it.
      let nativeConnection;
      const q0 = sql\`select 0\`;
      q0.values(); // force lazy creation of the native MySQLQuery handle
      const handleSym = Object.getOwnPropertySymbols(q0).find(s => s.description === "handle");
      const handle = q0[handleSym];
      const protoRun = Object.getPrototypeOf(handle).run;
      Object.defineProperty(handle, "run", {
        configurable: true,
        writable: true,
        value(connection, query) {
          nativeConnection = connection;
          return protoRun.call(this, connection, query);
        },
      });

      // Queue several more queries on the same (max: 1) connection so the native
      // request queue has multiple entries when clean() runs.
      const queries = [q0, sql\`select 1\`, sql\`select 2\`, sql\`select 3\`, sql\`select 4\`];
      const settled = queries.map(q =>
        q.catch(err => {
          // Re-enter clean() synchronously: this runs in the microtask drain that
          // follows each rejectWithJSValue() call inside the outer clean().
          try { nativeConnection?.close(); } catch {}
          return err?.code ?? String(err);
        })
      );

      // Wait until the pool has actually handed the native connection to q0
      // (requires real event-loop ticks, not just microtasks).
      while (nativeConnection == null) await new Promise(r => setImmediate(r));
      // Let the remaining queries flow into the native queue.
      for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));

      // Replace the pool's JS onclose handler with a no-op so it does not
      // pre-emptively reject the queries before native clean() runs. That leaves
      // failWithJSValue's deferred clean() to do the rejecting at elc==0, where
      // runCallback.exit() drains microtasks between requests and lets the
      // .catch() handlers above re-enter clean().
      nativeConnection.onclose = () => {};

      // Drop the socket -> onClose -> failWithJSValue -> defer cleanQueueAndClose
      // -> MySQLRequestQueue.clean() with all 5 requests still pending.
      socketRef.destroy();

      const codes = await Promise.all(settled);

      // Yield to the event loop so the native clean() stack frame that invoked
      // our .catch() handlers resumes and finishes (this is where the old code
      // would discard(1) on the now-empty fifo and panic).
      await new Promise(r => setImmediate(r));

      console.log("ok", JSON.stringify(codes));
      process.exit(0);
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
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
  30_000,
);
