// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// The SQL drivers kept the raw us_socket_t* in self.socket after
// on_close/on_connect_error; usockets frees it at end-of-tick, so later
// reads (timer callbacks, ref()/unref()/close()) were heap-use-after-free.
// Capture the native handle via the query handle's .run(connection, …),
// drop the server socket, yield past the free, then touch the handle.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import path from "node:path";

const wireFrames = path.join(import.meta.dir, "wire-frames.ts");

const drivers = [
  {
    name: "postgres",
    // .ref() calls update_has_pending_activity() which reads
    // self.socket.is_closed() when the connection is in a terminal state.
    touch: "nativeConnection.ref(); nativeConnection.unref();",
    server: /* js */ `
      import { pgAuthenticationOk, pgReadyForQuery } from ${JSON.stringify(wireFrames)};
      export const url = port => \`postgres://postgres@127.0.0.1:\${port}/db\`;
      export function onSocket(socket) {
        socket.once("data", () => {
          socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        });
        socket.on("error", () => {});
      }`,
  },
  {
    name: "mysql",
    // .close() on a failed connection calls clean_queue_and_close() which
    // calls self.socket.close() and so reads the freed is_closed flag.
    touch: "nativeConnection.close();",
    server: /* js */ `
      import { mysqlHandshakeV10, mysqlOkPacket } from ${JSON.stringify(wireFrames)};
      export const url = port => \`mysql://root@127.0.0.1:\${port}/db\`;
      export function onSocket(socket) {
        let buffered = Buffer.alloc(0), authed = false;
        socket.write(mysqlHandshakeV10());
        socket.on("data", chunk => {
          buffered = Buffer.concat([buffered, chunk]);
          while (buffered.length >= 4) {
            const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
            if (buffered.length < 4 + len) break;
            const seq = buffered[3];
            buffered = buffered.subarray(4 + len);
            if (!authed) { authed = true; socket.write(mysqlOkPacket(seq + 1)); }
            // never respond to queries, so they stay in the native request queue
          }
        });
        socket.on("error", () => {});
      }`,
  },
] as const;

// The failure is a 1-byte heap-use-after-free; it is only observable under
// ASAN (debug builds enable ASAN).
for (const { name, touch, server } of drivers) {
  test.skipIf(!isDebug && !isASAN)(
    `${name}: touching the native connection after the socket is freed does not read freed memory`,
    async () => {
      using dir = tempDir(`sql-conn-socket-uaf-${name}`, {
        "server.ts": server,
        "fixture.ts": /* js */ `
          import net from "node:net";
          import { once } from "node:events";
          import { SQL } from "bun";
          import { onSocket, url } from "./server.ts";

          let socketRef;
          const server = net.createServer(socket => {
            socketRef = socket;
            onSocket(socket);
          });
          server.listen(0, "127.0.0.1");
          await once(server, "listening");
          const { port } = server.address();

          const sql = new SQL({ url: url(port), max: 1, connectionTimeout: 30 });

          // Capture the native connection by shadowing the query handle's
          // .run(connection, query) — the pool hands it the native handle.
          let nativeConnection;
          let runCount = 0;
          const q = sql\`select 1\`;
          q.values(); // force lazy creation of the native query handle
          const handleSym = Object.getOwnPropertySymbols(q).find(s => s.description === "handle");
          const handle = q[handleSym];
          const protoRun = Object.getPrototypeOf(handle).run;
          Object.defineProperty(handle, "run", {
            configurable: true,
            writable: true,
            value(connection, query) {
              nativeConnection = connection;
              runCount++;
              return protoRun.call(this, connection, query);
            },
          });
          const settled = q.catch(err => err?.code ?? String(err));

          // Wait for the connection to establish and the query to enqueue.
          while (runCount === 0) await new Promise(r => setImmediate(r));

          // Replace the pool's JS onclose so it does not pre-emptively drop
          // our reference; we want the native connection to outlive the
          // socket by at least one tick.
          nativeConnection.onclose = () => {};

          // Server drops the socket -> native on_close -> status=Failed. The
          // us_socket_t goes onto closed_head and is freed at the end of the
          // current usockets tick.
          socketRef.destroy();

          // Yield past us_internal_free_closed_sockets.
          for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));

          // Without the fix this reads s->flags.is_closed on a freed
          // us_socket_t and ASAN aborts with heap-use-after-free.
          ${touch}

          await settled;
          // A second round of touches after the promise machinery has
          // settled covers the re-entrant path the timer originally hit.
          ${touch}

          console.log("ok");
          process.exit(0);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.ts"],
        env: {
          ...bunEnv,
          // symbolize=0: the full symbolized report under debug+ASAN can
          // take tens of seconds; we only need to see the crash, not the
          // stack.
          ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=1:symbolize=0",
          BUN_ENABLE_CRASH_REPORTING: "0",
        },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        timeout: 20_000,
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // stderr is kept in the diff via expect.any(String); the failure
      // signal is the missing "ok\n" and non-zero exitCode (ASAN aborts).
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "ok\n",
        stderr: expect.any(String),
        exitCode: 0,
      });
    },
  );
}
