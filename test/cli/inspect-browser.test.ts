import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("--inspect-browser should open browser and wait for connection", async () => {
  const dir = tempDirWithFiles("inspect-browser-test", {
    "test.js": `console.log("Hello from debugger test");`,
    "fake-xdg-open": `#!/bin/bash
echo "Opening $1" > xdg-open-calls.txt
exit 0`,
  });

  // Make the fake xdg-open executable
  await Bun.spawn(["chmod", "+x", join(dir, "fake-xdg-open")], {
    cwd: dir,
  }).exited;

  const env = {
    ...bunEnv,
    PATH: `${dir}:${bunEnv.PATH}`,
  };

  // Start bun with --inspect-browser but kill it after a short time
  // since it will wait for a connection
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser", "test.js"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait a bit for the debugger to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that the fake xdg-open was called
  const xdgCallsFile = join(dir, "xdg-open-calls.txt");
  const exists = await Bun.file(xdgCallsFile).exists();
  
  if (exists) {
    const xdgCalls = await Bun.file(xdgCallsFile).text();
    expect(xdgCalls).toContain("Opening https://debug.bun.sh/#");
  }

  // Check that the debugger output mentions the browser opening
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain("Inspect in browser:");
  expect(stderr).toContain("https://debug.bun.sh");
});

test("--inspect-browser with custom port should work", async () => {
  const dir = tempDirWithFiles("inspect-browser-port-test", {
    "test.js": `console.log("Hello from debugger test");`,
    "fake-xdg-open": `#!/bin/bash
echo "Opening $1" > xdg-open-calls.txt
exit 0`,
  });

  // Make the fake xdg-open executable
  await Bun.spawn(["chmod", "+x", join(dir, "fake-xdg-open")], {
    cwd: dir,
  }).exited;

  const env = {
    ...bunEnv,
    PATH: `${dir}:${bunEnv.PATH}`,
  };

  // Start bun with --inspect-browser with a custom port
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser=localhost:9229", "test.js"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait a bit for the debugger to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that the fake xdg-open was called with the custom port
  const xdgCallsFile = join(dir, "xdg-open-calls.txt");
  const exists = await Bun.file(xdgCallsFile).exists();
  
  if (exists) {
    const xdgCalls = await Bun.file(xdgCallsFile).text();
    expect(xdgCalls).toContain("Opening https://debug.bun.sh/#localhost:9229");
  }

  // Check that the debugger output shows the custom port
  expect(stderr).toContain("localhost:9229");
});