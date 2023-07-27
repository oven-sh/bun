import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { bunEnv, bunExe } from "harness";

describe("fetch doesn't leak", () => {
  test("fixture #1", async () => {
    const body = new Blob(["some body in here!".repeat(100)]);
    var count = 0;
    const server = Bun.serve({
      port: 0,

      fetch(req) {
        count++;
        return new Response(body);
      },
    });

    const proc = Bun.spawn({
      env: {
        ...bunEnv,
        SERVER: `http://${server.hostname}:${server.port}`,
        COUNT: "200",
      },
      stderr: "inherit",
      stdout: "inherit",
      cmd: [bunExe(), "--smol", join(import.meta.dir, "fetch-leak-test-fixture.js")],
    });

    const exitCode = await proc.exited;
    server.stop(true);
    expect(exitCode).toBe(0);
    expect(count).toBe(200);
  });

  test("fixture #2", async () => {
    const body = new Blob(["some body in here!".repeat(100)]);
    const server = Bun.serve({
      port: 0,

      fetch(req) {
        return new Response(body);
      },
    });

    const proc = Bun.spawn({
      env: {
        ...bunEnv,
        SERVER: `http://${server.hostname}:${server.port}`,
      },
      stderr: "inherit",
      stdout: "inherit",
      cmd: [bunExe(), "--smol", join(import.meta.dir, "fetch-leak-test-fixture-2.js")],
    });

    const exitCode = await proc.exited;
    server.stop(true);
    expect(exitCode).toBe(0);
  });
});
