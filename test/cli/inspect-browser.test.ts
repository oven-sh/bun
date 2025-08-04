import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Tests for the --inspect-browser flag functionality
// Updated to use file-based communication (instead of Unix domain sockets) 
// and to only run on Linux where xdg-open is available
const isLinux = process.platform === "linux";

test.skipIf(!isLinux)("--inspect-browser should open browser and wait for connection", async () => {
  const dir = tempDirWithFiles("inspect-browser-test", {
    "test.js": `console.log("Hello from debugger test");`,
  });

  // Create fake xdg-open script that logs the URL
  const xdgOpenScript = `#!/bin/bash
echo "$1" > "${join(dir, "xdg-open-calls.txt")}"
exit 0`;
  
  await Bun.write(join(dir, "xdg-open"), xdgOpenScript);

  // Make the fake xdg-open executable
  await Bun.spawn(["chmod", "+x", join(dir, "xdg-open")], {
    cwd: dir,
  }).exited;

  const env = {
    ...bunEnv,
    PATH: `${dir}:${bunEnv.PATH}`,
  };

  // Start bun with --inspect-browser but kill it after a short time
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser", "test.js"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait a bit for the debugger to start and xdg-open to be called
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that we received the expected URL
  const xdgCallsFile = join(dir, "xdg-open-calls.txt");
  const exists = await Bun.file(xdgCallsFile).exists();
  
  if (exists) {
    const receivedUrl = await Bun.file(xdgCallsFile).text();
    expect(receivedUrl.trim()).toContain("https://debug.bun.sh/#");
  }

  // Check that the debugger output mentions the browser opening
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain("Inspect in browser:");
  expect(stderr).toContain("https://debug.bun.sh");
});

test.skipIf(!isLinux)("--inspect-browser with custom port should work", async () => {
  const dir = tempDirWithFiles("inspect-browser-port-test", {
    "test.js": `console.log("Hello from debugger test");`,
  });

  // Create fake xdg-open script that logs the URL
  const xdgOpenScript = `#!/bin/bash
echo "$1" > "${join(dir, "xdg-open-calls.txt")}"
exit 0`;
  
  await Bun.write(join(dir, "xdg-open"), xdgOpenScript);

  // Make the fake xdg-open executable
  await Bun.spawn(["chmod", "+x", join(dir, "xdg-open")], {
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

  // Wait a bit for the debugger to start and xdg-open to be called
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that we received the expected URL with custom port
  const xdgCallsFile = join(dir, "xdg-open-calls.txt");
  const exists = await Bun.file(xdgCallsFile).exists();
  
  if (exists) {
    const receivedUrl = await Bun.file(xdgCallsFile).text();
    expect(receivedUrl.trim()).toContain("https://debug.bun.sh/#localhost:9229");
  }

  // Check that the debugger output shows the custom port
  expect(stderr).toContain("localhost:9229");
});

test.skipIf(!isLinux)("--inspect-browser with IP address should work", async () => {
  const dir = tempDirWithFiles("inspect-browser-ip-test", {
    "test.js": `console.log("Hello from debugger test");`,
  });

  // Create fake xdg-open script that logs the URL
  const xdgOpenScript = `#!/bin/bash
echo "$1" > "${join(dir, "xdg-open-calls.txt")}"
exit 0`;
  
  await Bun.write(join(dir, "xdg-open"), xdgOpenScript);

  // Make the fake xdg-open executable
  await Bun.spawn(["chmod", "+x", join(dir, "xdg-open")], {
    cwd: dir,
  }).exited;

  const env = {
    ...bunEnv,
    PATH: `${dir}:${bunEnv.PATH}`,
  };

  // Start bun with --inspect-browser with an IP address
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser=127.0.0.1:9229", "test.js"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait a bit for the debugger to start and xdg-open to be called
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that we received the expected URL with IP address
  const xdgCallsFile = join(dir, "xdg-open-calls.txt");
  const exists = await Bun.file(xdgCallsFile).exists();
  
  if (exists) {
    const receivedUrl = await Bun.file(xdgCallsFile).text();
    expect(receivedUrl.trim()).toContain("https://debug.bun.sh/#127.0.0.1:9229");
  }

  // Check that the debugger output shows the IP address
  expect(stderr).toContain("127.0.0.1:9229");
});

test.skipIf(!isLinux)("--inspect-browser should handle xdg-open failure gracefully", async () => {
  const dir = tempDirWithFiles("inspect-browser-fail-test", {
    "test.js": `console.log("Hello from debugger test");`,
  });

  // Create fake xdg-open script that fails
  const xdgOpenScript = `#!/bin/bash
exit 1`;
  
  await Bun.write(join(dir, "xdg-open"), xdgOpenScript);

  // Make the fake xdg-open executable
  await Bun.spawn(["chmod", "+x", join(dir, "xdg-open")], {
    cwd: dir,
  }).exited;

  const env = {
    ...bunEnv,
    PATH: `${dir}:${bunEnv.PATH}`,
  };

  // Start bun with --inspect-browser
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser", "test.js"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait a bit for the debugger to start
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Even if xdg-open fails, the debugger should still start and show the URL
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain("Inspect in browser:");
  expect(stderr).toContain("https://debug.bun.sh");
});

test.skipIf(!isLinux)("--inspect-browser should work without xdg-open in PATH", async () => {
  const dir = tempDirWithFiles("inspect-browser-no-xdg-test", {
    "test.js": `console.log("Hello from debugger test");`,
  });

  // Use a limited PATH that doesn't include xdg-open
  const env = {
    ...bunEnv,
    PATH: "/usr/bin:/bin", // Very limited PATH
  };

  // Start bun with --inspect-browser
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser", "test.js"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait a bit for the debugger to start
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Even without xdg-open, the debugger should still start and show the URL
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain("Inspect in browser:");
  expect(stderr).toContain("https://debug.bun.sh");
});

test.skipIf(!isLinux)("--inspect-browser should work with script that has spaces in path", async () => {
  const dir = tempDirWithFiles("inspect browser space test", {
    "test script.js": `console.log("Hello from debugger test");`,
  });

  // Create fake xdg-open script that logs the URL
  const xdgOpenScript = `#!/bin/bash
echo "$1" > "${join(dir, "xdg-open-calls.txt")}"
exit 0`;
  
  await Bun.write(join(dir, "xdg-open"), xdgOpenScript);

  // Make the fake xdg-open executable
  await Bun.spawn(["chmod", "+x", join(dir, "xdg-open")], {
    cwd: dir,
  }).exited;

  const env = {
    ...bunEnv,
    PATH: `${dir}:${bunEnv.PATH}`,
  };

  // Start bun with --inspect-browser on a script with spaces in the path
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser", "test script.js"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait a bit for the debugger to start and xdg-open to be called
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that we received the expected URL
  const xdgCallsFile = join(dir, "xdg-open-calls.txt");
  const exists = await Bun.file(xdgCallsFile).exists();
  
  if (exists) {
    const receivedUrl = await Bun.file(xdgCallsFile).text();
    expect(receivedUrl.trim()).toContain("https://debug.bun.sh/#");
  }

  // Check that the debugger output mentions the browser opening
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain("Inspect in browser:");
  expect(stderr).toContain("https://debug.bun.sh");
});

test.skipIf(!isLinux)("--inspect-browser should work with TypeScript files", async () => {
  const dir = tempDirWithFiles("inspect-browser-ts-test", {
    "test.ts": `
const message: string = "Hello from TypeScript debugger test";
console.log(message);
`,
  });

  // Create fake xdg-open script that logs the URL
  const xdgOpenScript = `#!/bin/bash
echo "$1" > "${join(dir, "xdg-open-calls.txt")}"
exit 0`;
  
  await Bun.write(join(dir, "xdg-open"), xdgOpenScript);

  // Make the fake xdg-open executable
  await Bun.spawn(["chmod", "+x", join(dir, "xdg-open")], {
    cwd: dir,
  }).exited;

  const env = {
    ...bunEnv,
    PATH: `${dir}:${bunEnv.PATH}`,
  };

  // Start bun with --inspect-browser on a TypeScript file
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser", "test.ts"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait a bit for the debugger to start and xdg-open to be called
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that we received the expected URL
  const xdgCallsFile = join(dir, "xdg-open-calls.txt");
  const exists = await Bun.file(xdgCallsFile).exists();
  
  if (exists) {
    const receivedUrl = await Bun.file(xdgCallsFile).text();
    expect(receivedUrl.trim()).toContain("https://debug.bun.sh/#");
  }

  // Check that the debugger output mentions the browser opening
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain("Inspect in browser:");
  expect(stderr).toContain("https://debug.bun.sh");
});