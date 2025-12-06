import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Sandboxfile", () => {
  describe("parsing", () => {
    test("parses basic Sandboxfile with all directives", async () => {
      using dir = tempDir("sandboxfile-test", {
        Sandboxfile: `# Sandboxfile

FROM host
WORKDIR .

RUN bun install

DEV PORT=3000 WATCH=src/** bun run dev
SERVICE db PORT=5432 docker compose up postgres
SERVICE redis PORT=6379 redis-server
TEST bun test

OUTPUT src/
OUTPUT tests/
OUTPUT package.json

LOGS logs/*

NET registry.npmjs.org
NET api.stripe.com

SECRET STRIPE_API_KEY
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("FROM host");
      expect(content).toContain("WORKDIR .");
      expect(content).toContain("RUN bun install");
      expect(content).toContain("DEV PORT=3000");
      expect(content).toContain("SERVICE db PORT=5432");
      expect(content).toContain("OUTPUT src/");
      expect(content).toContain("NET registry.npmjs.org");
      expect(content).toContain("SECRET STRIPE_API_KEY");
    });

    test("parses INFER shorthand", async () => {
      using dir = tempDir("sandboxfile-infer", {
        Sandboxfile: `FROM host
WORKDIR .
INFER *
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("FROM host");
      expect(content).toContain("INFER *");
    });

    test("parses FROM with container image", async () => {
      using dir = tempDir("sandboxfile-image", {
        Sandboxfile: `FROM node:18-alpine
WORKDIR /app
RUN npm install
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("FROM node:18-alpine");
      expect(content).toContain("WORKDIR /app");
    });

    test("handles comments and empty lines", async () => {
      using dir = tempDir("sandboxfile-comments", {
        Sandboxfile: `# This is a Sandboxfile for a web application
# Author: Test

FROM host
WORKDIR .

# Install dependencies
RUN bun install

# Development server configuration
DEV PORT=3000 bun run dev
`,
      });

      const file = Bun.file(`${String(dir)}/Sandboxfile`);
      const content = await file.text();

      expect(content).toContain("# This is a Sandboxfile");
      expect(content).toContain("FROM host");
      expect(content).toContain("RUN bun install");
    });
  });

  describe("CLI", () => {
    test("sandbox --help shows usage", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "sandbox", "--help"],
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout + stderr).toContain("Usage: bun sandbox");
      expect(stdout + stderr).toContain("--dry-run");
      expect(stdout + stderr).toContain("--test");
    });

    test("sandbox without Sandboxfile shows error", async () => {
      using dir = tempDir("sandboxfile-missing", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "sandbox"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("Sandboxfile not found");
      expect(exitCode).toBe(1);
    });

    test("sandbox --dry-run validates Sandboxfile", async () => {
      using dir = tempDir("sandboxfile-dryrun", {
        Sandboxfile: `FROM host
WORKDIR .
RUN echo "setup"
TEST echo "test passed"
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "sandbox", "--dry-run"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("Parsed Sandboxfile");
      expect(stderr).toContain("FROM: host");
      expect(stderr).toContain("Sandboxfile is valid");
      expect(exitCode).toBe(0);
    });

    test("sandbox runs RUN commands", async () => {
      using dir = tempDir("sandboxfile-run", {
        Sandboxfile: `FROM host
WORKDIR .
RUN echo "hello from sandbox" > output.txt
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "sandbox"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("RUN echo");
      expect(exitCode).toBe(0);

      // Verify the file was created
      const outputFile = Bun.file(`${String(dir)}/output.txt`);
      const outputContent = await outputFile.text();
      expect(outputContent.trim()).toBe("hello from sandbox");
    });

    test("sandbox runs TEST commands", async () => {
      using dir = tempDir("sandboxfile-test-cmd", {
        Sandboxfile: `FROM host
WORKDIR .
TEST echo "tests passed"
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "sandbox", "--test"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("TEST echo");
      expect(stderr).toContain("tests passed");
      expect(exitCode).toBe(0);
    });

    test("sandbox fails on RUN command failure", async () => {
      using dir = tempDir("sandboxfile-fail", {
        Sandboxfile: `FROM host
WORKDIR .
RUN exit 1
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "sandbox"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("Setup failed");
      expect(exitCode).toBe(1);
    });

    test("sandbox sets BUN_SANDBOX environment variable", async () => {
      using dir = tempDir("sandboxfile-env", {
        Sandboxfile: `FROM host
WORKDIR .
RUN echo $BUN_SANDBOX > sandbox_env.txt
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "sandbox"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);

      // Verify the environment variable was set
      const envFile = Bun.file(`${String(dir)}/sandbox_env.txt`);
      const envContent = await envFile.text();
      expect(envContent.trim()).toBe("1");
    });
  });
});
