// #3548 - Database clients that maintain persistent connections don't allow Bun process to exit
//
// This test verifies that idle PostgreSQL connections allow the process to exit.
// The fix modifies `updateRef()` in PostgresSQLConnection.zig to unref the poll
// when the connection is idle (connected with no pending queries).
//
// The actual fix test is in test/js/sql/sql.test.ts ("idle connection allows process to exit #3548")
// This file documents the issue and provides a reference.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDockerEnabled, tempDir } from "harness";
import path from "path";

describe.skipIf(!isDockerEnabled())("issue #3548 - idle SQL connection should allow process exit", () => {
  test("process exits after SQL query completes", async () => {
    // Create a test script that runs a query and should exit naturally
    using dir = tempDir("issue-3548", {
      "test.ts": `
        import { sql } from "bun";

        async function main() {
          // Run a simple query
          const result = await sql\`select 1 as x\`;
          console.log("done:", result[0].x);
          // Process should exit here without explicitly closing the connection
        }

        main();
      `,
    });

    // This test requires DATABASE_URL to be set with a valid PostgreSQL connection
    if (!process.env.DATABASE_URL) {
      console.log("Skipping: DATABASE_URL not set");
      return;
    }

    await using proc = Bun.spawn([bunExe(), path.join(String(dir), "test.ts")], {
      env: { ...bunEnv, DATABASE_URL: process.env.DATABASE_URL },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for exit with timeout - before fix, this would hang indefinitely
    const exitPromise = proc.exited;
    const timeout = new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), 10000));

    const result = await Promise.race([exitPromise, timeout]);

    if (result === "timeout") {
      proc.kill();
      throw new Error("Process hung - idle connection prevented exit (issue #3548)");
    }

    const stdout = await new Response(proc.stdout).text();
    expect(stdout.trim()).toBe("done: 1");
    expect(result).toBe(0);
  });
});
