import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("--max-http-header-size for response headers", () => {
  test("fetch should fail when response headers exceed limit", async () => {
    // Use Bun.serve to create a server that returns large headers
    using server = Bun.serve({
      port: 0,
      fetch(_req) {
        // Create response with 18KB header (larger than 16KB limit)
        return new Response("body", {
          headers: {
            "Large-Header": "a".repeat(18 * 1024),
          },
        });
      },
    });

    // Create a client script that uses fetch
    using clientDir = tempDir("max-header-client", {
      "client.js": `
        try {
          const res = await fetch("${server.url}");
          console.log("SUCCESS");
          process.exit(0);
        } catch (error) {
          if (error.code === "HeadersOverflow") {
            console.log("HEADERS_OVERFLOW");
            process.exit(0);
          }
          console.log("ERROR:" + error.message + " code:" + error.code);
          process.exit(1);
        }
      `,
    });

    // Run the client with --max-http-header-size=16384 (16KB)
    await using clientProc = Bun.spawn({
      cmd: [bunExe(), "--max-http-header-size=16384", "client.js"],
      env: bunEnv,
      cwd: String(clientDir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [clientStdout, clientStderr, clientExitCode] = await Promise.all([
      clientProc.stdout.text(),
      clientProc.stderr.text(),
      clientProc.exited,
    ]);

    // With the fix, the client should fail with a headers overflow error
    expect(clientStdout.trim()).toBe("HEADERS_OVERFLOW");
    expect(clientExitCode).toBe(0);
  });

  test("fetch should succeed when response headers are within limit", async () => {
    // Use Bun.serve to create a server that returns headers within limit
    using server = Bun.serve({
      port: 0,
      fetch(_req) {
        // Create response with 8KB header (smaller than 16KB limit)
        return new Response("body", {
          headers: {
            "Large-Header": "a".repeat(8 * 1024),
          },
        });
      },
    });

    // Create a client script that uses fetch
    using clientDir = tempDir("max-header-client-ok", {
      "client.js": `
        try {
          const res = await fetch("${server.url}");
          const headerValue = res.headers.get("large-header");
          if (headerValue && headerValue.length === 8 * 1024) {
            console.log("SUCCESS");
            process.exit(0);
          }
          console.log("UNEXPECTED:" + (headerValue ? headerValue.length : "null"));
          process.exit(1);
        } catch (error) {
          console.log("ERROR:" + error.message + " code:" + error.code);
          process.exit(1);
        }
      `,
    });

    // Run the client with --max-http-header-size=16384 (16KB)
    await using clientProc = Bun.spawn({
      cmd: [bunExe(), "--max-http-header-size=16384", "client.js"],
      env: bunEnv,
      cwd: String(clientDir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [clientStdout, clientStderr, clientExitCode] = await Promise.all([
      clientProc.stdout.text(),
      clientProc.stderr.text(),
      clientProc.exited,
    ]);

    // The client should succeed because headers are within limit
    expect(clientStdout.trim()).toBe("SUCCESS");
    expect(clientExitCode).toBe(0);
  });
});
