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

// A dependency declared as a tarball or git URL keeps that URL as its
// resolution, and bun prints the resolution (or the specifier it was declared
// with) in the install summary, in error messages and in the listing commands.
// Any credential in the URL has to be masked at each of those places.
describe.concurrent("tarball and git URLs declared in package.json are masked wherever bun echoes them", () => {
  const password = "s3cret";
  const token = "npm_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8";

  async function startTarballServer() {
    const tarball = await new Bun.Archive(
      {
        "package/package.json": JSON.stringify({
          name: "direct",
          version: "1.0.0",
          license: "MIT",
          scripts: { postinstall: "echo postinstall" },
        }),
      },
      { compress: "gzip" },
    ).bytes();
    return Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/cdn/direct-1.0.0.tgz") return new Response(tarball);
        return new Response("not found", { status: 404 });
      },
    });
  }

  // Every download attempt is met with an immediately closed connection, so
  // the tarball can never be fetched and bun reports the failure by name.
  function startClosingServer() {
    return Bun.listen({
      hostname: "localhost",
      port: 0,
      socket: {
        open(socket) {
          socket.end();
        },
        data() {},
      },
    });
  }

  type Host = { hostname: string; port: number };
  const spec = ({ hostname, port }: Host, query = `?token=${token}`) =>
    `http://carol:${password}@${hostname}:${port}/cdn/direct-1.0.0.tgz${query}`;
  const masked = ({ hostname, port }: Host, query = "?token=***") =>
    `http://carol:******@${hostname}:${port}/cdn/direct-1.0.0.tgz${query}`;

  const packageJson = (dependency: string) => JSON.stringify({ name: "app", dependencies: { direct: dependency } });
  // What a previous install of `packageJson(dependency)` writes to bun.lock.
  const bunLock = (dependency: string) =>
    JSON.stringify({
      lockfileVersion: 1,
      workspaces: { "": { name: "app", dependencies: { direct: dependency } } },
      packages: { direct: [`direct@${dependency}`, {}, ""] },
    });

  // None of these installs has anything to ask a registry for; pointing the
  // registry at the test's own server keeps a stray request off the network.
  async function run(cwd: string, { hostname, port }: Host, args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: {
        ...bunEnv,
        npm_config_registry: `http://${hostname}:${port}/`,
        BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, exitCode };
  }

  function expectNoSecrets(...texts: string[]) {
    for (const text of texts) {
      expect(text).not.toContain(password);
      expect(text).not.toContain(token);
    }
  }

  test("install summary, then bun pm untrusted and bun pm licenses", async () => {
    await using server = await startTarballServer();
    const url = masked(server);
    using dir = tempDir("redacted-resolution-install", { "package.json": packageJson(spec(server)) });

    const install = await run(String(dir), server, ["install"]);
    expect(install.out).toContain(`\n+ direct@${url}\n`);
    expectNoSecrets(install.out, install.err);
    expect(install.exitCode).toBe(0);

    // The tarball's postinstall was blocked, so `bun pm untrusted` lists the
    // package along with its resolution.
    const untrusted = await run(String(dir), server, ["pm", "untrusted"]);
    expect(untrusted.out).toContain(`direct @${url}\n`);
    expectNoSecrets(untrusted.out, untrusted.err);
    expect(untrusted.exitCode).toBe(0);

    const licenses = await run(String(dir), server, ["pm", "licenses"]);
    expect(licenses.out).toContain(`direct@${url}\n`);
    expectNoSecrets(licenses.out, licenses.err);
    expect(licenses.exitCode).toBe(0);

    const licensesJson = await run(String(dir), server, ["pm", "licenses", "--json"]);
    expect(JSON.parse(licensesJson.out)).toEqual({
      MIT: [expect.objectContaining({ name: "direct", versions: [url] })],
    });
    expectNoSecrets(licensesJson.out, licensesJson.err);
    expect(licensesJson.exitCode).toBe(0);
  });

  test("bun add <url>", async () => {
    await using server = await startTarballServer();
    using dir = tempDir("redacted-resolution-add", { "package.json": JSON.stringify({ name: "app" }) });

    // No query string here: `bun add <url>` names its extraction directory
    // after the URL's basename, and a `?` in a directory name is rejected on
    // Windows, so a query string makes the add itself fail there.
    const { out, err, exitCode } = await run(String(dir), server, ["add", spec(server, "")]);
    expect(out).toContain(`installed direct@${masked(server, "")}\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(0);
  });

  test("bun install --dry-run", async () => {
    await using server = await startTarballServer();
    using dir = tempDir("redacted-resolution-dry-run", { "package.json": packageJson(spec(server)) });

    const { out, err, exitCode } = await run(String(dir), server, ["install", "--dry-run"]);
    expect(out).toContain(` direct@${masked(server)}\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(0);
  });

  test("bun pm ls and bun why read the resolution back out of bun.lock", async () => {
    await using server = await startTarballServer();
    const url = masked(server);
    using dir = tempDir("redacted-resolution-ls", {
      "package.json": packageJson(spec(server)),
      "bun.lock": bunLock(spec(server)),
    });

    const ls = await run(String(dir), server, ["pm", "ls"]);
    expect(ls.out).toContain(`└── direct@${url}\n`);
    expectNoSecrets(ls.out, ls.err);
    expect(ls.exitCode).toBe(0);

    const why = await run(String(dir), server, ["why", "direct"]);
    expect(why.out).toContain(`direct@${url}\n`);
    expect(why.out).toContain(`app (requires ${url})\n`);
    expectNoSecrets(why.out, why.err);
    expect(why.exitCode).toBe(0);
  });

  test("an npm version whose pre-release tag looks like a UUID is printed unchanged", async () => {
    await using server = await startTarballServer();
    const stamped = "1.0.0-a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    using dir = tempDir("redacted-resolution-versions", {
      "package.json": JSON.stringify({ name: "app", dependencies: { direct: spec(server), stamped } }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "app", dependencies: { direct: spec(server), stamped } } },
        packages: {
          direct: [`direct@${spec(server)}`, {}, ""],
          stamped: [`stamped@${stamped}`, "", {}, ""],
        },
      }),
    });

    const { out, err, exitCode } = await run(String(dir), server, ["pm", "ls"]);
    expect(out).toContain(`direct@${masked(server)}\n`);
    expect(out).toContain(`stamped@${stamped}\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(0);
  });

  test("download failure: retry warnings, the final error and the unresolved dependency", async () => {
    using server = startClosingServer();
    const url = masked(server);
    using dir = tempDir("redacted-resolution-download-failure", { "package.json": packageJson(spec(server)) });

    const { out, err, exitCode } = await run(String(dir), server, ["install", "--verbose"]);
    expect(err).toContain(` downloading tarball direct@${url}. Retrying 1/`);
    expect(err).toContain(` downloading tarball direct@${url}\n`);
    expect(err).toContain(`error: direct@${url} failed to resolve\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  test("download failure with the isolated linker and an existing bun.lock", async () => {
    using server = startClosingServer();
    using dir = tempDir("redacted-resolution-isolated-download-failure", {
      "package.json": packageJson(spec(server)),
      "bun.lock": bunLock(spec(server)),
    });

    const { err, exitCode } = await run(String(dir), server, ["install", "--linker", "isolated"]);
    // Only the resolution in the message is asserted: the request URL bun
    // prints on the following line is a separate operand of this message.
    expect(err).toContain(`error: failed to download direct@${masked(server)}: `);
    expect(exitCode).toBe(1);
  });

  test("git URL specifier", async () => {
    // The clone fails at once (the connection is closed before TLS starts);
    // what is being tested is how the specifier is echoed afterwards.
    using server = startClosingServer();
    using dir = tempDir("redacted-resolution-git", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { repo: `git+https://carol:${password}@${server.hostname}:${server.port}/org/repo.git` },
      }),
    });

    const { out, err, exitCode } = await run(String(dir), server, ["install"]);
    expect(err).toContain(
      `error: repo@git+https://carol:******@${server.hostname}:${server.port}/org/repo.git failed to resolve\n`,
    );
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });
});
