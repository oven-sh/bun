// Bun.ModuleGraph under random compositions: chains of hops through timers, promises, emitters and run(), through
// the code of several graphs and of the host, each ending in an error nobody handles. See scrambler/scrambler-fixture.mjs
// for what is checked.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "path";

describe.concurrent("Bun.ModuleGraph scrambler", () => {
  const chains = isDebug || isASAN ? 60 : 600;
  // How long the fixture waits for every chain to end before it says which did not: less than a test's timeout.
  const deadline = 4_000;
  test.each([1, 2, 3, 4])(
    "every hop runs in the context it was scheduled in, and every error is heard by its graph: seed %d",
    async seed => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "scrambler", "scrambler-fixture.mjs")],
        env: { ...bunEnv, SEED: String(seed), CHAINS: String(chains), DEADLINE: String(deadline) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        seed,
        chains,
        hops: expect.any(Number),
        heard: chains,
        heardBy: expect.any(Object),
        problems: [],
      });
      expect(exitCode).toBe(0);
    },
  );
});
