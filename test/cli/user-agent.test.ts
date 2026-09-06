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

  // The value is copied into every request head as-is, so CR, LF or NUL
  // would end the User-Agent line and inject header lines or a second request.
  describe.concurrent("rejects a value containing CR, LF or NUL", () => {
    async function run(userAgent: string, viaEnv: boolean) {
      const seen: string[] = [];
      await using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          seen.push(req.headers.get("user-agent") ?? "");
          return new Response("ok");
        },
      });
      const script = `await fetch("http://127.0.0.1:${server.port}/")`;
      await using proc = Bun.spawn({
        cmd: viaEnv ? [bunExe(), "-e", script] : [bunExe(), `--user-agent=${userAgent}`, "-e", script],
        env: viaEnv ? { ...bunEnv, BUN_OPTIONS: `--user-agent="${userAgent}"` } : bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { seen, stdout, stderr, exitCode };
    }

    for (const [name, userAgent] of [
      ["CRLF", "evil\r\nInjected: 1"],
      ["bare CR", "evil\rInjected: 1"],
      ["bare LF", "evil\nInjected: 1"],
    ] as const) {
      test(name, async () => {
        const { seen, stdout, stderr, exitCode } = await run(userAgent, false);
        expect(stdout).toBe("");
        expect(stderr).toContain("--user-agent");
        expect(stderr).toContain("newline or NUL");
        expect(seen).toEqual([]);
        expect(exitCode).toBe(1);
      });
    }

    test("via BUN_OPTIONS", async () => {
      const { seen, stdout, stderr, exitCode } = await run(
        "evil\r\n\r\nGET /smuggled HTTP/1.1\r\nHost: x\r\n\r\n",
        true,
      );
      expect(stdout).toBe("");
      expect(stderr).toContain("--user-agent");
      expect(stderr).toContain("newline or NUL");
      expect(seen).toEqual([]);
      expect(exitCode).toBe(1);
    });
  });
});
