import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("non-callable onclose does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const redis = new Bun.RedisClient("redis://localhost:6379", { autoReconnect: false });
      redis.onclose = 42;
      try { await redis.connect(); } catch(e) {}
      try { redis.close(); } catch(e) {}
      `,
    ],
    env: bunEnv,
  });

  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
});

test.concurrent("non-callable onconnect does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const redis = new Bun.RedisClient("redis://localhost:6379", { autoReconnect: false });
      redis.onconnect = "not a function";
      try { await redis.connect(); } catch(e) {}
      try { redis.close(); } catch(e) {}
      `,
    ],
    env: bunEnv,
  });

  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
});
