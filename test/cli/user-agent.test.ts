import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("--user-agent flag", () => {
  test("custom user agent is sent in HTTP requests", async () => {
    const customUserAgent = "MyCustomUserAgent/1.0";

    const testScript = `
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const userAgent = request.headers.get("User-Agent");
    if (userAgent === "${customUserAgent}") {
      process.exit(0); // SUCCESS
    } else {
      process.exit(1); // FAIL
    }
  },
});

// Make request to self
try {
  await fetch(\`http://localhost:\${server.port}/test\`);
} catch (error) {
  process.exit(1);
}
`;

    await using dir = tempDir("user-agent-test", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--user-agent", customUserAgent, "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("default user agent is used when --user-agent is not specified", async () => {
    const testScript = `
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const userAgent = request.headers.get("User-Agent");
    // Default Bun user agent should contain "Bun/"
    if (userAgent && userAgent.includes("Bun/")) {
      process.exit(0); // SUCCESS
    } else {
      process.exit(1); // FAIL
    }
  },
});

// Make request to self
try {
  await fetch(\`http://localhost:\${server.port}/test\`);
} catch (error) {
  process.exit(1);
}
`;

    await using dir = tempDir("user-agent-default-test", {
      "test.js": testScript,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  // The value is written into `User-Agent: <value>` as-is, so a value holding
  // "\r\n" used to end that header line and send whatever followed it as
  // additional header lines. It must be rejected before any request is made.
  describe.concurrent("value containing CR, LF or NUL is rejected", () => {
    const error = "Invalid value for --user-agent: must not contain a newline or NUL byte";

    async function fetchWith(flags: string[], env: Record<string, string> = {}) {
      const seen: { injected: string | null }[] = [];
      await using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          seen.push({ injected: req.headers.get("x-injected") });
          return new Response("ok");
        },
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...flags, "-e", `await fetch("${server.url}")`],
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { seen, stdout, stderr, exitCode };
    }

    test("--user-agent with CRLF", async () => {
      const { seen, stderr, exitCode } = await fetchWith(["--user-agent", "abc\r\nX-Injected: 1"]);
      expect(seen).toEqual([]);
      expect(stderr).toContain(error);
      expect(exitCode).toBe(1);
    });

    test("--user-agent from BUN_OPTIONS", async () => {
      const { seen, stderr, exitCode } = await fetchWith([], { BUN_OPTIONS: "--user-agent='abc\r\nX-Injected: 1'" });
      expect(seen).toEqual([]);
      expect(stderr).toContain(error);
      expect(exitCode).toBe(1);
    });

    test.each([
      ["a bare LF", "abc\ndef"],
      ["a bare CR", "abc\rdef"],
    ])("--user-agent with %s", async (_, userAgent) => {
      const { seen, stderr, exitCode } = await fetchWith(["--user-agent", userAgent]);
      expect(seen).toEqual([]);
      expect(stderr).toContain(error);
      expect(exitCode).toBe(1);
    });
  });
});
