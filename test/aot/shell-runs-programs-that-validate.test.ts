// The scripts in ./shell build programs without Bun's modules and run them in the `jsc` shell. heat.py, bad-time.py and collector-stress.py only
// count a program that quick.py calls `same`, so a program the shell can't run drops out of them without a word. These import `JSON` from "bun" and
// `validate` from "bun:bundle", as every program that validates does. shell/tools.ts says what the scripts need.
import { expect, test } from "bun:test";
import { join } from "path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

const programs = [
  "data-from-outside/json-imported-from-bun",
  "data-from-outside/shared-validation-functions",
  "data-from-outside/typed-parse-single-pass",
  "data-from-outside/validate-returns-a-copy",
];

if (scriptSkipReason && !unsupported)
  console.error(`SKIPPED: test/aot/shell-runs-programs-that-validate.test.ts: ${scriptSkipReason}`);

test.skipIf(!!scriptSkipReason)(
  'the shell runs programs that import JSON from "bun"',
  async () => {
    const { stdout, stderr, exitCode } = await run(
      [python!, join(import.meta.dir, "shell", "quick.py"), ...programs],
      undefined,
      scriptEnvironment(),
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(line => line !== "" && !/^[^ ]+: same \([0-9]+ lines\)$/.test(line))).toEqual([]);
    expect(exitCode).toBe(0);
  },
  290_000,
);
