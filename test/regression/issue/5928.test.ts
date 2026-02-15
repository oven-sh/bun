import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Test for security issue: ValkeyReader.readValue() unbounded recursion
// A malicious Redis/Valkey server can send deeply nested RESP structures
// that exhaust the call stack and crash the Bun process via stack overflow.

test("valkey RESP parser should reject deeply nested responses", async () => {
  // Create a malicious server that sends deeply nested RESP arrays
  // Each "*1\r\n" is a RESP array of length 1, nesting into the next level
  const nestingDepth = 100_000;

  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        // Do nothing on open - wait for data
      },
      data(socket, data) {
        const request = Buffer.from(data).toString();

        // Respond to HELLO (RESP3 protocol negotiation) with a simple OK
        if (request.includes("HELLO")) {
          socket.write("+OK\r\n");
          return;
        }

        // For any other command (e.g., GET), send a deeply nested RESP array
        // *1\r\n repeated nestingDepth times, then a leaf value
        let response = "";
        for (let i = 0; i < nestingDepth; i++) {
          response += "*1\r\n";
        }
        response += "$3\r\nfoo\r\n";
        socket.write(response);
      },
      close() {},
      error(socket, err) {},
    },
  });

  const port = server.port;

  // Use a subprocess so a crash doesn't take down the test runner
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const client = new Bun.RedisClient("redis://127.0.0.1:${port}");
      try {
        const result = await client.send("GET", ["test"]);
        // If we get here without crashing, the parser handled it
        console.log("RESULT:" + JSON.stringify(result));
      } catch (e) {
        console.log("ERROR:" + e.message);
      } finally {
        client.close();
      }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The process should NOT crash (exit code 0 or a handled error)
  // Before the fix: process crashes with stack overflow (signal 11/SIGSEGV or similar)
  // After the fix: parser returns an error about nesting depth exceeded
  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
    console.log("exitCode:", exitCode);
  }
  expect(stdout).toContain("ERROR:");
  expect(exitCode).toBe(0);
});
