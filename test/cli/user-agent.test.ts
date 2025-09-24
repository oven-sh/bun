import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

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

    const dir = tempDirWithFiles("user-agent-test", {
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

    const dir = tempDirWithFiles("user-agent-default-test", {
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
});
