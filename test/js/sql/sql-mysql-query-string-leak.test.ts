// MySQLQuery.init() used to `query.ref()` the bun.String it was handed, but
// the only caller (JSMySQLQuery.createInstance) already passes a +1-ref'd
// string from `JSValue.toBunString()`. That left every query string at
// refcount 2 after construction; MySQLQuery.cleanup() only deref'd once, so
// the underlying WTFStringImpl for every MySQL query string was leaked.
//
// This test runs a batch of large unique query strings against a real MySQL
// server, lets the MySQLQuery wrappers be finalized, and checks RSS didn't
// retain the query-string bytes.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isASAN, isDockerEnabled, tempDir } from "harness";

if (isDockerEnabled()) {
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test("MySQL: query string is not leaked across query lifecycle", async () => {
      await container.ready;
      const url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;

      using dir = tempDir("mysql-query-string-leak", {
        "fixture.js": /* js */ `
        const { SQL } = require("bun");

        const sql = new SQL({ url: process.env.MYSQL_URL, max: 1 });

        // Each query string is ~512 KiB and unique (so JSC can't dedupe/intern
        // them) and goes through the full create -> run -> finalize lifecycle.
        // 200 iterations x 512 KiB = ~100 MiB of string payload.
        const ITERATIONS = 200;
        const CHUNK = 512 * 1024;

        // The label keeps every string unique across both batches.
        async function runBatch(count, label) {
          for (let i = 0; i < count; i++) {
            const pad = Buffer.alloc(CHUNK, 0x61 + (i % 26)).toString("latin1");
            // Embed the bulk as a comment so the server's reply is a trivial OK
            // regardless of content.
            const q = "select 1 /* " + label + " " + pad + " " + i + " */";
            await sql.unsafe(q).simple();
            if ((i & 15) === 15) Bun.gc(true);
          }
        }

        // Give the MySQLQuery wrappers a chance to be finalized so cleanup()
        // runs and drops its (single) ref on each query string.
        async function drainFinalizers() {
          for (let i = 0; i < 8; i++) {
            await new Promise(r => setImmediate(r));
            Bun.gc(true);
          }
        }

        // Warm up with the same workload so connection buffers, JIT, and the
        // allocator high-water mark (the inter-GC peak of the transient query
        // strings; RSS rarely shrinks back) are all established before the
        // baseline snapshot. The measured delta then isolates *retained*
        // strings instead of first-touch heap growth.
        await runBatch(32, "warmup");
        await drainFinalizers();

        Bun.gc(true);
        const rssBefore = process.memoryUsage.rss();

        await runBatch(ITERATIONS, "measured");

        await sql.close({ timeout: 0 }).catch(() => {});

        await drainFinalizers();

        const rssAfter = process.memoryUsage.rss();
        const deltaMiB = (rssAfter - rssBefore) / 1024 / 1024;
        console.log(JSON.stringify({ rssBefore, rssAfter, deltaMiB }));
      `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.js"],
        env: { ...bunEnv, MYSQL_URL: url },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        timeout: 120_000,
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      let parsed: { deltaMiB: number };
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        throw new Error(`fixture did not emit JSON\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }
      // With the leak, every one of the ~200 x 512 KiB query strings is retained
      // (plus per-string overhead), so RSS grows by >= ~100 MiB. With the fix the
      // strings are freed as each MySQLQuery is finalized and growth stays small.
      // ASAN's quarantine retains freed allocations (default 256 MB) and a real
      // server adds wire-buffer + encode churn on top of the string churn, so the
      // delta runs higher under bun-asan even with the fix; widen the threshold
      // there. The non-ASAN bound is the discriminating check.
      expect(parsed.deltaMiB).toBeLessThan(isASAN ? 384 : 50);
      expect(exitCode).toBe(0);
      // ~230 × 512 KiB round-trips to a real MySQL server plus ~30 Bun.gc(true)
      // calls in an ASAN debug subprocess can take tens of seconds; the 5s
      // default is too tight.
    }, 120_000);
  });
}
