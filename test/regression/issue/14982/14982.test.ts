import { expect, it, describe } from "bun:test";
import { bunEnv, bunExe } from "../../../harness";
import { join } from "path";

describe("issue 14982", () => {
  it("does not hang in commander", async () => {
    const process = Bun.spawn([bunExe(), join(__dirname, "commander-hang.fixture.ts"), "test"], {
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
      cwd: __dirname,
      env: bunEnv,
    });
    await process.exited;
    expect(process.exitCode).toBe(0);
    expect(await new Response(process.stdout).text()).toBe("Test command\n");
  }, 15000);
});
