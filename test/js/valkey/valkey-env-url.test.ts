import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The default client resolves its URL as: explicit argument > REDIS_URL > VALKEY_URL > valkey://localhost:6379.
// An empty environment variable counts as unset, the same as PORT for Bun.serve and DATABASE_URL for Bun.SQL.
describe.concurrent("RedisClient: empty URL environment variables", () => {
  test("REDIS_URL='' falls back to the default URL", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import { redis, RedisClient } from "bun";
          new RedisClient();
          console.log(typeof Bun.redis.connect, typeof redis.connect);
        `,
      ],
      env: { ...bunEnv, REDIS_URL: "", VALKEY_URL: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("function function\n");
    expect(exitCode).toBe(0);
  });

  test("REDIS_URL='' falls back to VALKEY_URL", async () => {
    const { promise: connected, resolve } = Promise.withResolvers<void>();
    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          resolve();
          socket.end();
        },
        data() {},
      },
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const client = new Bun.RedisClient(undefined, { autoReconnect: false });
          await client.connect().catch(() => {});
          console.log("done");
        `,
      ],
      env: { ...bunEnv, REDIS_URL: "", VALKEY_URL: `redis://127.0.0.1:${server.port}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("done\n");
    expect(exitCode).toBe(0);
    await connected;
  });
});
