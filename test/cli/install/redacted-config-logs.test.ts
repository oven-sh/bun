import { iniInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, hostedGitRepository, isWindows, tempDir } from "harness";
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

  expect(err).toContain(`GET http://***@${server.hostname}:${server.port}/pkg`);
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
      expected: `error: invalid dependency name ".."\n`,
      exitCode: 1,
    },
    {
      title: "manifest URL outside the registry directory (optional dependency)",
      registry: `http://127.0.0.1:1/${token}/`,
      files: { "package.json": packageJson({ optionalDependencies: { innocent: "npm:..@1.0.0" } }) },
      expected: `warn: invalid dependency name ".."\n`,
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
        // An empty URL in bun.lock means the default tarball location of the configured registry, so no manifest is
        // fetched first.
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
      expected: `"https://*********@registry.org`,
    },
    {
      // A userinfo password that happens to start with a redacted keyword must not
      // arm value redaction for the rest of the line; the quoted-key scan runs only
      // on the fall-through path after the URL/UUID/npm-secret redactors.
      title: "url password starting with a redacted keyword",
      bunfig: `install.scopes.x = { url = "https://user:token123@registry.org/", username = "alice" };bad`,
      expected: `, username = `,
      secret: "token123",
    },
    {
      title: "empty url password",
      bunfig: `install.registry = "https://user:@registry.org`,
      expected: `"https://*****@registry.org`,
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
      // npm forwards these verbatim, so there is no diagnostic to redact: the
      // assertion is that neither an error nor the value reaches stderr.
      title: "invalid _auth",
      npmrc: "//registry.npmjs.org/:_auth = does-not-decode",
      expected: "",
      secret: "does-not-decode",
    },
    {
      title: "unexpected _auth",
      npmrc: "//registry.npmjs.org/:_auth=:secret",
      expected: "",
      secret: ":secret",
    },
    {
      title: "_auth zero length",
      npmrc: "//registry.npmjs.org/:_auth=",
      expected: "ignoring empty _auth value",
    },
    {
      // The unknown-option warning names the option but never echoes the line, so no
      // value can leak whatever the key's spelling: quoted, misspelt, or without the
      // underscore. These rows pin that the warning prints and the value does not.
      title: "quoted _authToken key",
      npmrc: '"//registry.npmjs.org/:_authtoken"=npm_notarealtokenvalue',
      expected: "ignoring unknown .npmrc option",
      secret: "npm_notarealtokenvalue",
    },
    {
      title: "quoted _auth key",
      npmrc: 'registry=https://registry.example.com/api/\n"//registry.example.com/:_auth_"=does-not-decode',
      expected: "ignoring unknown .npmrc option",
      secret: "does-not-decode",
    },
    {
      title: "quoted password key",
      npmrc: '"//registry.npmjs.org/:password"=SUPERSECRETVALUE',
      expected: "ignoring unknown .npmrc option",
      secret: "SUPERSECRETVALUE",
    },
    {
      title: "misspelt option without the underscore",
      npmrc: "//registry.npmjs.org/:authToken=npm_notarealtokenvalue",
      expected: "ignoring unknown .npmrc option",
      secret: "npm_notarealtokenvalue",
    },
    {
      title: "misspelt _authToken key",
      npmrc: "//registry.npmjs.org/:_authtoken=npm_notarealtokenvalue",
      expected: "ignoring unknown .npmrc option",
      secret: "npm_notarealtokenvalue",
    },
    // Lines that are not `//host/…:option=value` never reach the unknown-option
    // warning, since the word after the last colon could be the value itself.
    {
      title: "credential key without an equals sign",
      npmrc: "//registry.npmjs.org/:_authToken",
      expected: "",
      secret: "_authToken",
    },
    {
      title: "credential key with a colon instead of an equals sign",
      npmrc: "//registry.npmjs.org/:_authToken:npm_notarealtokenvalue",
      expected: "",
      secret: "npm_notarealtokenvalue",
    },
    {
      title: "bare host and port",
      npmrc: "//localhost:4873",
      expected: "",
      secret: "4873",
    },
    {
      title: "bare bracketed IPv6 host",
      npmrc: "//[::1]",
      expected: "",
      secret: "::1",
    },
    {
      // `:` typed for `=`: the parser splits at the base64 padding, so the credential
      // bytes sit where an option name would; the warning must not name them.
      title: "credential key with a colon and a padded base64 value",
      npmrc: "//registry.npmjs.org/:_auth:dXNlcjpwdw==",
      expected: "",
      secret: "dXNlcjpwdw",
    },
    {
      // The most common .npmrc authoring mistake, and the value is always a live secret.
      // npm decodes _password with Buffer.from(v, "base64"), which never throws — it
      // skips invalid bytes — so there is no diagnostic and nothing may reach stderr.
      title: "plaintext _password",
      npmrc: "//registry.npmjs.org/:username=alice\n//registry.npmjs.org/:_password=p@ssw0rd!",
      expected: "",
      secret: "p@ssw0rd!",
      forbidden: "is not valid base64",
    },
  ];

  for (const { title, bunfig, npmrc, expected, secret, forbidden } of tests) {
    test(title + (bunfig ? " (bunfig)" : " (npmrc)"), async () => {
      using dir = tempDir("redacted-config-logs", {
        [bunfig ? "bunfig.toml" : ".npmrc"]: (bunfig || npmrc)!,
        "package.json": "{}",
        "home/.gitkeep": "",
      });
      const testDir = String(dir);
      // An empty home, so the machine's own `.npmrc` cannot add a warning or an error.
      const home = join(testDir, "home");
      const isolated = {
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: home,
        NPM_CONFIG_USERCONFIG: undefined,
        npm_config_userconfig: undefined,
      };

      // once without color
      await using proc1 = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: testDir,
        env: { ...bunEnv, NO_COLOR: "1", ...isolated },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [out1, err1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

      expect(exitCode1).toBe(+!!bunfig);
      if (expected) expect(err1).toContain(expected);
      else expect(err1).not.toMatch(/\b(error|warn):/);
      if (secret) expect(err1).not.toContain(secret);
      if (forbidden) expect(err1).not.toContain(forbidden);

      // once with color
      await using proc2 = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: testDir,
        env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1", ...isolated },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [out2, err2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

      expect(exitCode2).toBe(+!!bunfig);
      if (expected) expect(err2).toContain(expected);
      else expect(err2).not.toMatch(/\b(error|warn):/);
      if (secret) expect(err2).not.toContain(secret);
      if (forbidden) expect(err2).not.toContain(forbidden);
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

  const masked = (server: Registry) => `http://***@${server.hostname}:${server.port}`;
  // A tarball request sends the URL's userinfo as an Authorization header, so its URL is echoed without it.
  const tarballHost = (server: Registry) => `http://${server.hostname}:${server.port}`;

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
    expect(err).toContain(`error: GET ${tarballHost(server)}/cdn/tarball-pkg-1.0.0.tgz?token=*** - 404`);
    expect(exitCode).toBe(1);
  });

  test("dist.tarball URL with secrets (optional dependency)", async () => {
    await using server = startRegistry();
    const { err, exitCode } = await install(server, [], {
      "package.json": JSON.stringify({ name: "app", optionalDependencies: { "tarball-pkg": "1.0.0" } }),
    });
    expect(err).toContain(`warn: GET ${tarballHost(server)}/cdn/tarball-pkg-1.0.0.tgz?token=*** - 404`);
    expect(exitCode).toBe(0);
  });

  test("dist.tarball URL recorded in the lockfile, downloaded by the isolated linker", async () => {
    await using server = startRegistry();
    // Returns what a previous install writes to bun.lock for an npm package whose dist.tarball isn't the registry's
    // default tarball location.
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
      `error: failed to download tarball-pkg@1.0.0: 404 Not Found\n  ${tarballHost(server)}/cdn/tarball-pkg-1.0.0.tgz?token=***`,
    );
    expect(exitCode).toBe(1);
  });

  // A tarball URL written directly into package.json is also printed as the
  // dependency's specifier ("<name>@<url> failed to resolve").
  test.each(["hoisted", "isolated"])("tarball URL written in package.json (%s)", async linker => {
    await using server = startRegistry();
    const spec = `http://carol:${password}@${server.hostname}:${server.port}/cdn/direct-1.0.0.tgz?token=${token}`;
    const { err, exitCode } = await install(server, ["--linker", linker], {
      "package.json": JSON.stringify({ name: "app", dependencies: { direct: spec } }),
    });
    expect(err).toContain(`error: GET ${tarballHost(server)}/cdn/direct-1.0.0.tgz?token=*** - 404\n`);
    expect(err).toContain(`error: direct@${masked(server)}/cdn/direct-1.0.0.tgz?token=*** failed to resolve\n`);
    expect(exitCode).toBe(1);
  });

  test("the Location header in the --verbose trace", async () => {
    await using server = startRegistry();
    const { err, exitCode } = await install(server, ["--verbose"], {
      "package.json": JSON.stringify({ name: "app", dependencies: { "redirected-pkg": "1.0.0" } }),
    });
    expect(err).toContain(`< Location: ${masked(server)}/private/redirected-pkg?token=***\n`);
    expect(exitCode).toBe(1);
  });
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
    `http://***@${hostname}:${port}/cdn/direct-1.0.0.tgz${query}`;

  const packageJson = (dependency: string) => JSON.stringify({ name: "app", dependencies: { direct: dependency } });
  // Returns what a previous install of `packageJson(dependency)` writes to bun.lock.
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
    // `bun pm ls` lists what is installed.
    expect((await run(String(dir), server, ["install", "--frozen-lockfile"])).exitCode).toBe(0);

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

    const { out, err, exitCode } = await run(String(dir), server, ["why", "*"]);
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
    // The clone fails immediately, because the connection is closed before TLS starts. The test is about how the
    // specifier is printed afterwards.
    using server = startClosingServer();
    using dir = tempDir("redacted-resolution-git", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { repo: `git+https://carol:${password}@${server.hostname}:${server.port}/org/repo.git` },
      }),
    });

    const { out, err, exitCode } = await run(String(dir), server, ["install"]);
    expect(err).toContain(
      `error: repo@git+https://***@${server.hostname}:${server.port}/org/repo.git failed to resolve\n`,
    );
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  const emptyProject = { "package.json": JSON.stringify({ name: "app" }) };
  // For the commands that stop before any request.
  const nowhere: Host = { hostname: "localhost", port: 1 };

  async function serveTarballOf(packageJson: string) {
    const tarball = await new Bun.Archive({ "package/package.json": packageJson }, { compress: "gzip" }).bytes();
    return Bun.serve({ port: 0, fetch: () => new Response(tarball) });
  }

  // `bun add <url>` has no name for the dependency until the package is read, so every message about it uses the URL
  // instead.
  test("bun add <git url> that cannot be cloned", async () => {
    using server = startClosingServer();
    using dir = tempDir("redacted-name-git", emptyProject);
    const url = (userinfo: string) => `git+https://${userinfo}@${server.hostname}:${server.port}/org/repo.git`;

    const { out, err, exitCode } = await run(String(dir), server, ["add", url(`carol:${password}`)]);
    expect(err).toContain(`error: "git clone" for "${url("***")}" failed\n`);
    expect(err).toContain(` cloning repository for ${url("***")}\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  test("bun add <url> of a file that is not a tarball", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("not a gzip stream") });
    using dir = tempDir("redacted-name-extract", emptyProject);

    const { out, err, exitCode } = await run(String(dir), server, ["add", spec(server, "")]);
    expect(err).toContain(` extracting tarball from ${masked(server, "")}\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  test("bun add <url> of a tarball whose package.json is not JSON", async () => {
    await using server = await serveTarballOf("{ not json");
    using dir = tempDir("redacted-name-package-json", emptyProject);

    const { out, err, exitCode } = await run(String(dir), server, ["add", spec(server, "")]);
    expect(err).toContain(`error: expected "package.json" of "${masked(server, "")}" to be a JSON file: `);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  test("bun add <url> of a host that refuses the download", async () => {
    using server = startClosingServer();
    using dir = tempDir("redacted-name-download", emptyProject);
    // No `.tgz` and no path: the URL is both the name and the resolution.
    const url = (userinfo: string) => `http://${userinfo}@${server.hostname}:${server.port}`;

    const { out, err, exitCode } = await run(String(dir), server, ["add", "--verbose", url(`carol:${password}`)]);
    expect(err).toContain(` downloading tarball ${url("***")}@${url("***")}. Retrying 1/`);
    expect(err).toContain(` downloading tarball ${url("***")}@${url("***")}\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  test("bun add --verbose <url>", async () => {
    await using server = await startTarballServer();
    using dir = tempDir("redacted-name-verbose", emptyProject);

    const { out, err, exitCode } = await run(String(dir), server, ["add", "--verbose", spec(server, "")]);
    expect(err).toContain(` Downloaded ${masked(server, "")} tarball\n`);
    // The string the lockfile's hash is made of.
    expect(out).toContain(`\ndirect@${masked(server, "")}\n-- END HASH--\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(0);
  });

  test("bun add --offline", async () => {
    using dir = tempDir("redacted-name-offline", emptyProject);
    const git = (userinfo: string) => `git+https://${userinfo}@localhost:1/org/repo.git`;

    const tarball = await run(String(dir), nowhere, ["add", "--offline", spec(nowhere, "")]);
    expect(tarball.err).toContain(`error: --offline: "${masked(nowhere, "")}" is not in the cache\n`);
    expectNoSecrets(tarball.out, tarball.err);
    expect(tarball.exitCode).toBe(1);

    const repo = await run(String(dir), nowhere, ["add", "--offline", git(`carol:${password}`)]);
    expect(repo.err).toContain(`error: --offline: git repository for "${git("***")}" is not in the cache\n`);
    expectNoSecrets(repo.out, repo.err);
    expect(repo.exitCode).toBe(1);
  });

  test("bun add of two URLs of one package", async () => {
    await using server = await startTarballServer();
    using dir = tempDir("redacted-both-resolve", emptyProject);

    const { out, err, exitCode } = await run(String(dir), server, ["add", spec(server, ""), spec(server, "?v=2")]);
    expect(err).toContain(`error: "${masked(server, "")}" and "${masked(server, "?v=2")}" both resolve to "direct"\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  // The URL does not start the argument in the first two forms.
  test.each([
    (userinfo: string) => `@https://${userinfo}@localhost:1/org/repo`,
    (userinfo: string) => `x@npm:y@https://${userinfo}@localhost:1/org/repo`,
    (userinfo: string) => `ftp://${userinfo}@localhost:1/org/repo`,
  ])("bun add of an argument that is not a dependency: %#", async argument => {
    using dir = tempDir("redacted-unrecognised", emptyProject);

    const { out, err, exitCode } = await run(String(dir), nowhere, ["add", argument(`carol:${password}`)]);
    expect(err).toContain(`error: unrecognised dependency format: ${argument("***")}\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  test.each([
    // The userinfo ends at the last `@` in front of the path.
    ["ftp://carol:s3@cret@localhost:1/org/repo", "ftp://***@localhost:1/org/repo"],
    ["ftp://ca%20rol:s3%20cret@localhost:1/org/repo", "ftp://***@localhost:1/org/repo"],
    // The URL ends at a space: what follows it is not its host.
    ["ftp://localhost:1 lib@1.0.0", "ftp://localhost:1 lib@1.0.0"],
    ["ftp://localhost failed for lib@1.0.0", "ftp://localhost failed for lib@1.0.0"],
    ["ftp://localhost: lib@1.0.0", "ftp://localhost: lib@1.0.0"],
  ])("where the userinfo of %s ends", async (argument, printed) => {
    using dir = tempDir("redacted-userinfo-end", emptyProject);

    const { err, exitCode } = await run(String(dir), nowhere, ["add", argument]);
    expect(err).toContain(`error: unrecognised dependency format: ${printed}\n`);
    expect(exitCode).toBe(1);
  });

  test.each<[string, string[], string]>([
    ["<url>", [spec(nowhere)], `error: "${masked(nowhere)}" is not in bun.lock\n    bun add ${masked(nowhere)}\n`],
    [
      "--latest <name>@<url>",
      ["--latest", `direct@${spec(nowhere)}`],
      `error: --latest cannot be combined with a version: direct@${masked(nowhere)}\n`,
    ],
    [
      "--dev <name>@<url>",
      ["--dev", `direct@${spec(nowhere)}`],
      `error: a version cannot be combined with --dev, --prod, --no-optional or --depth 0: direct@${masked(nowhere)}\n`,
    ],
    [
      "<pattern>@<url>",
      [`dir*@${spec(nowhere)}`],
      `error: a version cannot be combined with a pattern: dir*@${masked(nowhere)}\n`,
    ],
  ])("bun update %s", async (_, args, expected) => {
    using dir = tempDir("redacted-update-argument", emptyProject);

    const { out, err, exitCode } = await run(String(dir), nowhere, ["update", ...args]);
    expect(err).toBe(expected);
    expectNoSecrets(out);
    expect(exitCode).toBe(1);
  });

  test("bun patch <name>@<url> that is not installed", async () => {
    await using server = await startTarballServer();
    using dir = tempDir("redacted-patch-argument", { "package.json": packageJson(spec(server)) });
    expect((await run(String(dir), server, ["install"])).exitCode).toBe(0);

    const { out, err, exitCode } = await run(String(dir), server, ["patch", `direct@${spec(server, "?v=2")}`]);
    expect(err).toContain(`error: package direct@${masked(server, "?v=2")} not found\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  test("a URL as the name of a dependency", async () => {
    using dir = tempDir("redacted-name-in-package-json", {
      "package.json": JSON.stringify({ name: "app", dependencies: { [spec(nowhere)]: "1.0.0" } }),
    });

    const { out, err, exitCode } = await run(String(dir), nowhere, ["install"]);
    expect(err).toContain(`error: invalid dependency name "${masked(nowhere)}"\n`);
    expect(err).toContain(`error: ${masked(nowhere)}@1.0.0 failed to resolve\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  test("a catalog: specifier that holds a URL", async () => {
    const catalog = (userinfo: string) => `https://${userinfo}@localhost:1/x`;
    using dir = tempDir("redacted-catalog-name", {
      "package.json": JSON.stringify({
        name: "app",
        workspaces: ["packages/*"],
        dependencies: { x: `catalog:${catalog(`carol:${password}`)}` },
      }),
    });

    const { out, err, exitCode } = await run(String(dir), nowhere, ["install"]);
    expect(err).toContain(
      `error: x@catalog:${catalog("***")}: there is no catalog named "${catalog("***")}" in the root package.json\n`,
    );
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  // The package that declares a refused dependency is named by its resolution.
  test.each([
    ["file:./inner.tgz", "local tarballs are only allowed in this project's package.json files"],
    ["link:../../inner", "only the root package.json, a workspace, or a top-level override may link to a path"],
  ])("a dependency on %s declared by a tarball", async (inner, reason) => {
    await using server = await serveTarballOf(
      JSON.stringify({ name: "direct", version: "1.0.0", dependencies: { inner } }),
    );
    using dir = tempDir("redacted-declarer", { "package.json": packageJson(spec(server)) });

    const { out, err, exitCode } = await run(String(dir), server, ["install"]);
    expect(err).toContain(
      `error: refusing to resolve "inner@${inner}" declared by direct@${masked(server)}: ${reason}\n`,
    );
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });

  test("bun install --linker isolated --verbose", async () => {
    await using server = await startTarballServer();
    using dir = tempDir("redacted-resolution-isolated-verbose", { "package.json": packageJson(spec(server)) });

    const { out, err, exitCode } = await run(String(dir), server, ["install", "--linker", "isolated", "--verbose"]);
    expect(err).toContain(`Blocked 1 scripts for: direct@${masked(server)}\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(0);
  });

  test("bun add --catalog", async () => {
    await using server = await startTarballServer();
    using dir = tempDir("redacted-catalog-notes", {
      "package.json": JSON.stringify({
        name: "app",
        workspaces: { packages: ["packages/*"], catalog: { direct: spec(server, "?v=1") } },
        dependencies: { direct: "catalog:" },
      }),
      "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { direct: spec(server, "?v=3") } }),
    });

    const replaced = await run(String(dir), server, ["add", "--catalog", `direct@${spec(server, "?v=2")}`]);
    expect(replaced.err).toContain(
      `note: catalog entry direct changed from "${masked(server, "?v=1")}" to "${masked(server, "?v=2")}"\n`,
    );
    expectNoSecrets(replaced.out, replaced.err);
    expect(replaced.exitCode).toBe(0);

    const follows = await run(join(String(dir), "packages", "a"), server, ["add", "--catalog", "direct"]);
    expect(follows.err).toContain(
      `note: direct in a now follows the catalog entry "${masked(server, "?v=2")}" instead of "${masked(server, "?v=3")}"\n`,
    );
    expectNoSecrets(follows.out, follows.err);
    expect(follows.exitCode).toBe(0);
  });

  test("bun pm migrate lists the entries that it can't migrate", async () => {
    using yarn = tempDir("redacted-migrate-yarn", {
      "package.json": packageJson(spec(nowhere)),
      "yarn.lock": `# yarn lockfile v1\n\n\n"direct@${spec(nowhere)}":\n  version "1.0.0"\n`,
    });
    const fromYarn = await run(String(yarn), nowhere, ["pm", "migrate", "--verbose"]);
    expect(fromYarn.err).toContain(
      `warn: skipping "direct@${masked(nowhere)}" from yarn.lock: missing "resolved" field\n`,
    );
    expect(fromYarn.err).toContain(`warn: yarn.lock missing "direct@${masked(nowhere)}", resolving it\n`);
    expectNoSecrets(fromYarn.out, fromYarn.err);
    expect(fromYarn.exitCode).toBe(0);

    using pnpm = tempDir("redacted-migrate-pnpm", {
      "package.json": packageJson(spec(nowhere)),
      "pnpm-lock.yaml": [
        "lockfileVersion: '9.0'",
        "importers:",
        "  .:",
        "    dependencies:",
        "      direct:",
        `        specifier: ${spec(nowhere)}`,
        `        version: ${spec(nowhere)}`,
        "packages: {}",
        "snapshots: {}",
        "",
      ].join("\n"),
    });
    const fromPnpm = await run(String(pnpm), nowhere, ["pm", "migrate"]);
    expect(fromPnpm.err).toContain(
      `error: pnpm-lock.yaml has no package entry 'direct@${masked(nowhere)}' for dependency 'direct' of importer '.'\n`,
    );
    expectNoSecrets(fromPnpm.out, fromPnpm.err);
    expect(fromPnpm.exitCode).toBe(1);

    using npm = tempDir("redacted-migrate-npm", {
      "package.json": packageJson(spec(nowhere)),
      "package-lock.json": JSON.stringify({
        name: "app",
        lockfileVersion: 3,
        packages: { "": { name: "app", dependencies: { direct: spec(nowhere) } } },
      }),
    });
    const fromNpm = await run(String(npm), nowhere, ["pm", "migrate", "--verbose"]);
    expect(fromNpm.err).toContain(
      `warn: skipping "direct@${masked(nowhere)}" from package-lock.json: no entry for this dependency of "."\n`,
    );
    expectNoSecrets(fromNpm.out, fromNpm.err);
    expect(fromNpm.exitCode).toBe(0);
  });

  // The registry chooses `dist.tarball`, which can contain its own credentials.
  function startRegistry(tarballHost: Host) {
    const version = (v: string) => ({
      name: "direct",
      version: v,
      homepage: spec(tarballHost),
      dependencies: { other: spec(tarballHost) },
      dist: { tarball: spec(tarballHost) },
    });
    return Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname !== "/direct") return new Response("{}", { status: 404 });
        return Response.json({
          name: "direct",
          "dist-tags": { latest: "1.0.1" },
          versions: { "1.0.0": version("1.0.0"), "1.0.1": version("1.0.1") },
        });
      },
    });
  }

  test("bun pm view prints the homepage, the dependencies and dist.tarball", async () => {
    using tarballs = startClosingServer();
    await using registry = startRegistry(tarballs);
    using dir = tempDir("redacted-pm-view", emptyProject);

    const { out, err, exitCode } = await run(String(dir), registry, ["pm", "view", "direct"]);
    expect(out).toContain(`\n${masked(tarballs)}\n`);
    expect(out).toContain(`- other: ${masked(tarballs)}\n`);
    expect(out).toContain(`tarball: ${masked(tarballs)}\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(0);
  });

  test("bun pm diff cannot download dist.tarball", async () => {
    using tarballs = startClosingServer();
    await using registry = startRegistry(tarballs);
    using dir = tempDir("redacted-pm-diff", emptyProject);

    const { out, err, exitCode } = await run(String(dir), registry, ["pm", "diff", "direct@1.0.0", "direct@1.0.1"]);
    expect(err).toContain(`GET ${masked(tarballs)} failed\n`);
    expectNoSecrets(out, err);
    expect(exitCode).toBe(1);
  });
});

// Either half of the userinfo can be the part that must not be printed.
describe.concurrent("the userinfo of a git URL is masked as a whole", () => {
  const word = "s3cretword";

  async function run(cwd: string, env: NodeJS.Dict<string>, args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, exitCode };
  }

  test.each([
    [word, "***"],
    [`${word}:`, "***"],
    [`${word}:x-oauth-basic`, "***"],
    [`x-access-token:${word}`, "***"],
    [`git:${word}`, "***"],
    ["deploy", "***"],
    // The account of an ssh server.
    ["git", "git"],
  ])("%s", async (userinfo, printed) => {
    using repo = await hostedGitRepository([`https://${userinfo}@example.com/org/lib`], {
      "package.json": JSON.stringify({ name: "lib", version: "1.0.0" }),
    });
    const dependency = `git+https://${userinfo}@example.com/org/lib`;
    using dir = tempDir("redacted-git-userinfo", {
      "package.json": JSON.stringify({ name: "app", dependencies: { lib: dependency } }),
    });
    const cwd = String(dir);
    const resolution = `lib@git+https://${printed}@example.com/org/lib#${repo.sha}`;

    const install = await run(cwd, repo.env, ["install"]);
    expect(install.out).toContain(`\n+ ${resolution}\n`);
    expect(install.exitCode).toBe(0);

    const ls = await run(cwd, repo.env, ["pm", "ls"]);
    expect(ls.out).toContain(`── ${resolution}\n`);
    expect(ls.exitCode).toBe(0);

    const why = await run(cwd, repo.env, ["why", "lib"]);
    expect(why.out).toContain(`${resolution}\n`);
    expect(why.out).toContain(`(requires git+https://${printed}@example.com/org/lib)\n`);
    expect(why.exitCode).toBe(0);

    const missing = await run(cwd, repo.env, ["add", `${dependency}#missing`]);
    expect(missing.err).toContain(`found for "git+https://${printed}@example.com/org/lib#missing" (`);
    expect(missing.exitCode).toBe(1);

    for (const { out, err } of [install, ls, why, missing]) {
      expect(out + err).not.toContain(word);
    }

    // The files keep what was written, because the next install needs it.
    expect(await Bun.file(join(cwd, "package.json")).json()).toEqual({
      name: "app",
      dependencies: { lib: dependency },
    });
    expect(await Bun.file(join(cwd, "bun.lock")).text()).toContain(`"lib@${dependency}#${repo.sha}"`);
  });

  // git names the URL it wants a password for, and bun passes on what git says.
  test.skipIf(isWindows)("git's own output", async () => {
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("", { status: 401, headers: { "www-authenticate": 'Basic realm="git"' } }),
    });
    using dir = tempDir("redacted-git-userinfo-stderr", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { lib: `git+http://${word}@127.0.0.1:${server.port}/org/lib.git` },
      }),
    });

    const env = { ...bunEnv, GIT_CONFIG_NOSYSTEM: "1", GIT_ASKPASS: "false", GIT_TERMINAL_PROMPT: "0" };
    const { out, err, exitCode } = await run(String(dir), env, ["install"]);
    expect(err).toContain(`could not read Password for 'http://***@127.0.0.1:${server.port}'`);
    expect(out + err).not.toContain(word);
    expect(exitCode).toBe(1);
  });

  // When no form of the URL can be cloned, each is named above what git said of it.
  test.skipIf(isWindows)("every form of a URL that cannot be cloned", async () => {
    const url = (scheme: string, userinfo: string) => `${scheme}://${userinfo}@example.com/org/lib.git`;
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      // git prints a text/plain answer behind "remote: "
      fetch: () =>
        new Response(`No ${url("https", `user:${word}`)} here.\n`, {
          status: 403,
          headers: { "content-type": "text/plain" },
        }),
    });
    using dir = tempDir("redacted-git-userinfo-forms", {
      "package.json": JSON.stringify({ name: "app", dependencies: { lib: `git+${url("ssh", `user:${word}`)}` } }),
    });

    const env = {
      ...bunEnv,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.http://user:${word}@127.0.0.1:${server.port}/.insteadOf`,
      GIT_CONFIG_VALUE_0: `https://user:${word}@example.com/`,
      GIT_SSH_COMMAND: "sh -c 'echo \"Permission denied (publickey).\" >&2; exit 255'",
      GIT_TERMINAL_PROMPT: "0",
    };
    const { out, err, exitCode } = await run(String(dir), env, ["install"]);
    expect(err.split("\n").filter(line => line.startsWith("git clone "))).toEqual([
      `git clone ${url("https", "***")}`,
      `git clone ${url("ssh", "***")}`,
    ]);
    expect(err).toContain(`remote: No ${url("https", "***")} here.\n`);
    expect(err).toContain("Permission denied (publickey).\n");
    expect(out + err).not.toContain(word);
    expect(exitCode).toBe(1);
  });

  test("bun patch accepts an entry from the list that it prints", async () => {
    const url = (userinfo: string, repo: string) => `git+https://${userinfo}@example.com/org/${repo}`;
    using repo = await hostedGitRepository([url(word, "one").slice(4), url(word, "two").slice(4)], {
      "package.json": JSON.stringify({ name: "lib", version: "1.0.0" }),
    });
    using dir = tempDir("redacted-git-userinfo-patch-list", {
      "package.json": JSON.stringify({ name: "app", workspaces: ["other"], dependencies: { lib: url(word, "one") } }),
      "other/package.json": JSON.stringify({ name: "other", dependencies: { lib: url(word, "two") } }),
    });
    const cwd = String(dir);
    const entries = ["one", "two"].map(name => `lib@${url("***", name)}#${repo.sha}`);

    const install = await run(cwd, repo.env, ["install"]);
    expect(install.exitCode).toBe(0);

    const ambiguous = await run(cwd, repo.env, ["patch", "lib"]);
    expect(ambiguous.err).toContain(`from the following list:\n  ${entries[0]}\n  ${entries[1]}\n`);
    expect(ambiguous.out + ambiguous.err).not.toContain(word);
    expect(ambiguous.exitCode).toBe(1);

    const chosen = await run(cwd, repo.env, ["patch", entries[1]]);
    expect(chosen.out).toContain("To patch lib, edit the following folder:");
    expect(chosen.out + chosen.err).not.toContain(word);
    expect(chosen.exitCode).toBe(0);
  });

  test("bun patch", async () => {
    const userinfo = `x-access-token:${word}`;
    using repo = await hostedGitRepository([`https://${userinfo}@example.com/org/lib`], {
      "package.json": JSON.stringify({ name: "lib", version: "1.0.0" }),
    });
    using dir = tempDir("redacted-git-userinfo-patch", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { lib: `git+https://${userinfo}@example.com/org/lib` },
      }),
    });
    const cwd = String(dir);
    const key = `lib@git+https://***@example.com/org/lib#${repo.sha}`;
    const patch = `patches/lib@git+https%3A%2F%2Fexample.com%2Forg%2Flib#${repo.sha}.patch`;
    const commit = ["patch", "--commit", "node_modules/lib"];

    const steps = [await run(cwd, repo.env, ["install"]), await run(cwd, repo.env, ["patch", "lib"])];
    await Bun.write(join(cwd, "node_modules", "lib", "added.js"), "1;\n");
    steps.push(await run(cwd, repo.env, [...commit, "--dry-run"]));
    expect(steps[2].out).toContain(`would write ${patch} and add ${key} to patchedDependencies\n`);
    steps.push(await run(cwd, repo.env, commit));
    expect(await Bun.file(join(cwd, patch)).exists()).toBe(true);
    // The patch is of the installed package.
    steps.push(await run(cwd, repo.env, ["install", "--force"]));
    expect(steps[4].err).not.toContain("no longer applies");
    expect(await Bun.file(join(cwd, "node_modules", "lib", "added.js")).exists()).toBe(true);

    for (const { out, err, exitCode } of steps) {
      expect(out + err).not.toContain(word);
      expect(exitCode).toBe(0);
    }
  });
});

// Bun doesn't send requests to a registry URL that isn't http(s), and it prints which URL that was.
describe.concurrent("a registry URL that bun refuses is echoed without its password", () => {
  const password = "hunter2";
  const refused = [
    (userinfo: string, host: string) => `htps://${userinfo}@${host}/`,
    (userinfo: string, host: string) => `${userinfo}@${host}/`,
    (userinfo: string, host: string) => `//${userinfo}@${host}/`,
  ];

  async function run(cwd: string, registry: string, args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: { ...bunEnv, npm_config_registry: registry, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(out).not.toContain(password);
    expect(err).not.toContain(password);
    return { err, exitCode };
  }

  test.each(refused)("--registry: %#", async url => {
    using dir = tempDir("redacted-registry-flag", { "package.json": JSON.stringify({ name: "app" }) });
    const args = ["install", "--registry", url(`user:${password}`, "localhost:1")];
    expect(await run(String(dir), "http://localhost:1/", args)).toEqual({
      err: `error: Registry URL must start with 'https://' or 'http://': "${url("***", "localhost:1")}"\n`,
      exitCode: 1,
    });
  });

  test.each(refused)("publishConfig.registry: %#", async url => {
    using dir = tempDir("redacted-publish-config", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        publishConfig: { registry: url(`user:${password}`, "localhost:1") },
      }),
    });
    expect(await run(String(dir), "http://localhost:1/", ["publish", "--dry-run"])).toEqual({
      err: `error: invalid \`registry\` value in \`publishConfig\`: "${url("***", "localhost:1")}", expected a URL starting with 'https://' or 'http://'\n`,
      exitCode: 1,
    });
  });

  test("a scope's registry without a scheme", async () => {
    // The default registry has nothing to report, so `bun audit` continues with the scope's registry.
    await using server = Bun.serve({
      port: 0,
      fetch: req => (req.method === "POST" ? Response.json({}) : new Response("{}", { status: 404 })),
    });
    const host = `${server.hostname}:${server.port}`;
    const files = {
      "package.json": JSON.stringify({ name: "app", dependencies: { "@foo/pkg": "1.0.0" } }),
      "bunfig.toml": `[install.scopes]\nfoo = "user:${password}@${host}/"\n`,
    };
    const masked = `***@${host}`;

    using unlocked = tempDir("redacted-scope-registry", files);
    const resolve = await run(String(unlocked), `http://${host}/`, ["install"]);
    expect(resolve.err).toContain(`error: Failed to join registry "${masked}/" and package "@foo/pkg" URLs\n`);
    expect(resolve.exitCode).toBe(1);

    using locked = tempDir("redacted-scope-registry-locked", {
      ...files,
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "app", dependencies: { "@foo/pkg": "1.0.0" } } },
        packages: { "@foo/pkg": ["@foo/pkg@1.0.0", "", {}, ""] },
      }),
    });
    const download = await run(String(locked), `http://${host}/`, ["install"]);
    const audit = await run(String(locked), `http://${host}/`, ["audit"]);
    const diff = await run(String(locked), `http://${host}/`, ["pm", "diff", "@foo/pkg@1.0.0", "@foo/pkg@2.0.0"]);
    expect(download).toEqual({
      err: `error: Expected tarball URL to start with https:// or http://, got "${masked}/@foo/pkg/-/pkg-1.0.0.tgz" while fetching package "@foo/pkg"\n`,
      exitCode: 1,
    });
    expect(audit).toEqual({
      err: `error: POST ${masked}/-/npm/v1/security/advisories/bulk - UnsupportedProtocol\n`,
      exitCode: 1,
    });
    expect(diff).toEqual({ err: `UnsupportedProtocol: GET ${masked}/@foo%2fpkg failed\n`, exitCode: 1 });
  });
});

// The retention half of the "plaintext _password" case above: Buffer.from(v, "base64")
// parity means an invalid-base64 _password is decoded leniently (invalid bytes skipped),
// not dropped — "aGVsbG8*!" must yield the same credential npm derives: "hello".
test("invalid base64 _password keeps the lenient-decoded credential", () => {
  const result = iniInternals.loadNpmrc(
    "registry=https://registry.npmjs.org/\n" +
      "//registry.npmjs.org/:username=alice\n" +
      "//registry.npmjs.org/:_password=aGVsbG8*!",
  );
  expect(result.default_registry_username).toBe("alice");
  expect(result.default_registry_password).toBe(Buffer.from("aGVsbG8*!", "base64").toString());
  expect(result.default_registry_password).toBe("hello");
});
