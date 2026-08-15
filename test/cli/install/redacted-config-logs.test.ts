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

// Covers the URL bun reports when a manifest or tarball request fails: the
// manifest URL (after redirects) and the manifest's dist.tarball. Those come
// from the registry, so a password or token in them is not something the user
// wrote down themselves. The registry URL bun is configured with below carries
// no secret; the secrets only enter through the redirect and dist.tarball.
describe.concurrent("bun install masks secrets in the registry-supplied URL it prints after a failed download", () => {
  const password = "s3cret";
  const token = "npm_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8";

  function startRegistry() {
    return Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        const secretOrigin = `http://carol:${password}@${url.host}`;
        switch (url.pathname) {
          case "/redirected-pkg":
            return Response.redirect(`${secretOrigin}/private/redirected-pkg?token=${token}`, 302);
          case "/tarball-pkg":
            return Response.json({
              name: "tarball-pkg",
              "dist-tags": { latest: "1.0.0" },
              versions: {
                "1.0.0": {
                  name: "tarball-pkg",
                  version: "1.0.0",
                  dist: { tarball: `${secretOrigin}/cdn/tarball-pkg-1.0.0.tgz?token=${token}` },
                },
              },
            });
          default:
            // Every other request, in particular the redirect target and the tarball, fails.
            return new Response("not found", { status: 404 });
        }
      },
    });
  }

  type Registry = ReturnType<typeof startRegistry>;

  async function install(server: Registry, args: string[], files: Record<string, string>) {
    using dir = tempDir("redacted-install-url", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--registry", `http://${server.hostname}:${server.port}/`, ...args],
      cwd: String(dir),
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(out).not.toContain(password);
    expect(out).not.toContain(token);
    expect(err).not.toContain(password);
    expect(err).not.toContain(token);
    return { err, exitCode };
  }

  const masked = (server: Registry) => `http://carol:******@${server.hostname}:${server.port}`;

  test("manifest request redirected to a URL with secrets (required dependency)", async () => {
    await using server = startRegistry();
    const { err, exitCode } = await install(server, [], {
      "package.json": JSON.stringify({ name: "app", dependencies: { "redirected-pkg": "1.0.0" } }),
    });
    expect(err).toContain(`error: GET ${masked(server)}/private/redirected-pkg?token=*** - 404`);
    expect(exitCode).toBe(1);
  });

  test("manifest request redirected to a URL with secrets (optional dependency)", async () => {
    await using server = startRegistry();
    const { err, exitCode } = await install(server, [], {
      "package.json": JSON.stringify({ name: "app", optionalDependencies: { "redirected-pkg": "1.0.0" } }),
    });
    expect(err).toContain(`warn: GET ${masked(server)}/private/redirected-pkg?token=*** - 404`);
    expect(exitCode).toBe(0);
  });

  test("dist.tarball URL with secrets (required dependency)", async () => {
    await using server = startRegistry();
    const { err, exitCode } = await install(server, [], {
      "package.json": JSON.stringify({ name: "app", dependencies: { "tarball-pkg": "1.0.0" } }),
    });
    expect(err).toContain(`error: GET ${masked(server)}/cdn/tarball-pkg-1.0.0.tgz?token=*** - 404`);
    expect(exitCode).toBe(1);
  });

  test("dist.tarball URL with secrets (optional dependency)", async () => {
    await using server = startRegistry();
    const { err, exitCode } = await install(server, [], {
      "package.json": JSON.stringify({ name: "app", optionalDependencies: { "tarball-pkg": "1.0.0" } }),
    });
    expect(err).toContain(`warn: GET ${masked(server)}/cdn/tarball-pkg-1.0.0.tgz?token=*** - 404`);
    expect(exitCode).toBe(0);
  });

  test("dist.tarball URL recorded in the lockfile, downloaded by the isolated linker", async () => {
    await using server = startRegistry();
    // What a previous install writes to bun.lock for an npm package whose
    // dist.tarball is not the registry's default tarball location.
    const tarball = `http://carol:${password}@${server.hostname}:${server.port}/cdn/tarball-pkg-1.0.0.tgz?token=${token}`;
    const { err, exitCode } = await install(server, ["--linker", "isolated"], {
      "package.json": JSON.stringify({ name: "app", dependencies: { "tarball-pkg": "1.0.0" } }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "app", dependencies: { "tarball-pkg": "1.0.0" } } },
        packages: { "tarball-pkg": ["tarball-pkg@1.0.0", tarball, {}, ""] },
      }),
    });
    expect(err).toContain(
      `error: failed to download tarball-pkg@1.0.0: 404 Not Found\n  ${masked(server)}/cdn/tarball-pkg-1.0.0.tgz?token=***`,
    );
    expect(exitCode).toBe(1);
  });

  // A tarball URL written directly into package.json is printed as the
  // dependency's resolution by other lines ("<name>@<url> failed to resolve",
  // and the "failed to download <name>@<url>" prefix of the isolated linker
  // message checked above), and those still print it verbatim.
  test.todo("tarball URL written in package.json is masked wherever it is echoed", async () => {
    await using server = startRegistry();
    const spec = `http://carol:${password}@${server.hostname}:${server.port}/cdn/direct-1.0.0.tgz?token=${token}`;
    for (const linker of ["hoisted", "isolated"]) {
      const { err, exitCode } = await install(server, ["--linker", linker], {
        "package.json": JSON.stringify({ name: "app", dependencies: { direct: spec } }),
      });
      expect(err).toContain(`error: GET ${masked(server)}/cdn/direct-1.0.0.tgz?token=*** - 404`);
      expect(exitCode).toBe(1);
    }
  });
});
