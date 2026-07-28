import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("--redis-preconnect", () => {
  test("should attempt to preconnect to Redis on startup", async () => {
    let connectionAttempts = 0;
    const { promise, resolve } = Promise.withResolvers<void>();

    await using server = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        open(socket) {
          connectionAttempts++;
          socket.end();
          if (connectionAttempts >= 1) {
            resolve();
          }
        },
        data() {},
        close() {},
      },
    });

    await using testDir = tempDir("redis-preconnect-test", {
      "index.js": `console.log("Script executed");`,
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "--redis-preconnect", "index.js"],
      env: {
        ...bunEnv,
        REDIS_URL: `redis://127.0.0.1:${server.port}`,
      },
      cwd: testDir,
    });

    await promise;
    proc.kill();
    await proc.exited;

    expect(connectionAttempts).toBeGreaterThan(0);
  });

  test("does not fail or hang when the server is unreachable", async () => {
    // Grab a port that has nothing listening on it.
    const server = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: { data() {}, open() {}, close() {} },
    });
    const port = server.port;
    server.stop(true);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--redis-preconnect", "-e", `console.log("script done")`],
      env: {
        ...bunEnv,
        REDIS_URL: `redis://127.0.0.1:${port}`,
      },
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("script done\n");
    expect(stderr).not.toContain("RedisError");
    expect(stderr).not.toContain("ERR_REDIS");
    expect(exitCode).toBe(0);
  });

  test("a later explicit .connect() still keeps the loop alive", async () => {
    // Preconnect starts a background attempt that does not ref the loop. When
    // the script then calls .connect() itself, the returned promise must still
    // settle (resolve here) before the process exits.
    const { promise, resolve } = Promise.withResolvers<void>();
    await using server = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        open(socket) {
          resolve();
          // RESP3 HELLO → reply with a minimal map so the handshake succeeds.
          socket.write("%1\r\n$6\r\nserver\r\n$5\r\nredis\r\n");
        },
        data() {},
        close() {},
      },
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--redis-preconnect", "-e", `await Bun.redis.connect(); console.log("connected");`],
      env: {
        ...bunEnv,
        REDIS_URL: `redis://127.0.0.1:${server.port}`,
      },
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    await promise;

    expect(stderr).toBe("");
    expect(stdout).toBe("connected\n");
    expect(exitCode).toBe(0);
  });
});
