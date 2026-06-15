// Postgres ErrorResponse/NoticeResponse field strings are allocated via
// bun_core::String::clone_utf8 (refcount 1) and stored in FieldMessage enum
// variants. bun_core::String is Copy with no Drop, so without an explicit
// Drop impl on FieldMessage the +1 ref is never released and every server
// error or NOTICE leaks its severity/code/message/detail/... strings for the
// life of the process.
//
// Uses a minimal mock Postgres server (no Docker). For each simple query the
// server replies with a NoticeResponse and an ErrorResponse that each carry a
// large message field; the client loops, catches the errors, forces GC, and
// checks RSS did not retain the field-string bytes.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

test("Postgres: ErrorResponse/NoticeResponse field strings are not leaked", async () => {
  using dir = tempDir("postgres-error-response-leak", {
    "fixture.js": /* js */ `
      const net = require("net");
      const { SQL } = require("bun");

      function pkt(type, body) {
        const header = Buffer.alloc(5);
        header.write(type, 0);
        header.writeInt32BE(body.length + 4, 1);
        return Buffer.concat([header, body]);
      }
      function i32(n) { const b = Buffer.alloc(4); b.writeInt32BE(n, 0); return b; }
      function cstr(s) { return Buffer.concat([Buffer.from(s), Buffer.from([0])]); }

      const authenticationOk = pkt("R", i32(0));
      const readyForQuery = pkt("Z", Buffer.from("I"));

      // ~256 KiB per message field. Unique per connection is not required: the
      // leak is a missed deref of a freshly-allocated WTFStringImpl, not a
      // dedup/intern miss.
      const BIG = Buffer.alloc(256 * 1024, 0x61).toString("latin1");

      // ErrorResponse/NoticeResponse body: repeated (field-type byte, cstring)
      // terminated by a zero byte. Use several large fields so the leaked bytes
      // per iteration are unambiguous.
      const errorBody = Buffer.concat([
        Buffer.from("S"), cstr("ERROR"),
        Buffer.from("C"), cstr("42P01"),
        Buffer.from("M"), cstr(BIG),
        Buffer.from("D"), cstr(BIG),
        Buffer.from("H"), cstr(BIG),
        Buffer.from([0]),
      ]);
      const noticeBody = Buffer.concat([
        Buffer.from("S"), cstr("NOTICE"),
        Buffer.from("C"), cstr("00000"),
        Buffer.from("M"), cstr(BIG),
        Buffer.from("D"), cstr(BIG),
        Buffer.from("H"), cstr(BIG),
        Buffer.from([0]),
      ]);
      // NoticeResponse is decoded and immediately dropped; ErrorResponse is
      // converted to a JS error then dropped. Both paths leak without the fix.
      const queryReply = Buffer.concat([
        pkt("N", noticeBody),
        pkt("E", errorBody),
        readyForQuery,
      ]);

      const server = net.createServer(socket => {
        let buffered = Buffer.alloc(0);
        let startup = true;
        socket.on("data", chunk => {
          buffered = Buffer.concat([buffered, chunk]);
          while (true) {
            if (startup) {
              // Startup message: no type byte, just int32 length + body.
              if (buffered.length < 4) return;
              const len = buffered.readInt32BE(0);
              if (buffered.length < len) return;
              buffered = buffered.subarray(len);
              startup = false;
              socket.write(Buffer.concat([authenticationOk, readyForQuery]));
              continue;
            }
            // Regular message: 1-byte type + int32 length (length counts itself).
            if (buffered.length < 5) return;
            const type = buffered[0];
            const len = buffered.readInt32BE(1);
            if (buffered.length < 1 + len) return;
            buffered = buffered.subarray(1 + len);
            if (type === 0x51 /* 'Q' */) socket.write(queryReply);
            // 'X' (Terminate) and everything else: ignore.
          }
        });
        socket.on("error", () => {});
      });

      server.listen(0, "127.0.0.1");
      await new Promise(r => server.on("listening", r));
      const { port } = server.address();

      const sql = new SQL({
        url: \`postgres://u@127.0.0.1:\${port}/db\`,
        max: 1,
        idleTimeout: 5,
        connectionTimeout: 5,
      });

      // Warm up: first query allocates connection buffers, JIT, etc.
      try { await sql\`select 1\`.simple(); } catch {}

      // 6 fields x 256 KiB x 300 iterations ~= 450 MiB of WTFStringImpl payload.
      const ITERATIONS = 300;

      Bun.gc(true);
      const rssBefore = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        try { await sql\`select 1\`.simple(); } catch {}
        if ((i & 15) === 15) Bun.gc(true);
      }

      await sql.close({ timeout: 0 }).catch(() => {});
      server.close();

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
    timeout: 120_000,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  let deltaMiB: number;
  try {
    ({ deltaMiB } = JSON.parse(stdout.trim()));
  } catch {
    throw new Error(`fixture did not emit JSON\nexitCode: ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
  // Without the fix every FieldMessage string is retained, so RSS grows by
  // roughly the full ~450 MiB of payload. With the fix the strings are
  // released when each ErrorResponse/NoticeResponse drops and growth stays
  // bounded by connection buffers plus allocator slack. ASAN quarantine
  // retains freed allocations so the threshold is wider there.
  expect(deltaMiB).toBeLessThan(isASAN ? 250 : 60);
  expect(exitCode).toBe(0);
}, 120_000);
