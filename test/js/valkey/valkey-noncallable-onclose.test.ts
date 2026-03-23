import { beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { DEFAULT_REDIS_URL, isEnabled, setupDockerContainer } from "./test-utils";

beforeAll(async () => {
  if (isEnabled) await setupDockerContainer();
});

test.skipIf(!isEnabled)("non-callable onclose does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.on("uncaughtException", (e) => {
        console.log(e.constructor.name + ": " + e.message);
        process.exit(0);
      });
      const client = new Bun.RedisClient(process.env.BUN_VALKEY_URL);
      client.onclose = 42;
      await client.ping();
      client.close();
      await Bun.sleep(500);
      `,
    ],
    env: { ...bunEnv, BUN_VALKEY_URL: DEFAULT_REDIS_URL },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("TypeError");
  expect(exitCode).toBe(0);
});
