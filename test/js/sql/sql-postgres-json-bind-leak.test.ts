// PostgresRequest.write_bind's json/jsonb arm calls json_stringify_fast, which
// writes a +1 WTFStringImpl ref into a bun_core::String. bun_core::String is
// Copy with no Drop; the Zig original had `defer str.deref()`. Without wrapping
// in OwnedString the impl is leaked once per JSON parameter bound.
//
// The json/jsonb arm is reached once the prepared statement's ParameterDescription
// has populated statement.parameters with oid 114 (json) or 3802 (jsonb), so a
// mock server that replies ParameterDescription([114]) is enough; no Docker.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Postgres: JSON.stringify result for json/jsonb bind parameter is not leaked", async () => {
  using dir = tempDir("postgres-json-bind-leak", {
    "fixture.js": /* js */ `
      const net = require("net");
      const { SQL } = require("bun");

      function pkt(type, body) {
        const header = Buffer.alloc(5);
        header.write(type, 0);
        header.writeInt32BE(body.length + 4, 1);
        return Buffer.concat([header, body]);
      }
      function i16(n) { const b = Buffer.alloc(2); b.writeInt16BE(n, 0); return b; }
      function i32(n) { const b = Buffer.alloc(4); b.writeInt32BE(n, 0); return b; }
      function cstr(s) { return Buffer.concat([Buffer.from(s), Buffer.from([0])]); }

      const authenticationOk = pkt("R", i32(0));
      const readyForQuery = pkt("Z", Buffer.from("I"));
      const parseComplete = pkt("1", Buffer.alloc(0));
      // One parameter, oid 114 = json, so subsequent Bind messages take the
      // json arm in write_bind.
      const parameterDescription = pkt("t", Buffer.concat([i16(1), i32(114)]));
      const noData = pkt("n", Buffer.alloc(0));
      const bindComplete = pkt("2", Buffer.alloc(0));
      const commandComplete = pkt("C", cstr("SELECT 0"));

      const server = net.createServer(socket => {
        let buf = Buffer.alloc(0);
        let startup = true;
        socket.on("data", chunk => {
          buf = Buffer.concat([buf, chunk]);
          const out = [];
          while (true) {
            if (startup) {
              if (buf.length < 4) break;
              const len = buf.readInt32BE(0);
              if (buf.length < len) break;
              buf = buf.subarray(len);
              startup = false;
              out.push(authenticationOk, readyForQuery);
              continue;
            }
            if (buf.length < 5) break;
            const type = buf[0];
            const len = buf.readInt32BE(1);
            if (buf.length < 1 + len) break;
            buf = buf.subarray(1 + len);
            switch (type) {
              case 0x50: /* P */ out.push(parseComplete); break;
              case 0x44: /* D */ out.push(parameterDescription, noData); break;
              case 0x42: /* B */ out.push(bindComplete); break;
              case 0x45: /* E */ out.push(commandComplete); break;
              case 0x53: /* S */ out.push(readyForQuery); break;
              case 0x48: /* H */ break; // Flush
              case 0x58: /* X */ socket.end(); return; // Terminate
            }
          }
          if (out.length) socket.write(Buffer.concat(out));
        });
        socket.on("error", () => {});
      });

      server.listen(0, "127.0.0.1");
      await new Promise(r => server.on("listening", r));
      const { port } = server.address();

      const sql = new SQL({ url: \`postgres://u@127.0.0.1:\${port}/db\`, max: 1 });

      // ~512 KiB of JSON per bind; the WTFStringImpl backing the stringified
      // payload is what leaks.
      const payload = { data: Buffer.alloc(512 * 1024, 0x61).toString("latin1") };

      // Warm up: first query sends Parse+Describe so statement.parameters is
      // populated from ParameterDescription before the measured loop.
      for (let i = 0; i < 4; i++) await sql\`select \${payload}::json\`;
      Bun.gc(true);
      const rssBefore = process.memoryUsage.rss();

      const ITERATIONS = 300;
      for (let i = 0; i < ITERATIONS; i++) {
        await sql\`select \${payload}::json\`;
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
    env: {
      ...bunEnv,
      // ASAN's freed-block quarantine pins RSS at peak; disable it so freed
      // WTFStringImpls actually return to the allocator under bun-debug.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const filteredStderr = stderr
    .split("\n")
    .filter(line => !line.startsWith("WARNING: ASAN interferes"))
    .join("\n")
    .trim();
  expect(filteredStderr).toBe("");
  const { deltaMiB } = JSON.parse(stdout.trim());
  // With the leak, every one of the ~300 x 512 KiB stringified payloads is
  // retained (>= ~150 MiB). With the fix the WTFStringImpl is deref'd on scope
  // exit and growth stays in single digits.
  expect(deltaMiB).toBeLessThan(50);
  expect(exitCode).toBe(0);
}, 60_000);
