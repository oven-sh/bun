// https://github.com/oven-sh/bun/issues/24385
// Test for Redis client import regression

import { cartesianProduct } from "_util/collection";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent.each(
  cartesianProduct(
    ["REDIS_URL", "VALKEY_URL"],
    [
      "localhost:6379",
      "redis+tls+unix:///tmp/redis.sock",
      "redis+tls://localhost:6379",
      "redis+unix:///tmp/redis.sock",
      "redis://localhost:6379",
      "rediss://localhost:6379",
      "valkey://localhost:6379",
    ],
  ).map(([k, v]) => ({ key: k, value: v })),
)("Redis loads with $key=$value", async ({ key, value }) => {
  const env = { ...bunEnv, [key]: value };

  await using proc = Bun.spawn({
    // We need to call redis.duplicate() since Bun lazily imports redis.
    cmd: [bunExe(), "-e", 'import { redis } from "bun"; const d = redis.duplicate(); console.log("success");'],
    env,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Expected url protocol to be one of");
  expect(stdout).toContain("success");
  expect(exitCode).toBe(0);
});
