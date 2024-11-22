import { describe, it, expect } from "bun:test";
import { bunExe } from "../../../harness";

it("does not hang running commander", async () => {
  const child = Bun.spawn({
    cmd: [bunExe(), "commander-index.ts", "test"],
    cwd: __dirname,
    stdout: "pipe",
    stderr: "inherit",
  });

  await Promise.race([child.exited, Bun.sleep(1000)]);
  expect(child.exitCode).toBe(0);
  expect(await new Response(child.stdout).text()).toBe("Test command\n");
});

// TODO: test performance in express and memory usage with abort signals
