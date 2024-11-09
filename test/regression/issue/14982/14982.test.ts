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

  // does not slow down express
  // does not slow down fastify
  // decreases AbortSignal spam memory usage
});
