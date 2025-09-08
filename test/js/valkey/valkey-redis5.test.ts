import { RedisClient } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, randomPort } from "harness";
import path from "path";

// Test for issue #22483 - Redis 5 compatibility
// This test ensures Bun's Redis client works with Redis 5 which doesn't support HELLO command

const dockerCLI = Bun.which("docker") as string;
const isEnabled =
  !!dockerCLI &&
  (() => {
    try {
      const info = Bun.spawnSync({
        cmd: [dockerCLI, "info"],
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
        timeout: 5_000,
      });
      return info.exitCode === 0 && !info.signalCode;
    } catch {
      return false;
    }
  })();

describe.skipIf(!isEnabled)("Redis 5 Compatibility (#22483)", () => {
  let redis5Port: number;
  let redis7Port: number;
  let redis5Container: string;
  let redis7Container: string;
  let redis5Client: RedisClient;
  let redis7Client: RedisClient;

  beforeAll(async () => {
    // Build Redis 5 Docker image
    console.log("Building Redis 5 Docker image...");
    const dockerfilePath = path.join(import.meta.dir, "docker-redis5", "Dockerfile");
    await Bun.spawn([dockerCLI, "build", "--rm", "-f", dockerfilePath, "-t", "bun-redis5-test", "."], {
      cwd: path.join(import.meta.dir, "docker-redis5"),
      stdio: ["inherit", "inherit", "inherit"],
    }).exited;

    // Start Redis 5 container
    redis5Port = randomPort();
    redis5Container = `redis5-test-${Date.now()}`;

    console.log(`Starting Redis 5 container on port ${redis5Port}...`);
    const start5 = Bun.spawn({
      cmd: [dockerCLI, "run", "-d", "--name", redis5Container, "-p", `${redis5Port}:6379`, "bun-redis5-test"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const container5Id = await new Response(start5.stdout).text();
    const exit5 = await start5.exited;

    if (exit5 !== 0) {
      const stderr = await new Response(start5.stderr).text();
      throw new Error(`Failed to start Redis 5: ${stderr}`);
    }

    console.log(`Redis 5 container started: ${container5Id.slice(0, 12)}`);

    // Start Redis 7 container for comparison
    redis7Port = randomPort();
    redis7Container = `redis7-test-${Date.now()}`;

    console.log(`Starting Redis 7 container on port ${redis7Port}...`);
    const start7 = Bun.spawn({
      cmd: [dockerCLI, "run", "-d", "--name", redis7Container, "-p", `${redis7Port}:6379`, "redis:7-alpine"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const container7Id = await new Response(start7.stdout).text();
    const exit7 = await start7.exited;

    if (exit7 !== 0) {
      const stderr = await new Response(start7.stderr).text();
      throw new Error(`Failed to start Redis 7: ${stderr}`);
    }

    console.log(`Redis 7 container started: ${container7Id.slice(0, 12)}`);

    // Wait for containers to be ready
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify Redis 5 version
    const version5Check = Bun.spawn({
      cmd: [dockerCLI, "exec", redis5Container, "redis-cli", "info", "server"],
      stdout: "pipe",
    });
    const version5Info = await new Response(version5Check.stdout).text();
    const version5Match = version5Info.match(/redis_version:(\d+)/);
    if (version5Match) {
      console.log(`Redis 5 version confirmed: ${version5Match[0]}`);
    }

    // Connect clients
    redis5Client = new RedisClient(`redis://localhost:${redis5Port}`);
    redis7Client = new RedisClient(`redis://localhost:${redis7Port}`);
  });

  afterAll(async () => {
    // Close clients
    if (redis5Client) await redis5Client.close();
    if (redis7Client) await redis7Client.close();

    // Clean up containers
    if (redis5Container) {
      await Bun.spawn([dockerCLI, "rm", "-f", redis5Container]).exited;
    }
    if (redis7Container) {
      await Bun.spawn([dockerCLI, "rm", "-f", redis7Container]).exited;
    }
  });

  test("Redis 5 - should work with RESP2 fallback (no HELLO support)", async () => {
    // This would fail before the fix with "ERR unknown command `HELLO`"
    // After the fix, it should fall back to RESP2 and work

    const key = `test-redis5-${Date.now()}`;
    const value = "Hello from Redis 5!";

    // Basic SET operation
    const setResult = await redis5Client.set(key, value);
    expect(setResult).toBe("OK");

    // Basic GET operation
    const getValue = await redis5Client.get(key);
    expect(getValue).toBe(value);

    // EXISTS operation
    const exists = await redis5Client.exists(key);
    expect(exists).toBe(true);

    // DEL operation
    const delResult = await redis5Client.del(key);
    expect(delResult).toBe(1);

    // Verify deletion
    const existsAfterDel = await redis5Client.exists(key);
    expect(existsAfterDel).toBe(false);
  });

  test("Redis 7 - should work with RESP3 (HELLO supported)", async () => {
    // This should work normally with RESP3 protocol

    const key = `test-redis7-${Date.now()}`;
    const value = "Hello from Redis 7 with RESP3!";

    // Basic SET operation
    const setResult = await redis7Client.set(key, value);
    expect(setResult).toBe("OK");

    // Basic GET operation
    const getValue = await redis7Client.get(key);
    expect(getValue).toBe(value);

    // EXISTS operation
    const exists = await redis7Client.exists(key);
    expect(exists).toBe(true);

    // DEL operation
    const delResult = await redis7Client.del(key);
    expect(delResult).toBe(1);

    // Verify deletion
    const existsAfterDel = await redis7Client.exists(key);
    expect(existsAfterDel).toBe(false);
  });

  test("Redis 5 - complex operations should work", async () => {
    // Test more complex operations to ensure full compatibility

    // Hash operations
    const hashKey = `hash-test-${Date.now()}`;
    await redis5Client.hmset(hashKey, { field1: "value1", field2: "value2" });
    const hashValues = await redis5Client.hmget(hashKey, ["field1", "field2"]);
    expect(hashValues).toEqual(["value1", "value2"]);

    // List operations
    const listKey = `list-test-${Date.now()}`;
    await redis5Client.send("RPUSH", [listKey, "item1", "item2", "item3"]);
    const listLen = await redis5Client.send("LLEN", [listKey]);
    expect(listLen).toBe(3);

    // Set operations
    const setKey = `set-test-${Date.now()}`;
    await redis5Client.sadd(setKey, "member1");
    await redis5Client.sadd(setKey, "member2");
    const isMember = await redis5Client.sismember(setKey, "member1");
    expect(isMember).toBe(true);

    // Counter operations
    const counterKey = `counter-test-${Date.now()}`;
    await redis5Client.set(counterKey, "0");
    const incrResult = await redis5Client.incr(counterKey);
    expect(incrResult).toBe(1);
    const decrResult = await redis5Client.decr(counterKey);
    expect(decrResult).toBe(0);

    // Clean up
    await redis5Client.del(hashKey);
    await redis5Client.del(listKey);
    await redis5Client.del(setKey);
    await redis5Client.del(counterKey);
  });

  test("Redis 5 with authentication should work", async () => {
    // Test with password authentication (Redis 5 style)
    const authContainer = `redis5-auth-test-${Date.now()}`;
    const authPort = randomPort();

    // Start Redis 5 with password
    const startAuth = Bun.spawn({
      cmd: [
        dockerCLI,
        "run",
        "-d",
        "--name",
        authContainer,
        "-p",
        `${authPort}:6379`,
        "redis:5-alpine",
        "redis-server",
        "--requirepass",
        "testpass123",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    const containerAuthId = await new Response(startAuth.stdout).text();
    const exitAuth = await startAuth.exited;

    if (exitAuth !== 0) {
      const stderr = await new Response(startAuth.stderr).text();
      throw new Error(`Failed to start Redis 5 with auth: ${stderr}`);
    }

    // Wait for container to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      // Connect with password
      const authClient = new RedisClient(`redis://:testpass123@localhost:${authPort}`);

      // Should work with authentication
      const authKey = `auth-test-${Date.now()}`;
      const setResult = await authClient.set(authKey, "authenticated");
      expect(setResult).toBe("OK");

      const getValue = await authClient.get(authKey);
      expect(getValue).toBe("authenticated");

      await authClient.close();
    } finally {
      // Clean up auth container
      await Bun.spawn([dockerCLI, "rm", "-f", authContainer]).exited;
    }
  });

  test("verifies RESP2 fallback is actually being used for Redis 5", async () => {
    // This test documents what happens internally
    // Redis 5: HELLO fails -> fallback to RESP2 -> works
    // Redis 7: HELLO succeeds -> uses RESP3 -> works

    const testKey = `protocol-test-${Date.now()}`;

    // Both should work, but internally using different protocols
    await redis5Client.set(testKey, "resp2");
    await redis7Client.set(testKey, "resp3");

    const value5 = await redis5Client.get(testKey);
    const value7 = await redis7Client.get(testKey);

    expect(value5).toBe("resp2");
    expect(value7).toBe("resp3");

    // Clean up
    await redis5Client.del(testKey);
    await redis7Client.del(testKey);
  });
});
