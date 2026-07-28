import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

    await using testDir = tempDir("sql-preconnect-test", {
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

  test("does not fail the script when the server is unreachable", async () => {
    // Grab a port that has nothing listening on it.
    const server = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: { data() {}, open() {}, close() {} },
    });
    const port = server.port;
    server.stop(true);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--sql-preconnect", "-e", `console.log("script done")`],
      env: {
        ...bunEnv,
        DATABASE_URL: `postgres://127.0.0.1:${port}/nope`,
      },
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("script done\n");
    expect(stderr).not.toContain("PostgresError");
    expect(stderr).not.toContain("ERR_POSTGRES");
    expect(exitCode).toBe(0);
  });

  test("does not hang when the server accepts then closes", async () => {
    await using server = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        open(socket) {
          socket.end();
        },
        data() {},
        close() {},
      },
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--sql-preconnect", "-e", `console.log("script done")`],
      env: {
        ...bunEnv,
        DATABASE_URL: `postgres://127.0.0.1:${server.port}/nope`,
      },
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("script done\n");
    expect(stderr).not.toContain("PostgresError");
    expect(stderr).not.toContain("ERR_POSTGRES");
    expect(exitCode).toBe(0);
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

    await using testDir = tempDir("sql-no-preconnect", {
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
