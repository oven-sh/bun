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
      const { promise, resolve } = Promise.withResolvers();
      process.exitCode = 1;
      process.once("uncaughtException", (e) => {
        console.log(e.constructor.name + ": " + e.message);
        if (e instanceof TypeError && e.message.includes("must be callable")) {
          process.exitCode = 0;
        }
        resolve();
        process.exit(process.exitCode);
      });
      const client = new Bun.RedisClient(process.env.BUN_VALKEY_URL);
      client.onclose = 42;
      await client.ping();
      client.close();
      await Promise.race([promise, Bun.sleep(5_000)]);
      `,
    ],
    env: { ...bunEnv, BUN_VALKEY_URL: DEFAULT_REDIS_URL },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("TypeError: Function passed to .call must be callable.");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
