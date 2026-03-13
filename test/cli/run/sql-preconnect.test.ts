import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("--sql-preconnect", () => {
  test("should attempt to preconnect to PostgreSQL on startup", async () => {
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

    const testDir = tempDirWithFiles("sql-preconnect-test", {
      "index.js": `console.log("Script executed");`,
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "--sql-preconnect", "index.js"],
      env: {
        ...bunEnv,
        DATABASE_URL: `postgres://127.0.0.1:${server.port}/MY_DATABASE`,
      },
      cwd: testDir,
    });

    await promise;
    proc.kill();
    await proc.exited;

    expect(connectionAttempts).toBeGreaterThan(0);
  });

  test("should not connect when flag is not used", async () => {
    let connectionAttempts = 0;

    await using server = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        open(socket) {
          connectionAttempts++;
          socket.end();
        },
        data() {},
        close() {},
      },
    });

    const testDir = tempDirWithFiles("sql-no-preconnect", {
      "index.js": `console.log("Normal script executed");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: {
        ...bunEnv,
        DATABASE_URL: `postgres://127.0.0.1:${server.port}/MY_DATABASE`,
      },
      cwd: testDir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Normal script executed");
    expect(connectionAttempts).toBe(0); // No connection should be attempted without the flag
  });
});
