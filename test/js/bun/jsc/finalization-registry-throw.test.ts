import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("FinalizationRegistry callback that throws is reported as uncaughtException", async () => {
  const src = `
    let caught = 0;
    process.on("uncaughtException", () => caught++);
    const fr = new FinalizationRegistry(() => { throw new Error("boom"); });
    (function () {
      for (let i = 0; i < 10; i++) fr.register({}, i);
    })();
    for (let i = 0; i < 20; i++) {
      Bun.gc(true);
      await new Promise(r => setImmediate(r));
      if (caught > 0) break;
    }
    console.log("caught=" + caught);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr }).toEqual({ stdout: expect.stringMatching(/^caught=\d+\n$/), stderr: "" });
  const caught = parseInt(stdout.match(/caught=(\d+)/)![1]);
  expect(caught).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
});
