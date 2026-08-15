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

// The config loaders split user:password@ off a registry URL, but a token
// written as a path segment stays part of it, and these messages echo that
// URL (or the manifest / tarball URL built from it) when no request can be
// made out of it. None of the cases below sends a request.
describe.concurrent("bun install masks the configured registry URL in the messages that echo it", () => {
  const token = "npm_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8";
  const packageJson = (deps: Record<string, Record<string, string>>) => JSON.stringify({ name: "app", ...deps });

  const cases: {
    title: string;
    registry: string;
    files: Record<string, string>;
    expected: string;
    exitCode: number;
  }[] = [
    {
      title: "registry URL that is not a valid base URL (dependency)",
      registry: `http://ex ample.org/${token}/`,
      files: { "package.json": packageJson({ dependencies: { notapackage: "1.0.0" } }) },
      expected: `error: Failed to join registry "http://ex ample.org/***/" and package "notapackage" URLs\n`,
      exitCode: 1,
    },
    {
      title: "registry URL that is not a valid base URL (optional dependency)",
      registry: `http://ex ample.org/${token}/`,
      files: { "package.json": packageJson({ optionalDependencies: { notapackage: "1.0.0" } }) },
      expected: `warn: Failed to join registry "http://ex ample.org/***/" and package "notapackage" URLs\n`,
      exitCode: 0,
    },
    // The alias makes ".." the name the manifest is requested for. It joins to
    // the registry's parent directory, so the manifest URL no longer contains
    // the token segment; the registry URL printed next to it does.
    {
      title: "manifest URL outside the registry directory (dependency)",
      registry: `http://127.0.0.1:1/${token}/`,
      files: { "package.json": packageJson({ dependencies: { innocent: "npm:..@1.0.0" } }) },
      expected: `error: Invalid package name "..": manifest URL "http://127.0.0.1:1/" is not on registry "http://127.0.0.1:1/***/"\n`,
      exitCode: 1,
    },
    {
      title: "manifest URL outside the registry directory (optional dependency)",
      registry: `http://127.0.0.1:1/${token}/`,
      files: { "package.json": packageJson({ optionalDependencies: { innocent: "npm:..@1.0.0" } }) },
      expected: `warn: Invalid package name "..": manifest URL "http://127.0.0.1:1/" is not on registry "http://127.0.0.1:1/***/"\n`,
      exitCode: 0,
    },
    {
      title: "registry URL with a non-http scheme (dependency)",
      registry: `htp://127.0.0.1:1/${token}/`,
      files: { "package.json": packageJson({ dependencies: { notapackage: "1.0.0" } }) },
      expected: `error: Registry URL must be http:// or https://\nReceived: "htp://127.0.0.1:1/***/notapackage"\n`,
      exitCode: 1,
    },
    {
      title: "registry URL with a non-http scheme (optional dependency)",
      registry: `htp://127.0.0.1:1/${token}/`,
      files: { "package.json": packageJson({ optionalDependencies: { notapackage: "1.0.0" } }) },
      expected: `warn: Registry URL must be http:// or https://\nReceived: "htp://127.0.0.1:1/***/notapackage"\n`,
      exitCode: 0,
    },
    {
      title: "tarball URL built from a registry URL with a non-http scheme",
      registry: `htp://127.0.0.1:1/${token}/`,
      files: {
        "package.json": packageJson({ dependencies: { pkg: "1.0.0" } }),
        // An empty URL in bun.lock stands for the configured registry's
        // default tarball location, so no manifest is fetched first.
        "bun.lock": JSON.stringify({
          lockfileVersion: 1,
          workspaces: { "": { name: "app", dependencies: { pkg: "1.0.0" } } },
          packages: { pkg: ["pkg@1.0.0", "", {}, ""] },
        }),
      },
      expected: `error: Expected tarball URL to start with https:// or http://, got "htp://127.0.0.1:1/***/pkg/-/pkg-1.0.0.tgz" while fetching package "pkg"\n`,
      exitCode: 1,
    },
  ];

  for (const { title, registry, files, expected, exitCode } of cases) {
    test(title, async () => {
      using dir = tempDir("redacted-registry-token", {
        ...files,
        "bunfig.toml": `[install]\nregistry = ${JSON.stringify(registry)}\n`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [out, err, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(err).toContain(expected);
      expect(err).not.toContain(token);
      expect(out).not.toContain(token);
      expect(exited).toBe(exitCode);
    });
  }
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
