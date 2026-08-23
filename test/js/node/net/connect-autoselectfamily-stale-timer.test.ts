// https://github.com/oven-sh/bun/issues/25633
// Each fixture exits 1 (reason on stderr) if the autoSelectFamily per-attempt
// timer outlives its attempt, and prints "OK" only after outliving the window
// in which that stale timer would fire.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";
import { join } from "node:path";

async function run(fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(import.meta.dir, fixture)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The fixture needs connect() to fail synchronously inside the dispatch (a
// TCP connect to a multicast group); macOS is where that dispatch is verified
// and where the crash reproduces, so keep the assertion surface there.
test.concurrent.skipIf(!isMacOS)(
  "autoSelectFamily: synchronously-failing addresses do not arm a stale per-attempt timer",
  async () => {
    const { stdout, stderr, exitCode } = await run("connect-autoselectfamily-sync-fail-fixture.js");
    expect({ exitCode, stdout, stderr }).toMatchObject({
      exitCode: 0,
      // The 'error' line proves the attempts surfaced the expected AggregateError.
      stdout: expect.stringContaining("error "),
    });
    expect(stdout).toContain("OK");
  },
);

test.concurrent(
  "autoSelectFamily: destroy() while an attempt is pending does not leave the per-attempt timer to fire",
  async () => {
    const { stdout, stderr, exitCode } = await run("connect-autoselectfamily-destroy-fixture.js");
    expect({ exitCode, stdout, stderr }).toMatchObject({
      exitCode: 0,
      // "connecting at destroy: true" = scenario exercised; "SKIP_SYNC_FAIL"
      // = this host has no route to TEST-NET-1 (documented for darwin CI).
      stdout: expect.stringMatching(/connecting at destroy: true|SKIP_SYNC_FAIL/),
    });
    expect(stdout).toContain("OK");
  },
);
