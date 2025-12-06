import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Import from bun-sandbox package
import { parseSandboxfile, SandboxRunner } from "../../../../packages/bun-sandbox/src/index";

describe("Sandboxfile parser", () => {
  test("parse simple sandboxfile", () => {
    const content = `# Sandboxfile

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

SECRET STRIPE_API_KEY`;

    const result = parseSandboxfile(content);

    expect(result.from).toBe("host");
    expect(result.workdir).toBe(".");
    expect(result.runCommands).toEqual(["bun install"]);

    // DEV
    expect(result.dev).toBeDefined();
    expect(result.dev!.port).toBe(3000);
    expect(result.dev!.watch).toBe("src/**");
    expect(result.dev!.command).toBe("bun run dev");

    // SERVICES
    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe("db");
    expect(result.services[0].port).toBe(5432);
    expect(result.services[0].command).toBe("docker compose up postgres");
    expect(result.services[1].name).toBe("redis");
    expect(result.services[1].port).toBe(6379);
    expect(result.services[1].command).toBe("redis-server");

    // TEST
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].command).toBe("bun test");

    // OUTPUTS
    expect(result.outputs).toEqual(["src/", "tests/", "package.json"]);

    // LOGS
    expect(result.logs).toEqual(["logs/*"]);

    // NET
    expect(result.netHosts).toEqual(["registry.npmjs.org", "api.stripe.com"]);

    // SECRET
    expect(result.secrets).toEqual(["STRIPE_API_KEY"]);
  });

  test("parse infer shorthand", () => {
    const content = `FROM host
WORKDIR .
INFER *`;

    const result = parseSandboxfile(content);

    expect(result.from).toBe("host");
    expect(result.workdir).toBe(".");
    expect(result.inferPatterns).toEqual(["*"]);
  });

  test("parse empty lines and comments", () => {
    const content = `# This is a comment

FROM host

# Another comment
WORKDIR /app
`;

    const result = parseSandboxfile(content);

    expect(result.from).toBe("host");
    expect(result.workdir).toBe("/app");
  });

  test("parse process with optional name", () => {
    // Name is detected when it's the first token followed by a KEY=VALUE pair
    const content = `DEV mydev PORT=8080 npm start
TEST unit PORT=0 bun test unit
TEST bun test`;

    const result = parseSandboxfile(content);

    expect(result.dev).toBeDefined();
    expect(result.dev!.name).toBe("mydev");
    expect(result.dev!.port).toBe(8080);
    expect(result.dev!.command).toBe("npm start");

    expect(result.tests).toHaveLength(2);
    expect(result.tests[0].name).toBe("unit");
    expect(result.tests[0].port).toBe(0);
    expect(result.tests[0].command).toBe("bun test unit");
    expect(result.tests[1].name).toBeUndefined();
    expect(result.tests[1].command).toBe("bun test");
  });

  test("parse multiple RUN commands", () => {
    const content = `FROM host
RUN npm install
RUN npm run build
RUN npm run migrate`;

    const result = parseSandboxfile(content);

    expect(result.runCommands).toEqual(["npm install", "npm run build", "npm run migrate"]);
  });

  test("parse complex service definitions", () => {
    const content = `SERVICE postgres PORT=5432 WATCH=schema/** docker compose up -d postgres
SERVICE redis PORT=6379 redis-server --daemonize yes
SERVICE elasticsearch PORT=9200 docker run -p 9200:9200 elasticsearch:8`;

    const result = parseSandboxfile(content);

    expect(result.services).toHaveLength(3);

    expect(result.services[0].name).toBe("postgres");
    expect(result.services[0].port).toBe(5432);
    expect(result.services[0].watch).toBe("schema/**");
    expect(result.services[0].command).toBe("docker compose up -d postgres");

    expect(result.services[1].name).toBe("redis");
    expect(result.services[1].port).toBe(6379);
    expect(result.services[1].command).toBe("redis-server --daemonize yes");

    expect(result.services[2].name).toBe("elasticsearch");
    expect(result.services[2].port).toBe(9200);
    expect(result.services[2].command).toBe("docker run -p 9200:9200 elasticsearch:8");
  });

  test("parse multiple network hosts", () => {
    const content = `NET registry.npmjs.org
NET api.github.com
NET api.stripe.com
NET *.amazonaws.com`;

    const result = parseSandboxfile(content);

    expect(result.netHosts).toEqual(["registry.npmjs.org", "api.github.com", "api.stripe.com", "*.amazonaws.com"]);
  });

  test("parse multiple secrets", () => {
    const content = `SECRET STRIPE_API_KEY
SECRET DATABASE_URL
SECRET AWS_ACCESS_KEY_ID
SECRET AWS_SECRET_ACCESS_KEY`;

    const result = parseSandboxfile(content);

    expect(result.secrets).toEqual(["STRIPE_API_KEY", "DATABASE_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
  });

  test("handle Windows line endings", () => {
    const content = "FROM host\r\nWORKDIR .\r\nRUN npm install\r\n";

    const result = parseSandboxfile(content);

    expect(result.from).toBe("host");
    expect(result.workdir).toBe(".");
    expect(result.runCommands).toEqual(["npm install"]);
  });

  test("parse DEV without name", () => {
    const content = `DEV PORT=3000 npm run dev`;

    const result = parseSandboxfile(content);

    expect(result.dev).toBeDefined();
    expect(result.dev!.name).toBeUndefined();
    expect(result.dev!.port).toBe(3000);
    expect(result.dev!.command).toBe("npm run dev");
  });

  test("parse minimal sandboxfile", () => {
    const content = `FROM host`;

    const result = parseSandboxfile(content);

    expect(result.from).toBe("host");
    expect(result.workdir).toBeUndefined();
    expect(result.runCommands).toEqual([]);
    expect(result.services).toEqual([]);
    expect(result.tests).toEqual([]);
    expect(result.outputs).toEqual([]);
  });

  test("parse docker image as FROM", () => {
    const content = `FROM node:20-alpine
WORKDIR /app
RUN npm install`;

    const result = parseSandboxfile(content);

    expect(result.from).toBe("node:20-alpine");
    expect(result.workdir).toBe("/app");
  });
});

describe("SandboxRunner", () => {
  test("create runner from string", () => {
    const content = `FROM host
WORKDIR .
RUN echo hello
TEST echo test`;

    const runner = SandboxRunner.fromString(content);
    const config = runner.getConfig();

    expect(config.from).toBe("host");
    expect(config.runCommands).toEqual(["echo hello"]);
    expect(config.tests).toHaveLength(1);
  });

  test("network rules - allow specific hosts", () => {
    const content = `FROM host
NET registry.npmjs.org
NET *.github.com`;

    const runner = SandboxRunner.fromString(content);

    expect(runner.isNetworkAllowed("registry.npmjs.org")).toBe(true);
    expect(runner.isNetworkAllowed("api.github.com")).toBe(true);
    expect(runner.isNetworkAllowed("raw.github.com")).toBe(true);
    expect(runner.isNetworkAllowed("evil.com")).toBe(false);
    expect(runner.isNetworkAllowed("npmjs.org")).toBe(false);
  });

  test("network rules - deny all when no NET rules", () => {
    const content = `FROM host`;

    const runner = SandboxRunner.fromString(content);

    expect(runner.isNetworkAllowed("registry.npmjs.org")).toBe(false);
    expect(runner.isNetworkAllowed("google.com")).toBe(false);
  });

  test("network rules - allow all with wildcard", () => {
    const content = `FROM host
NET *`;

    const runner = SandboxRunner.fromString(content);

    expect(runner.isNetworkAllowed("anything.com")).toBe(true);
    expect(runner.isNetworkAllowed("evil.example.org")).toBe(true);
  });

  test("run setup commands", async () => {
    using dir = tempDir("sandbox-test", {
      Sandboxfile: `FROM host
RUN echo "setup complete" > setup.txt`,
    });

    const runner = await SandboxRunner.fromFile(`${dir}/Sandboxfile`, {
      cwd: String(dir),
      verbose: false,
    });

    const success = await runner.runSetup();
    expect(success).toBe(true);

    const setupFile = Bun.file(`${dir}/setup.txt`);
    expect(await setupFile.exists()).toBe(true);
    expect((await setupFile.text()).trim()).toBe("setup complete");
  });

  test("run tests and report results", async () => {
    using dir = tempDir("sandbox-test", {
      Sandboxfile: `FROM host
TEST echo "test passed"`,
    });

    const runner = await SandboxRunner.fromFile(`${dir}/Sandboxfile`, {
      cwd: String(dir),
      verbose: false,
    });

    const passed = await runner.runTests();
    expect(passed).toBe(true);
  });

  test("detect failing tests", async () => {
    using dir = tempDir("sandbox-test", {
      Sandboxfile: `FROM host
TEST exit 1`,
    });

    const runner = await SandboxRunner.fromFile(`${dir}/Sandboxfile`, {
      cwd: String(dir),
      verbose: false,
    });

    const passed = await runner.runTests();
    expect(passed).toBe(false);
  });

  test("dry run does not execute commands", async () => {
    using dir = tempDir("sandbox-test", {
      Sandboxfile: `FROM host
RUN touch should-not-exist.txt`,
    });

    const runner = await SandboxRunner.fromFile(`${dir}/Sandboxfile`, {
      cwd: String(dir),
      dryRun: true,
    });

    const success = await runner.runSetup();
    expect(success).toBe(true);

    const file = Bun.file(`${dir}/should-not-exist.txt`);
    expect(await file.exists()).toBe(false);
  });

  test("collect output files", async () => {
    using dir = tempDir("sandbox-test", {
      Sandboxfile: `FROM host
OUTPUT *.txt`,
      "file1.txt": "content1",
      "file2.txt": "content2",
      "file3.js": "ignored",
    });

    const outputDir = `${dir}/collected`;
    await Bun.$`mkdir -p ${outputDir}`.quiet();

    const runner = await SandboxRunner.fromFile(`${dir}/Sandboxfile`, {
      cwd: String(dir),
    });

    const collected = await runner.collectOutputs(outputDir);

    expect(collected).toContain("file1.txt");
    expect(collected).toContain("file2.txt");
    expect(collected).not.toContain("file3.js");

    expect(await Bun.file(`${outputDir}/file1.txt`).text()).toBe("content1");
    expect(await Bun.file(`${outputDir}/file2.txt`).text()).toBe("content2");
  });

  test("full sandbox run with setup and tests", async () => {
    using dir = tempDir("sandbox-test", {
      Sandboxfile: `FROM host
WORKDIR .
RUN echo "setup" > setup.log
TEST echo "test1"
TEST echo "test2"`,
    });

    const runner = await SandboxRunner.fromFile(`${dir}/Sandboxfile`, {
      cwd: String(dir),
      verbose: false,
    });

    const result = await runner.run();

    expect(result.success).toBe(true);
    expect(result.testsPassed).toBe(true);

    const setupLog = Bun.file(`${dir}/setup.log`);
    expect(await setupLog.exists()).toBe(true);
  });
});

describe("Sandboxfile CLI", () => {
  const cliPath = `${import.meta.dir}/../../../../packages/bun-sandbox/src/cli.ts`;

  test("validate command succeeds for valid file", async () => {
    using dir = tempDir("sandbox-cli-test", {
      Sandboxfile: `FROM host
WORKDIR .
RUN echo hello`,
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), cliPath, "validate", "-f", "Sandboxfile"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toContain("Sandboxfile is valid");
    expect(exitCode).toBe(0);
  });

  test("init command creates Sandboxfile", async () => {
    using dir = tempDir("sandbox-cli-test", {});

    const proc = Bun.spawn({
      cmd: [bunExe(), cliPath, "init"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toContain("Created Sandboxfile");
    expect(exitCode).toBe(0);

    const sandboxfile = Bun.file(`${dir}/Sandboxfile`);
    expect(await sandboxfile.exists()).toBe(true);
    const content = await sandboxfile.text();
    expect(content).toContain("FROM host");
    expect(content).toContain("DEV PORT=3000");
  });

  test("help command shows usage", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), cliPath, "--help"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("bun sandbox");
    expect(exitCode).toBe(0);
  });

  test("test command runs and passes", async () => {
    using dir = tempDir("sandbox-cli-test", {
      Sandboxfile: `FROM host
TEST echo "hello world"`,
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), cliPath, "test", "-f", "Sandboxfile"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toContain("All tests passed");
    expect(exitCode).toBe(0);
  });

  test("test command fails on failing test", async () => {
    using dir = tempDir("sandbox-cli-test", {
      Sandboxfile: `FROM host
TEST exit 1`,
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), cliPath, "test", "-f", "Sandboxfile"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // "Tests failed" appears in stderr
    expect(stderr).toContain("Tests failed");
    expect(exitCode).toBe(1);
  });
});
