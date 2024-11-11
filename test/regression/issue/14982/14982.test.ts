import { expect, test, it, describe } from "bun:test";
import { bunEnv, bunExe } from "../../../harness";
import { join } from "path";

describe("issue 14982", () => {
  it("does not hang in commander", async () => {
    const process = Bun.spawn([bunExe(), join(__dirname, "commander-hang.fixture.ts"), "test"], {
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
      env: bunEnv,
    });
    await process.exited;
    expect(process.exitCode).toBe(0);
    expect(await new Response(process.stdout).text()).toBe("Test command\n");
  }, 1000);

  it("does not crash when sent SIGUSR1 by a child", async () => {
    const process = Bun.spawn([bunExe(), join(__dirname, "raise.js")], {
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
      env: bunEnv,
    });
    await process.exited;
    expect(process.exitCode).toBe(0);
    expect(await new Response(process.stdout).text()).toBe("exited with 0\n");
  });

  it("does not slow down express", async () => {
    // requests per second with bun 1.1.34 on @190n's work laptop
    const baseline = 95939;

    const server = Bun.spawn([bunExe(), join(__dirname, "express-server.js")], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    // let it start listening
    await Bun.sleep(100);

    const oha = Bun.spawn(["oha", "http://localhost:3000", "-j", "-n", "1000000", "-c", "40"], {
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
    });

    const results = await new Response(oha.stdout).json();
    const rps = results.summary.requestsPerSec;
    const slowdownPercent = ((baseline - rps) / baseline) * 100;
    expect(slowdownPercent).toBeLessThan(5);

    server.kill();
  }, 15000);

  it("does not slow down fastify", async () => {
    // requests per second with bun 1.1.34 on @190n's work laptop
    const baseline = 161178;

    const server = Bun.spawn([bunExe(), join(__dirname, "fastify-server.mjs")], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    // let it start listening
    await Bun.sleep(100);

    const oha = Bun.spawn(["oha", "http://localhost:3000", "-j", "-n", "1000000", "-c", "40"], {
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
    });

    const results = await new Response(oha.stdout).json();
    const rps = results.summary.requestsPerSec;
    const slowdownPercent = ((baseline - rps) / baseline) * 100;
    expect(slowdownPercent).toBeLessThan(5);

    server.kill();
  }, 15000);

  // decreases AbortSignal spam memory usage
});
