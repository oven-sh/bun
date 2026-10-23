import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--no-env-file disables .env loading", async () => {
  using dir = tempDir("no-env-file", {
    ".env": "FOO=bar",
    "index.js": "console.log(process.env.FOO);",
  });

  // Without --no-env-file, .env should be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("bar");
    expect(exitCode).toBe(0);
  }

  // With --no-env-file, .env should NOT be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  }
});

test("--no-env-file disables .env.local loading", async () => {
  using dir = tempDir("no-env-file-local", {
    ".env": "FOO=bar",
    ".env.local": "FOO=local",
    "index.js": "console.log(process.env.FOO);",
  });

  // Without --no-env-file, .env.local should override .env
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("local");
    expect(exitCode).toBe(0);
  }

  // With --no-env-file, neither should be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  }
});

test("--no-env-file disables .env.development.local loading", async () => {
  using dir = tempDir("no-env-file-dev-local", {
    ".env": "FOO=bar",
    ".env.development.local": "FOO=dev-local",
    "index.js": "console.log(process.env.FOO);",
  });

  // Without --no-env-file, .env.development.local should be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("dev-local");
    expect(exitCode).toBe(0);
  }

  // With --no-env-file, it should NOT be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  }
});

test("bunfig env.file = false disables .env loading", async () => {
  using dir = tempDir("bunfig-env-file-false", {
    ".env": "FOO=bar",
    "bunfig.toml": `
[env]
file = false
`,
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("bunfig env = false disables .env loading", async () => {
  using dir = tempDir("bunfig-env-false", {
    ".env": "FOO=bar",
    "bunfig.toml": `
env = false
`,
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("--no-env-file with -e flag", async () => {
  using dir = tempDir("no-env-file-eval", {
    ".env": "FOO=bar",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-env-file", "-e", "console.log(process.env.FOO)"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("--no-env-file combined with --env-file still loads explicit file", async () => {
  using dir = tempDir("no-env-file-with-env-file", {
    ".env": "FOO=bar",
    ".env.custom": "FOO=custom",
    "index.js": "console.log(process.env.FOO);",
  });

  // --no-env-file should skip .env but --env-file should load .env.custom
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-env-file", "--env-file", ".env.custom", "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("custom");
  expect(exitCode).toBe(0);
});

test("bunfig env = true still loads .env files", async () => {
  using dir = tempDir("bunfig-env-true", {
    ".env": "FOO=bar",
    "bunfig.toml": `
env = true
`,
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("bar");
  expect(exitCode).toBe(0);
});

test("--no-env-file in production mode", async () => {
  using dir = tempDir("no-env-file-production", {
    ".env": "FOO=bar",
    ".env.production": "FOO=prod",
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-env-file", "index.js"],
    env: { ...bunEnv, NODE_ENV: "production" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

describe("what the process builds and starts later", () => {
  const env = { ...bunEnv, NODE_ENV: undefined, BUN_OPTIONS: undefined, API_KEY: undefined };
  const files = {
    ".env": "API_KEY=from-dot-env\n",
    "custom.env": "CUSTOM=from-custom-env\n",
    "client.ts": "console.log(process.env.API_KEY);\n",
    "worker.ts": "postMessage(String(process.env.API_KEY));\n",
    "inlined.ts": `
      export async function inlined() {
        const build = await Bun.build({ entrypoints: ["./client.ts"], env: "inline" });
        return /console\\.log\\((.*)\\);/.exec(await build.outputs[0].text())![1];
      }
    `,
    "main.ts": `
      import { inlined } from "./inlined.ts";

      const bundle = await inlined();
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      const fromWorker = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
      await worker.terminate();
      console.log(JSON.stringify({ bundle, worker: fromWorker }));
    `,
  };

  async function run(cwd: string, args: string[], argv0?: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], argv0, env, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  type Row = [label: string, args: string[], extra: string | undefined];

  test.concurrent.each<Row>([
    ["--no-env-file", ["--no-env-file", "main.ts"], undefined],
    ["bunfig env = false", ["run", "main.ts"], "env = false\n"],
  ])("%s: no value of .env in a Bun.build(), nor in a Worker started after it", async (_, args, bunfig) => {
    using dir = tempDir("no-env-file-later", bunfig ? { ...files, "bunfig.toml": bunfig } : files);
    const { stdout, exitCode } = await run(String(dir), args);
    expect(JSON.parse(stdout)).toEqual({ bundle: "process.env.API_KEY", worker: "undefined" });
    expect(exitCode).toBe(0);
  });

  test.concurrent.each<Row>([
    ["no switch", ["main.ts"], undefined],
    ["--env-file", ["--env-file=custom.env", "main.ts"], undefined],
    ["bun invoked as node", ["main.ts"], "node"],
  ])("%s: Bun.build() inlines the values of .env", async (_, args, argv0) => {
    using dir = tempDir("no-env-file-later", files);
    const { stdout, exitCode } = await run(String(dir), args, argv0);
    expect(JSON.parse(stdout).bundle).toBe('"from-dot-env"');
    expect(exitCode).toBe(0);
  });

  test.concurrent.each<Row>([
    ["--no-env-file", ["--no-env-file", "server.ts"], "process.env.API_KEY"],
    ["no switch", ["server.ts"], '"from-dot-env"'],
  ])("%s: an HTML route with [serve.static] env = 'inline'", async (_, args, expected) => {
    using dir = tempDir("no-env-file-html", {
      ".env": files[".env"],
      "bunfig.toml": '[serve.static]\nenv = "inline"\n',
      "client.ts": files["client.ts"],
      "index.html": '<!doctype html><script type="module" src="./client.ts"></script>\n',
      "server.ts": `
        import index from "./index.html";

        using server = Bun.serve({ port: 0, development: false, routes: { "/": index } });
        const html = await (await fetch(server.url)).text();
        const script = await (await fetch(new URL(/src="([^"]+)"/.exec(html)![1], server.url))).text();
        console.log(/console\\.log\\((.*?)\\)/.exec(script)![1]);
      `,
    });
    const { stdout, exitCode } = await run(String(dir), args);
    expect(stdout).toBe(expected + "\n");
    expect(exitCode).toBe(0);
  });

  // A worker of `bun test --parallel` reads no env file when it starts, with or without the switch.
  test.concurrent.each<Row>([
    ["--no-env-file", ["--no-env-file"], "process.env.API_KEY"],
    ["no switch", [], '"from-dot-env"'],
  ])("bun test --parallel, %s: a build in a directory with a .env of its own", async (_, flags, expected) => {
    const testFile = `
      import { test } from "bun:test";
      import { inlined } from "./inlined.ts";

      test("build", async () => {
        process.chdir(import.meta.dir + "/pkg");
        console.log("INLINED " + (await inlined()));
      });
    `;
    using dir = tempDir("no-env-file-parallel", {
      "pkg/.env": files[".env"],
      "pkg/client.ts": files["client.ts"],
      "inlined.ts": files["inlined.ts"],
      "a.test.ts": testFile,
      "b.test.ts": testFile,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["test", "--parallel=2", ...flags]);
    expect([...(stdout + stderr).matchAll(/^INLINED (.*)$/gm)].map(match => match[1])).toEqual([expected, expected]);
    expect(exitCode).toBe(0);
  });
});
