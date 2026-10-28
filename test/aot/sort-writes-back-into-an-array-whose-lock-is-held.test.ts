// Only the `jsc` shell can hold the lock of a cell, so this program runs there in every run. shell/tools.ts says what the script needs.
import { expect, test } from "bun:test";
import { join } from "path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

const program = "arrays/sort-writes-back-into-an-array-whose-lock-is-held";

if (scriptSkipReason && !unsupported)
  console.error(`SKIPPED: test/aot/sort-writes-back-into-an-array-whose-lock-is-held.test.ts: ${scriptSkipReason}`);

test.skipIf(!!scriptSkipReason)(
  "sort() answers as plain Bun does while the lock of the array is held",
  async () => {
    const { stdout, stderr, exitCode } = await run(
      [python!, join(import.meta.dir, "shell", "quick.py"), program],
      undefined,
      scriptEnvironment(),
    );
    expect(stderr).toBe("");
    expect(stdout).toMatch(new RegExp(`^${program}: same \\([0-9]+ lines\\)\n$`));
    expect(exitCode).toBe(0);
  },
  120_000,
);
