import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { spawn } from "bun";

test("process.title sets the process name", async () => {
  const title = "my-custom-title-" + Math.floor(Math.random() * 10000);
  const expectedTitle = "modified-" + title;

  const fixturePath = import.meta.dir + "/process-title-fixture.js";

  await using proc = spawn({
    cmd: [bunExe(), "run", fixturePath, title],
    env: bunEnv,
    stdout: "pipe",
  });

  // Wait for "READY"
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let isReady = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
    if (output.includes("READY")) {
      isReady = true;
      break;
    }
  }

  expect(isReady).toBe(true);

  // Now check ps
  // On macOS, ps -p <pid> -o command should show the args, but if we rewrote them, it shows the rewrite.
  await using ps = spawn({
    cmd: ["ps", "-p", proc.pid.toString(), "-o", "command="],
    stdout: "pipe",
  });

  const [psOutput, psExitCode] = await Promise.all([
    new Response(ps.stdout).text(),
    ps.exited,
  ]);

  console.log("PS Output:", psOutput.trim());
  expect(psOutput).toContain(expectedTitle);
  expect(psExitCode).toBe(0);
});
