// harness-env.test.ts runs this file with NODE_ENV and BUN_ENV exported.
import { test } from "bun:test";
import { bunEnv } from "harness";

test("print the mode variables that the harness passes on", () => {
  console.log(
    JSON.stringify({
      bunEnv: { NODE_ENV: bunEnv.NODE_ENV ?? null, BUN_ENV: bunEnv.BUN_ENV ?? null },
      processEnv: { NODE_ENV: process.env.NODE_ENV ?? null, BUN_ENV: process.env.BUN_ENV ?? null },
    }),
  );
});
