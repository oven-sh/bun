// MySQLQuery.init() used to `query.ref()` the bun.String it was handed, but
// the only caller (JSMySQLQuery.createInstance) already passes a +1-ref'd
// string from `JSValue.toBunString()`. That left every query string at
// refcount 2 after construction; MySQLQuery.cleanup() only deref'd once, so
// the underlying WTFStringImpl for every MySQL query string was leaked.
//
// This test uses a minimal mock MySQL server (no Docker required) that OKs
// every simple query, runs a batch of large unique query strings through it,
// lets the MySQLQuery wrappers be finalized, and checks RSS didn't retain the
// query-string bytes.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("MySQL: query string is not leaked across query lifecycle", async () => {
  using dir = tempDir("mysql-query-string-leak", {
    "fixture.js": /* js */ `
      const net = require("net");
      const { SQL } = require("bun");

      function u16le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff]); }
      function u24le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]); }
      function u32le(n) { return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]); }
      function packet(seq, payload) { return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]); }

      // CLIENT_PROTOCOL_41 | CLIENT_SECURE_CONNECTION | CLIENT_PLUGIN_AUTH |
      // CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA | CLIENT_DEPRECATE_EOF
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
      // header 0x00, affected_rows 0, last_insert_id 0, status_flags 0x0002, warnings 0
      function okPacket(seq) { return packet(seq, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])); }

      const server = net.createServer(socket => {
        let buffered = Buffer.alloc(0), authed = false;
        socket.write(handshakeV10());
        socket.on("data", chunk => {
          buffered = Buffer.concat([buffered, chunk]);
          while (buffered.length >= 4) {
            const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
            if (buffered.length < 4 + len) break;
            const seq = buffered[3];
            buffered = buffered.subarray(4 + len);
            if (!authed) { authed = true; socket.write(okPacket(seq + 1)); continue; }
            // Any subsequent packet (COM_QUERY / COM_QUIT / ...) -> OK. Sequence
            // id resets per command, so the response starts at seq+1 (== 1).
            socket.write(okPacket(seq + 1));
          }
        });
        socket.on("error", () => {});
      });

      server.listen(0, "127.0.0.1");
      await new Promise(r => server.on("listening", r));
      const { port } = server.address();

      const sql = new SQL({ url: \`mysql://root@127.0.0.1:\${port}/db\`, max: 1 });

      // Warm up: first query allocates connection buffers, JIT, etc.
      await sql.unsafe("select 1").simple();

      // Each query string is ~512 KiB and unique (so JSC can't dedupe/intern
      // them) and goes through the full create -> run -> finalize lifecycle.
      // 200 iterations x 512 KiB = ~100 MiB of string payload.
      const ITERATIONS = 200;
      const CHUNK = 512 * 1024;

      Bun.gc(true);
      const rssBefore = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        const pad = Buffer.alloc(CHUNK, 0x61 + (i % 26)).toString("latin1");
        // Embed the bulk as a comment so the mock server's OK reply is valid
        // regardless of content; suffix makes every string unique.
        const q = "select 1 /* " + pad + " " + i + " */";
        await sql.unsafe(q).simple();
        if ((i & 15) === 15) Bun.gc(true);
      }

      await sql.close({ timeout: 0 }).catch(() => {});
      server.close();

      // Give the MySQLQuery wrappers a chance to be finalized so cleanup()
      // runs and drops its (single) ref on each query string.
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setImmediate(r));
        Bun.gc(true);
      }

      const rssAfter = process.memoryUsage.rss();
      const deltaMiB = (rssAfter - rssBefore) / 1024 / 1024;
      console.log(JSON.stringify({ rssBefore, rssAfter, deltaMiB }));
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
  const { deltaMiB } = JSON.parse(stdout.trim());
  // With the leak, every one of the ~200 x 512 KiB query strings is retained
  // (plus per-string overhead), so RSS grows by >= ~100 MiB. With the fix the
  // strings are freed as each MySQLQuery is finalized and growth stays small.
  expect(deltaMiB).toBeLessThan(50);
  expect(exitCode).toBe(0);
  // 200 × 512 KiB round-trips plus ~20 Bun.gc(true) calls in an ASAN debug
  // subprocess take ~6–17s; the 5s default is too tight. Same reason as
  // postgres-tls-ctx-leak.test.ts.
}, 60_000);
