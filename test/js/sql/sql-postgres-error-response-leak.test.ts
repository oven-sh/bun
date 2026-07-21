// FieldMessage held +1 WTFStringImpl refs (clone_utf8) in a Copy bun_core::String
// with no Drop, leaking every Postgres ErrorResponse/NoticeResponse field string.
// Mock server sends large-field Notice+Error per query; RSS growth must stay bounded.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { listeningServer, pgAuthenticationOk, pgErrorResponse, pgNoticeResponse, pgReadyForQuery } from "./wire-frames";

test("Postgres: ErrorResponse/NoticeResponse field strings are not leaked", async () => {
  // ~256 KiB per field. 6 fields x 256 KiB x 300 iterations ~= 450 MiB of WTFStringImpl payload.
  const BIG = Buffer.alloc(256 * 1024, 0x61).toString("latin1");
  // NoticeResponse is decoded and immediately dropped; ErrorResponse is
  // converted to a JS error then dropped. Both paths leak without the fix.
  const queryReply = Buffer.concat([
    pgNoticeResponse({ S: "NOTICE", C: "00000", M: BIG, D: BIG, H: BIG }),
    pgErrorResponse({ S: "ERROR", C: "42P01", M: BIG, D: BIG, H: BIG }),
    pgReadyForQuery(),
  ]);

  const { port, server } = await listeningServer(socket => {
    let startup = true;
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      if (data[0] === 0x51 /* 'Q' */) socket.write(queryReply);
    });
    socket.on("error", () => {});
  });

  // Only the SQL client runs in the subprocess so its RSS reflects only the
  // leak under test; the mock server lives in this process.
  using dir = tempDir("postgres-error-response-leak", {
    "fixture.js": /* js */ `
      const { SQL } = require("bun");
      const port = Number(process.argv[2]);

      const sql = new SQL({
        url: \`postgres://u@127.0.0.1:\${port}/db\`,
        max: 1,
        idleTimeout: 5,
        connectionTimeout: 5,
      });

      // Warm up (connection buffers, JIT) and capture the error shape so the
      // RSS check can't pass vacuously if the decoder stops rejecting.
      let warmupErrno, warmupCode;
      try { await sql\`select 1\`.simple(); } catch (e) {
        warmupErrno = e?.errno;
        warmupCode = e?.code;
      }

      const ITERATIONS = 300;
      let errorCount = 0;

      Bun.gc(true);
      const rssBefore = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        try { await sql\`select 1\`.simple(); } catch (e) {
          if (e?.errno === "42P01") errorCount++;
        }
        if ((i & 15) === 15) Bun.gc(true);
      }

      await sql.close({ timeout: 0 }).catch(() => {});

      for (let i = 0; i < 8; i++) {
        await new Promise(r => setImmediate(r));
        Bun.gc(true);
      }

      const rssAfter = process.memoryUsage.rss();
      const deltaMiB = (rssAfter - rssBefore) / 1024 / 1024;
      console.log(JSON.stringify({ warmupErrno, warmupCode, errorCount, ITERATIONS, rssBefore, rssAfter, deltaMiB }));
    `,
  });

  let stdout: string, stderr: string, exitCode: number;
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js", String(port)],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    });
    [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  } finally {
    server.close();
  }

  let result: { warmupErrno: unknown; warmupCode: unknown; errorCount: number; ITERATIONS: number; deltaMiB: number };
  try {
    result = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`fixture did not emit JSON\nexitCode: ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
  // Every query must have rejected with the server-sent 42P01 ErrorResponse;
  // otherwise the RSS check below is meaningless.
  expect({
    errno: result.warmupErrno,
    code: result.warmupCode,
    ITERATIONS: result.ITERATIONS,
    errorCount: result.errorCount,
  }).toEqual({
    errno: "42P01",
    code: "ERR_POSTGRES_SERVER_ERROR",
    ITERATIONS: 300,
    errorCount: 300,
  });
  // Without the fix RSS grows by ~450 MiB of retained field strings. ASAN
  // quarantine holds freed allocations so the threshold is wider there.
  expect(result.deltaMiB).toBeLessThan(isASAN ? 250 : 60);
  expect(exitCode).toBe(0);
}, 120_000);
