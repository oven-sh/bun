// While `--inspect-browser` has an optional port number, it defaults to 9229
// which means that specifying an exact port number is basically mandatory for
// CI to run it reliably.

import { expect, test } from "bun:test";
import { chmod } from "fs/promises";
import { bunEnv, bunExe, isPosix, randomPort, tempDirWithFiles } from "harness";
import { join } from "path";

async function setupInspectorTest(testName: string, files: Record<string, string>) {
  const dir = tempDirWithFiles(testName, {
    ...files,
    "open": `#!/bin/bash\necho "$@" | nc -U inspect-browser-test.sock\n`,
    "xdg-open": `#!/bin/bash\necho "$@" | nc -U inspect-browser-test.sock\n`,
  });

  // Make scripts executable
  await chmod(join(dir, "open"), 0o777);
  await chmod(join(dir, "xdg-open"), 0o777);

  // Set up Unix domain socket listener
  const { promise, resolve } = Promise.withResolvers<string>();

  // Avoid issues with long paths.
  const pwd = process.cwd();
  process.chdir(dir);
  const server = Bun.listen({
    unix: "inspect-browser-test.sock",
    socket: {
      data(socket, data) {
        console.log("data", data.toString());
        const args = new TextDecoder().decode(data).trim();
        resolve(args);
        socket.end();
      },
    },
  });
  process.chdir(pwd);
  server.unref();

  return { dir, promise, server };
}

test.skipIf(!isPosix)("--inspect-browser with custom port should work", async () => {
  const { dir, promise, server } = await setupInspectorTest("inspect-browser-port-test", {
    "test.js": `console.log("Hello from debugger test");`,
  });

  await using _ = server;

  // Start bun with --inspect-browser with a custom port
  const url = "localhost:" + randomPort();
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser=" + url, "test.js"],
    env: { ...bunEnv, PATH: `${dir}:${bunEnv.PATH}` },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the socket to receive data
  const receivedArgs = await promise;
  expect(receivedArgs).toContain("https://debug.bun.sh/#" + url);

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that the debugger output shows the custom port
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain(url);
  expect(stderr).toContain("https://debug.bun.sh/#" + url);
});

test.skipIf(!isPosix)("--inspect-browser with IP address should work", async () => {
  const { dir, promise, server } = await setupInspectorTest("inspect-browser-ip-test", {
    "test.js": `console.log("Hello from debugger test");`,
  });

  await using _ = server;

  const url = "127.0.0.1:" + randomPort();

  // Start bun with --inspect-browser with an IP address
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser=" + url, "test.js"],
    env: { ...bunEnv, PATH: `${dir}:${bunEnv.PATH}` },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the socket to receive data
  const receivedArgs = await promise;
  expect(receivedArgs).toContain("https://debug.bun.sh/#" + url);

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that the debugger output shows the IP address
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain(url);
  expect(stderr).toContain("https://debug.bun.sh/#" + url);
});

test.skipIf(!isPosix)("--inspect-browser should work with script that has spaces in path", async () => {
  const { dir, promise, server } = await setupInspectorTest("inspect browser space test", {
    "test script.js": `console.log("Hello from debugger test");`,
  });

  await using _ = server;

  const url = "localhost:" + randomPort();

  // Start bun with --inspect-browser on a script with spaces in the path
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect-browser=" + url, "test script.js"],
    env: { ...bunEnv, PATH: `${dir}:${bunEnv.PATH}` },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the socket to receive data
  const receivedArgs = await promise;
  expect(receivedArgs).toContain("https://debug.bun.sh/#" + url);

  // Kill the process
  proc.kill();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Check that the debugger output shows the inspector is running
  expect(stderr).toContain("Bun Inspector");
  expect(stderr).toContain(url);
  expect(stderr).toContain("https://debug.bun.sh/#" + url);
});
