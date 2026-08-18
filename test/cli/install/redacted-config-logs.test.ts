import { write } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

test("registry url password is sent as Basic auth and left out of request error output", async () => {
  const authorizations: (string | null)[] = [];
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      authorizations.push(req.headers.get("authorization"));
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    },
  });

  using dir = tempDir("redacted-registry-url", {
    "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "view", "is-number"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      NO_COLOR: "1",
      npm_config_registry: `http://user:secretpass@${server.hostname}:${server.port}/`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(authorizations).toEqual([`Basic ${Buffer.from("user:secretpass").toString("base64")}`]);
  expect(err).toContain(`401 Unauthorized: http://${server.hostname}:${server.port}/is-number`);
  expect(err).not.toContain("secretpass");
  expect(out).not.toContain("secretpass");
  expect(exitCode).toBe(1);
});

test("url password is masked in the verbose request line", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `await fetch("http://user:secretpass@${server.hostname}:${server.port}/pkg")`],
    env: { ...bunEnv, NO_COLOR: "1", BUN_CONFIG_VERBOSE_FETCH: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(err).toContain(`GET http://user:**********@${server.hostname}:${server.port}/pkg`);
  expect(err).not.toContain("secretpass");
  expect(out).not.toContain("secretpass");
  expect(exitCode).toBe(0);
});

test("registry port is not mistaken for a credential when the package is scoped", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  });

  using dir = tempDir("redacted-registry-scoped-port", {
    "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "view", "@scope/pkg"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      NO_COLOR: "1",
      npm_config_registry: `http://${server.hostname}:${server.port}/`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(err).toContain(`http://${server.hostname}:${server.port}/`);
  expect(err).not.toContain("*");
  expect(out).not.toContain("*");
  expect(exitCode).toBe(1);
});

test("bunfig password value is masked in config error output", async () => {
  using dir = tempDir("redacted-bunfig-password", {
    "bunfig.toml": `l;password = "supersecretvalue"`,
    "package.json": "{}",
  });

  await using plain = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [plainOut, plainErr, plainExit] = await Promise.all([plain.stdout.text(), plain.stderr.text(), plain.exited]);

  expect(plainOut).not.toContain("supersecretvalue");
  expect(plainErr).not.toContain("supersecretvalue");
  expect(plainErr).toContain(`l;password = "****************"`);

  await using colored = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [coloredOut, coloredErr, coloredExit] = await Promise.all([
    colored.stdout.text(),
    colored.stderr.text(),
    colored.exited,
  ]);

  expect(coloredOut).not.toContain("supersecretvalue");
  expect(coloredErr).not.toContain("supersecretvalue");
  expect(coloredErr).toContain("****************");

  expect(plainExit).toBe(1);
  expect(coloredExit).toBe(1);
});

describe.concurrent("redact", async () => {
  const tests = [
    {
      title: "url password",
      bunfig: `install.registry = "https://user:pass@registry.org`,
      expected: `"https://user:****@registry.org`,
    },
    {
      title: "empty url password",
      bunfig: `install.registry = "https://user:@registry.org`,
      expected: `"https://user:@registry.org`,
    },
    {
      title: "small string",
      bunfig: `l;token = "1"`,
      expected: `"*"`,
    },
    {
      title: "registry password",
      bunfig: `l;password = "hunter2"`,
      expected: `"*******"`,
    },
    {
      title: "random UUID",
      bunfig: 'unre;lated = "f1b0b6b4-4b1b-4b1b-8b1b-4b1b4b1b4b1b"',
      expected: '"************************************"',
    },
    {
      title: "random npm_ secret",
      bunfig: 'the;secret = "npm_1234567890abcdefghijklmnopqrstuvwxyz"',
      expected: '"****************************************"',
    },
    {
      title: "random npms_ secret",
      bunfig: 'the;secret = "npms_1234567890abcdefghijklmnopqrstuvwxyz"',
      expected: "*****************************************",
    },
    {
      title: "zero length unterminated string",
      bunfig: '_authToken = "',
      expected: "*",
    },
    {
      title: "invalid _auth",
      npmrc: "//registry.npmjs.org/:_auth = does-not-decode",
      expected: "****************",
    },
    {
      title: "unexpected _auth",
      npmrc: "//registry.npmjs.org/:_auth=:secret",
      expected: "*******",
    },
    {
      title: "_auth zero length",
      npmrc: "//registry.npmjs.org/:_auth=",
      expected: "received an empty string",
    },
    {
      title: "_auth one length",
      npmrc: "//registry.npmjs.org/:_auth=1",
      expected: "*",
    },
  ];

  for (const { title, bunfig, npmrc, expected } of tests) {
    test(title + (bunfig ? " (bunfig)" : " (npmrc)"), async () => {
      const testDir = tmpdirSync();
      await Promise.all([
        write(join(testDir, bunfig ? "bunfig.toml" : ".npmrc"), (bunfig || npmrc)!),
        write(join(testDir, "package.json"), "{}"),
      ]);

      // once without color
      await using proc1 = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: testDir,
        env: { ...bunEnv, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [out1, err1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

      expect(exitCode1).toBe(+!!bunfig);
      expect(err1).toContain(expected || "*");

      // once with color
      await using proc2 = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: testDir,
        env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [out2, err2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

      expect(exitCode2).toBe(+!!bunfig);
      expect(err2).toContain(expected || "*");
    });
  }
});
