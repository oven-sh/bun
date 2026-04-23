/**
 * This test runs under both `node --test` and `bun test`.
 *
 * On macOS the hard RLIMIT_NOFILE defaults to RLIM_INFINITY. Both Bun and Node
 * raise the soft limit on startup; Node caps the raise at 1<<20. Raising it
 * anywhere near INT_MAX breaks child processes that read the limit into an int.
 *
 * The test lowers the soft limit to 256 before exec'ing the runtime so its
 * startup raise actually runs (neither Bun nor Node lowers an already-high
 * limit), then checks what a grandchild shell sees.
 */
import assert from "node:assert";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

test(
  "child process inherits a sane RLIMIT_NOFILE (capped at 1<<20)",
  { skip: process.platform === "win32" },
  async () => {
    const inner = `console.log(require("child_process").execFileSync("/bin/sh", ["-c", "ulimit -Sn"]).toString().trim())`;
    const { stdout } = await execFileP(
      "/bin/sh",
      ["-c", `ulimit -Sn 256; exec "$1" -e "$2"`, "sh", process.execPath, inner],
      { env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } },
    );

    const soft = stdout.trim();
    assert.notStrictEqual(soft, "unlimited", `soft NOFILE limit should be capped, got "unlimited"`);
    const n = Number(soft);
    assert.ok(Number.isFinite(n), `expected numeric limit, got ${JSON.stringify(soft)}`);
    assert.ok(n > 256, `runtime should raise the soft limit above 256, got ${n}`);
    assert.ok(n <= 1 << 20, `runtime should cap the soft limit at 1<<20, got ${n}`);
  },
);
