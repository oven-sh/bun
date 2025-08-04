import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Tests for the --inspect-browser flag functionality
// Only run on Linux where xdg-open is available (though xdg-open integration may vary)
const isLinux = process.platform === "linux";

test.skipIf(!isLinux)("--inspect-browser should start inspector and show URL", async () => {
  const dir = tempDirWithFiles("inspect-browser-test", {
    "test.js": `console.log("Hello from debugger test");`,
  });

  // Start bun with --inspect-browser
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser", "test.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the debugger to start (needs a few seconds)
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that the debugger output shows the inspector is running
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain("Listening:");
  expect(stderr).toContain("Inspect in browser:");
  expect(stderr).toContain("https://debug.bun.sh");
});

test.skipIf(!isLinux)("--inspect-browser with custom port should work", async () => {
  const dir = tempDirWithFiles("inspect-browser-port-test", {
    "test.js": `console.log("Hello from debugger test");`,
  });

  // Start bun with --inspect-browser with a custom port
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser=localhost:9229", "test.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the debugger to start
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that the debugger output shows the custom port
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain("localhost:9229");
  expect(stderr).toContain("https://debug.bun.sh/#localhost:9229");
});

test.skipIf(!isLinux)("--inspect-browser with IP address should work", async () => {
  const dir = tempDirWithFiles("inspect-browser-ip-test", {
    "test.js": `console.log("Hello from debugger test");`,
  });

  // Start bun with --inspect-browser with an IP address
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser=127.0.0.1:9229", "test.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the debugger to start
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that the debugger output shows the IP address
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain("127.0.0.1:9229");
  expect(stderr).toContain("https://debug.bun.sh/#127.0.0.1:9229");
});

test.skipIf(!isLinux)("--inspect-browser should work with TypeScript files", async () => {
  const dir = tempDirWithFiles("inspect-browser-ts-test", {
    "test.ts": `
const message: string = "Hello from TypeScript debugger test";
console.log(message);
`,
  });

  // Start bun with --inspect-browser on a TypeScript file
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser", "test.ts"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the debugger to start
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that the debugger output shows the inspector is running
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain("Inspect in browser:");
  expect(stderr).toContain("https://debug.bun.sh");
});

test.skipIf(!isLinux)("--inspect-browser should work with script that has spaces in path", async () => {
  const dir = tempDirWithFiles("inspect browser space test", {
    "test script.js": `console.log("Hello from debugger test");`,
  });

  // Start bun with --inspect-browser on a script with spaces in the path
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser", "test script.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the debugger to start
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that the debugger output shows the inspector is running
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain("Inspect in browser:");
  expect(stderr).toContain("https://debug.bun.sh");
});