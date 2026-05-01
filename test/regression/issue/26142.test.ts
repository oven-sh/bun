import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26142
// When exporting a Server object from Bun.serve() as the default export,
// Bun's entry point wrapper should not try to call Bun.serve() on it again.

test("exporting server as default export should not error", async () => {
  using dir = tempDir("issue-26142", {
    "server.js": `
const server = Bun.serve({
  port: 0,
  routes: {
    "/": { GET: () => Response.json({ message: "Hello" }) },
  },
  fetch(req) {
    return Response.json({ error: "Not Found" }, { status: 404 });
  },
});

console.log("Server running on port " + server.port);

// Stop the server immediately so the process can exit
server.stop();

// This export was causing the issue - entry point wrapper would try to
// call Bun.serve() on the already-running server
export default server;
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

  // Should not have any errors related to double-serving
  expect(stderr).not.toContain("EADDRINUSE");
  expect(stderr).not.toContain("Maximum call stack");
  expect(stderr).not.toContain("is already listening");

  // Check stdout for the expected message
  expect(stdout).toContain("Server running on port");

  // Process should exit successfully
  expect(exitCode).toBe(0);
});

test("server config with fetch as default export should still auto-start", async () => {
  using dir = tempDir("issue-26142-config", {
    "server.js": `
// Export a config object (not a server instance)
// This should still trigger auto-start
export default {
  port: 0,
  fetch(req) {
    return Response.json({ working: true });
  },
};
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Set a timeout to kill the server after checking output
  const timeout = setTimeout(() => proc.kill(), 3000);

  try {
    // Wait for first bit of stdout to verify server started
    const reader = proc.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    // Decode the output
    const decoder = new TextDecoder();
    const output = decoder.decode(value);

    // Should have started the server (look for the debug message on stdout)
    expect(output).toContain("Started");
  } finally {
    clearTimeout(timeout);
    proc.kill();
    await proc.exited;
  }
});
