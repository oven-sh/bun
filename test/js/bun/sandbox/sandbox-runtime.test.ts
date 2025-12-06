import { afterEach, describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";

// Import sandbox runtime from the bun-sandbox package
const sandboxModule = await import("../../../../packages/bun-sandbox/src/index");
const { Sandbox, parseSandboxfile, inferSandboxfile } = sandboxModule;

describe("Sandbox Runtime", () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  test("runs simple command", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR .
RUN echo "hello world"
`);

    let stdout = "";
    const sandbox = new Sandbox(config, {
      onStdout: (_service, data) => {
        stdout += data;
      },
    });

    cleanup = () => sandbox.stop();

    const success = await sandbox.runSetup();
    expect(success).toBe(true);
    expect(stdout.trim()).toBe("hello world");
  });

  test("runs multiple RUN commands in sequence", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR .
RUN echo "first"
RUN echo "second"
RUN echo "third"
`);

    const outputs: string[] = [];
    const sandbox = new Sandbox(config, {
      onStdout: (_service, data) => {
        outputs.push(data.trim());
      },
    });

    cleanup = () => sandbox.stop();

    const success = await sandbox.runSetup();
    expect(success).toBe(true);
    expect(outputs).toEqual(["first", "second", "third"]);
  });

  test("fails on bad RUN command", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR .
RUN sh -c "exit 1"
`);

    const sandbox = new Sandbox(config, {});
    cleanup = () => sandbox.stop();

    const success = await sandbox.runSetup();
    expect(success).toBe(false);
  });

  test("runs TEST commands", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR .
TEST echo "test passed"
`);

    let stdout = "";
    const sandbox = new Sandbox(config, {
      onStdout: (_service, data) => {
        stdout += data;
      },
    });

    cleanup = () => sandbox.stop();

    const results = await sandbox.runTests();
    expect(results.passed).toBe(true);
    expect(results.results).toHaveLength(1);
    expect(results.results[0].passed).toBe(true);
    expect(stdout.trim()).toBe("test passed");
  });

  test("reports failed TEST", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR .
TEST sh -c "exit 0"
TEST sh -c "exit 1"
TEST sh -c "exit 0"
`);

    const sandbox = new Sandbox(config, {});
    cleanup = () => sandbox.stop();

    const results = await sandbox.runTests();
    expect(results.passed).toBe(false);
    expect(results.results).toHaveLength(3);
    expect(results.results[0].passed).toBe(true);
    expect(results.results[1].passed).toBe(false);
    expect(results.results[2].passed).toBe(true);
  });

  test("starts and stops SERVICE", async () => {
    using dir = tempDir("sandbox-test", {
      "server.js": `
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            return new Response("hello from service");
          },
        });
        console.log("SERVER_PORT=" + server.port);
      `,
    });

    const config = parseSandboxfile(`
FROM host
WORKDIR ${dir}
SERVICE api ${bunExe()} server.js
`);

    let port: number | null = null;
    const sandbox = new Sandbox(config, {
      onStdout: (_service, data) => {
        const match = data.match(/SERVER_PORT=(\d+)/);
        if (match) {
          port = parseInt(match[1], 10);
        }
      },
    });

    cleanup = () => sandbox.stop();

    await sandbox.startServices();

    // Wait for service to start
    await new Promise(r => setTimeout(r, 500));

    expect(sandbox.isRunning()).toBe(true);
    expect(sandbox.getStatus()).toHaveLength(1);
    expect(sandbox.getStatus()[0].name).toBe("api");

    // Test the service is responding
    if (port) {
      const response = await fetch(`http://localhost:${port}`);
      const text = await response.text();
      expect(text).toBe("hello from service");
    }

    await sandbox.stop();
    expect(sandbox.isRunning()).toBe(false);
  });

  test("loads secrets from environment", async () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR .
SECRET TEST_SECRET
RUN sh -c "echo $TEST_SECRET"
`);

    let stdout = "";
    const sandbox = new Sandbox(config, {
      env: { TEST_SECRET: "secret_value_123" },
      onStdout: (_service, data) => {
        stdout += data;
      },
    });

    cleanup = () => sandbox.stop();

    sandbox.loadSecrets();
    const success = await sandbox.runSetup();
    expect(success).toBe(true);
    expect(stdout.trim()).toBe("secret_value_123");
  });

  test("validates network access", () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR .
NET api.example.com
NET *.stripe.com
`);

    const sandbox = new Sandbox(config, {});

    expect(sandbox.isNetworkAllowed("api.example.com")).toBe(true);
    expect(sandbox.isNetworkAllowed("other.example.com")).toBe(false);
    expect(sandbox.isNetworkAllowed("api.stripe.com")).toBe(true);
    expect(sandbox.isNetworkAllowed("payments.stripe.com")).toBe(true);
    expect(sandbox.isNetworkAllowed("evil.com")).toBe(false);
  });

  test("denies all network by default", () => {
    const config = parseSandboxfile(`
FROM host
WORKDIR .
`);

    const sandbox = new Sandbox(config, {});

    expect(sandbox.isNetworkAllowed("any.host.com")).toBe(false);
  });

  test("extracts output files", async () => {
    using srcDir = tempDir("sandbox-src", {
      "file1.txt": "content1",
      "file2.txt": "content2",
      "subdir/file3.txt": "content3",
    });

    using destDir = tempDir("sandbox-dest", {});

    const config = parseSandboxfile(`
FROM host
WORKDIR ${srcDir}
OUTPUT *.txt
OUTPUT subdir/*
`);

    const sandbox = new Sandbox(config, {});
    cleanup = () => sandbox.stop();

    const extracted = await sandbox.extractOutputs(String(destDir));

    expect(extracted).toContain("file1.txt");
    expect(extracted).toContain("file2.txt");

    // Verify files were copied
    const file1 = Bun.file(`${destDir}/file1.txt`);
    expect(await file1.text()).toBe("content1");
  });

  test("runs workdir in temp directory", async () => {
    using dir = tempDir("sandbox-workdir", {
      "test.sh": "pwd",
    });

    const config = parseSandboxfile(`
FROM host
WORKDIR ${dir}
RUN pwd
`);

    let stdout = "";
    const sandbox = new Sandbox(config, {
      onStdout: (_service, data) => {
        stdout += data;
      },
    });

    cleanup = () => sandbox.stop();

    await sandbox.runSetup();
    expect(stdout.trim()).toBe(String(dir));
  });
});

describe("Sandbox Inference", () => {
  test("infers from package.json with scripts", async () => {
    using dir = tempDir("sandbox-infer", {
      "package.json": JSON.stringify({
        name: "test-project",
        scripts: {
          dev: "bun run server.js",
          test: "bun test",
          build: "bun build ./src/index.ts",
        },
        dependencies: {
          "some-dep": "1.0.0",
        },
      }),
    });

    const config = await inferSandboxfile(String(dir));

    expect(config.from).toBe("host");
    expect(config.workdir).toBe(".");
    expect(config.runCommands).toContain("bun install");
    expect(config.dev?.command).toBe("bun run dev");
    expect(config.tests.some(t => t.command === "bun run test")).toBe(true);
    expect(config.outputs).toContain("package.json");
  });

  test("infers secrets from .env file", async () => {
    using dir = tempDir("sandbox-infer-secrets", {
      "package.json": JSON.stringify({ name: "test" }),
      ".env": `
DATABASE_URL=postgres://localhost:5432/db
STRIPE_API_KEY=sk_test_123
AUTH_SECRET=some_secret
NORMAL_VAR=not_a_secret
AWS_SECRET_KEY=aws_key
`,
    });

    const config = await inferSandboxfile(String(dir));

    expect(config.secrets).toContain("STRIPE_API_KEY");
    expect(config.secrets).toContain("AUTH_SECRET");
    expect(config.secrets).toContain("AWS_SECRET_KEY");
    // NORMAL_VAR and DATABASE_URL don't match the pattern
    expect(config.secrets).not.toContain("NORMAL_VAR");
  });
});

describe("Sandbox Full Lifecycle", () => {
  test("runs complete sandbox lifecycle", async () => {
    using dir = tempDir("sandbox-lifecycle", {
      "setup.sh": "echo 'setup complete' > setup.log",
      "test.sh": "cat setup.log",
    });

    const config = parseSandboxfile(`
FROM host
WORKDIR ${dir}
RUN sh setup.sh
TEST sh test.sh
OUTPUT setup.log
`);

    let testOutput = "";
    const sandbox = new Sandbox(config, {
      onStdout: (service, data) => {
        if (service.startsWith("test")) {
          testOutput += data;
        }
      },
    });

    const result = await sandbox.run();

    expect(result.success).toBe(true);
    expect(result.testResults?.passed).toBe(true);
    expect(testOutput.trim()).toBe("setup complete");

    await sandbox.stop();
  });
});
