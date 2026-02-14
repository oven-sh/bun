import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { spawn } from "bun";

test("process.title sets the process name", async () => {
  const title = "my-custom-title-" + Math.floor(Math.random() * 10000);
  const expectedTitle = "modified-" + title;

  const fixturePath = import.meta.dir + "/process-title-fixture.js";

  const proc = spawn({
    cmd: [bunExe(), "run", fixturePath, title],
    env: bunEnv,
    stdout: "pipe",
  });

  // Wait for "READY"
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
    if (output.includes("READY")) break;
  }

  // Now check ps
  // On macOS, ps -p <pid> -o command should show the args, but if we rewrote them, it shows the rewrite.
  const ps = spawn({
    cmd: ["ps", "-p", proc.pid.toString(), "-o", "command="],
    stdout: "pipe",
  });

  const psOutput = await new Response(ps.stdout).text();
  console.log("PS Output:", psOutput.trim());
  expect(psOutput).toContain(expectedTitle);
});
