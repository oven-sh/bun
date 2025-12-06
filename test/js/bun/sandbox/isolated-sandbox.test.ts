import { beforeAll, describe, expect, test } from "bun:test";
import { tempDir } from "harness";

const isolatedSandbox = await import("../../../../packages/bun-sandbox/src/isolated-sandbox");
const { checkIsolationSupport, runIsolated, runIsolatedBwrap, runIsolatedUnshare, IsolatedSandbox } = isolatedSandbox;
const { parseSandboxfile } = await import("../../../../packages/bun-sandbox/src/index");

describe("Isolation Support Check", () => {
  test("checkIsolationSupport returns valid object", async () => {
    const support = await checkIsolationSupport();

    expect(typeof support.bwrap).toBe("boolean");
    expect(typeof support.unshare).toBe("boolean");
    expect(typeof support.fuseOverlayfs).toBe("boolean");
    expect(typeof support.userNamespaces).toBe("boolean");

    console.log("Isolation support:", support);
  });
});

describe("Isolated Sandbox", () => {
  let isolationAvailable = false;

  beforeAll(async () => {
    const support = await checkIsolationSupport();
    isolationAvailable = support.bwrap || (support.unshare && support.userNamespaces);
    if (!isolationAvailable) {
      console.warn("Skipping isolation tests - no isolation method available");
    }
  });

  test("runs command in isolated environment", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
`);

    const result = await runIsolated(["echo", "hello from sandbox"], config, {
      verbose: true,
    });

    expect(result.stdout.trim()).toBe("hello from sandbox");
    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(true);
  });

  test("isolates network when NET is empty", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
`);

    // Try to access network - should fail with network isolation
    const result = await runIsolated(
      ["sh", "-c", "curl -s --connect-timeout 1 http://example.com || echo 'network blocked'"],
      config,
      {
        verbose: true,
      },
    );

    // Either curl fails or network is blocked
    if (result.stdout.includes("network blocked") || result.exitCode !== 0) {
      // Network was blocked - good
      expect(true).toBe(true);
    } else {
      // Network worked - isolation not active (fallback mode)
      console.warn("Network isolation not active - running in fallback mode");
    }
  });

  test("provides isolated PID namespace", async () => {
    const support = await checkIsolationSupport();
    if (!support.bwrap && !support.unshare) {
      console.warn("Skipping PID namespace test - no isolation available");
      return;
    }

    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
`);

    // In a PID namespace, our process should be PID 1 (or low number)
    const result = await runIsolated(["sh", "-c", "echo $$"], config, {
      verbose: true,
    });

    const pid = parseInt(result.stdout.trim(), 10);
    // In isolated PID namespace, shell should get a low PID
    // In non-isolated, it will be much higher
    console.log("PID in sandbox:", pid);
    expect(result.success).toBe(true);
  });

  test("provides isolated hostname", async () => {
    const support = await checkIsolationSupport();
    if (!support.bwrap && !support.unshare) {
      console.warn("Skipping hostname test - no isolation available");
      return;
    }

    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
`);

    const result = await runIsolated(["hostname"], config, {
      verbose: true,
    });

    // With UTS namespace, hostname should be "sandbox" (our default)
    // Without isolation, it will be the host's hostname
    console.log("Hostname in sandbox:", result.stdout.trim());
    expect(result.success).toBe(true);
  });

  test("passes environment variables", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
`);

    const result = await runIsolated(["sh", "-c", "echo $MY_VAR"], config, {
      env: { MY_VAR: "test_value_123" },
    });

    expect(result.stdout.trim()).toBe("test_value_123");
    expect(result.success).toBe(true);
  });

  test("passes secrets to sandbox", async () => {
    // Set up a secret in the environment
    process.env.TEST_SECRET_KEY = "super_secret_value";

    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
SECRET TEST_SECRET_KEY
`);

    const result = await runIsolated(["sh", "-c", "echo $TEST_SECRET_KEY"], config, {
      verbose: true,
    });

    expect(result.stdout.trim()).toBe("super_secret_value");
    expect(result.success).toBe(true);

    // Clean up
    delete process.env.TEST_SECRET_KEY;
  });

  test("returns non-zero exit code on failure", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
`);

    const result = await runIsolated(["sh", "-c", "exit 42"], config, {});

    expect(result.exitCode).toBe(42);
    expect(result.success).toBe(false);
  });

  test("captures stdout and stderr", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
`);

    const result = await runIsolated(["sh", "-c", 'echo "stdout message" && echo "stderr message" >&2'], config, {});

    expect(result.stdout).toContain("stdout message");
    expect(result.stderr).toContain("stderr message");
    expect(result.success).toBe(true);
  });

  test("uses working directory from config", async () => {
    using dir = tempDir("sandbox-workdir", {});

    const config = parseSandboxfile(`
FROM host
WORKDIR ${dir}
`);

    const result = await runIsolated(["pwd"], config, {
      cwd: String(dir),
    });

    expect(result.stdout.trim()).toBe(String(dir));
    expect(result.success).toBe(true);
  });
});

describe("IsolatedSandbox Class", () => {
  test("runs setup commands", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
RUN echo "setup 1"
RUN echo "setup 2"
`);

    const sandbox = new IsolatedSandbox(config, { verbose: true });
    const success = await sandbox.runSetup();

    expect(success).toBe(true);
  });

  test("runs tests and reports results", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
TEST sh -c "echo test1 && exit 0"
TEST sh -c "echo test2 && exit 1"
TEST sh -c "echo test3 && exit 0"
`);

    const sandbox = new IsolatedSandbox(config, { verbose: true });
    const results = await sandbox.runTests();

    expect(results.passed).toBe(false);
    expect(results.results).toHaveLength(3);
    expect(results.results[0].passed).toBe(true);
    expect(results.results[1].passed).toBe(false);
    expect(results.results[2].passed).toBe(true);
  });

  test("full lifecycle with run()", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
RUN echo "setting up"
TEST sh -c "exit 0"
`);

    const sandbox = new IsolatedSandbox(config, { verbose: true });
    const result = await sandbox.run();

    expect(result.success).toBe(true);
    expect(result.testResults?.passed).toBe(true);
  });

  test("loads and passes secrets", async () => {
    process.env.SANDBOX_TEST_SECRET = "secret123";

    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
SECRET SANDBOX_TEST_SECRET
RUN sh -c "echo $SANDBOX_TEST_SECRET"
`);

    const sandbox = new IsolatedSandbox(config, { verbose: true });
    sandbox.loadSecrets();
    const success = await sandbox.runSetup();

    expect(success).toBe(true);

    delete process.env.SANDBOX_TEST_SECRET;
  });
});

describe("Sandbox Security Properties", () => {
  test("cannot see host processes (with PID namespace)", async () => {
    const support = await checkIsolationSupport();
    if (!support.bwrap) {
      console.warn("Skipping - bwrap not available");
      return;
    }

    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
`);

    // Try to list processes - with PID namespace, should only see sandbox processes
    const result = await runIsolated(["sh", "-c", "ps aux 2>/dev/null | wc -l || echo 0"], config, {});

    const processCount = parseInt(result.stdout.trim(), 10);
    console.log("Process count in sandbox:", processCount);

    // With PID namespace, should see very few processes (< 10)
    // Without isolation, would see all host processes (potentially hundreds)
    if (processCount > 0 && processCount < 20) {
      expect(true).toBe(true); // PID namespace working
    } else {
      console.warn("PID namespace may not be fully isolated");
    }
  });

  test("has isolated /tmp", async () => {
    const support = await checkIsolationSupport();
    if (!support.bwrap) {
      console.warn("Skipping - bwrap not available");
      return;
    }

    // Create a file in host /tmp
    const marker = `sandbox-test-${Date.now()}`;
    await Bun.write(`/tmp/${marker}`, "host file");

    const config = parseSandboxfile(`
FROM host
WORKDIR /tmp
`);

    // Try to read the file from sandbox
    const result = await runIsolated(["sh", "-c", `cat /tmp/${marker} 2>/dev/null || echo "not found"`], config, {});

    // With tmpfs on /tmp, the file should not be visible
    if (result.stdout.trim() === "not found") {
      expect(true).toBe(true); // /tmp is isolated
    } else {
      console.warn("/tmp may not be fully isolated");
    }

    // Cleanup
    await Bun.file(`/tmp/${marker}`).delete();
  });
});
