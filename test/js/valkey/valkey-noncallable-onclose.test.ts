import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("non-callable onclose does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.on("uncaughtException", (e) => {
        console.log(e.constructor.name + ": " + e.message);
        process.exit(0);
      });
      const client = new Bun.RedisClient("redis://127.0.0.1:6379");
      client.onclose = 42;
      await client.ping();
      client.close();
      await Bun.sleep(500);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("TypeError");
  expect(exitCode).toBe(0);
});
