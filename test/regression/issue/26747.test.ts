import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26747
// Server config objects with a `stop` method should still auto-start.
// The previous fix for #26142 incorrectly used the presence of a `stop` method
// to detect Server instances, but user config objects (like Elysia apps) can
// legitimately have a `stop` method.

test("server config with stop method as default export should auto-start", async () => {
  using dir = tempDir("issue-26747", {
    "server.js": `
// Export a config object with a stop method
// This should still trigger auto-start
export default {
  port: 0,
  fetch(req) {
    return new Response("Hello from server with stop method");
  },
  stop() {
    // Custom stop method - should not prevent auto-start
  },
};

// Force the process to exit after 100ms so the test can verify the startup message
// without the server blocking forever
setTimeout(() => process.exit(0), 100);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should have started the server (look for the debug message on stdout)
  expect(stdout).toContain("Started");
  expect(exitCode).toBe(0);
});

test("server config with both stop and reload methods should not auto-start", async () => {
  // A config object with a `reload` method is likely a Server instance
  // or something that manages itself, so we should not auto-start it
  using dir = tempDir("issue-26747-reload", {
    "server.js": `
export default {
  port: 0,
  fetch(req) {
    return new Response("Hello");
  },
  stop() {},
  reload() {},
};
console.log("Script completed without auto-starting");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should NOT have started the server because it has a reload method
  expect(stdout).not.toContain("Started");
  expect(stdout).toContain("Script completed without auto-starting");
  expect(exitCode).toBe(0);
});
