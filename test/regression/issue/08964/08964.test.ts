import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("issue 8964", async () => {
  const { exitCode, signalCode, stdout } = spawnSync({
    cmd: [bunExe(), "test", join(import.meta.dirname, "08964.fixture.ts")],
    env: { ...bunEnv, CI: "false" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const stdtext = stdout.toString();
  // Skip the banner and any `stdout | file > test` attribution headers.
  const [actual, expected] = stdtext
    .split("\n")
    .filter(l => l.startsWith("ACTUAL:") || l.startsWith("EXPECTED:"));
  expect(actual.replace("EXPECTED:", "ACTUAL:")).toBe(expected);
  expect(exitCode).toBe(0);
  expect(signalCode).toBeUndefined();
});
