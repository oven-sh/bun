import { file } from "bun";
import { iniInternals } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { realpathSync } from "fs";
import { VerdaccioRegistry, bunEnv, bunExe, isIPv6, normalizeBunSnapshot, tempDir } from "harness";
import { basename, dirname, join } from "path";

const { loadNpmrc } = iniInternals;

const registry = new VerdaccioRegistry();
const registryUrl = registry.registryUrl();

// verdaccio serves `@needs-auth/*` to authenticated users only. `generateUser()` and `createTestDir()` rewrite
// verdaccio's htpasswd file, so the one user every credential case logs in as is created here, before the
// concurrent cases start, and no case calls `createTestDir()`.
const user = { name: "bilbo_swaggins", password: "verysecure", token: "" };
const base64 = (s: string) => Buffer.from(s).toString("base64");

beforeAll(async () => {
  await registry.start();
  user.token = await registry.generateUser(user.name, user.password);
});

afterAll(() => {
  registry.stop();
});

/**
 * The env for one spawned bun: its own install cache and its own (empty unless the case writes one) user config
 * dir under `<dir>/home`. CI exports a per-file BUN_INSTALL_CACHE_DIR, which wins over every config file, and with
 * a shared cache a case can install another case's download without asking (or authenticating with) the registry.
 * A value of `undefined` in `extra` removes the variable.
 */
function envFor(dir: string, extra: Record<string, string | undefined> = {}) {
  const home = join(dir, "home");
  const env: Record<string, string | undefined> = {
    ...bunEnv,
    BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache"),
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    ...extra,
  };
  for (const key in env) if (env[key] === undefined) delete env[key];
  return env;
}

async function bun(args: string[], cwd: string, env: Record<string, string | undefined> = envFor(cwd)) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function normalize(output: string, dir: string) {
  return normalizeBunSnapshot(output, dir).replaceAll(`localhost:${registry.port}`, "localhost:<port>");
}

/** `bun install` in `dir` with stdout and stderr normalized for snapshots. */
async function install(dir: string, opts: { args?: string[]; env?: Record<string, string | undefined> } = {}) {
  const { stdout, stderr, exitCode } = await bun(["install", ...(opts.args ?? [])], dir, opts.env);
  return { stdout: normalize(stdout, dir), stderr: normalize(stderr, dir), exitCode };
}

/** `<name>@<version>` → tarball url for every package in bun.lock. The url shows which registry served the package. */
async function lockfileTarballs(dir: string) {
  const lock = Bun.JSONC.parse(await file(join(dir, "bun.lock")).text()) as {
    packages: Record<string, [id: string, tarball: string, ...rest: unknown[]]>;
  };
  return Object.fromEntries(Object.values(lock.packages).map(([id, tarball]) => [id, tarball]));
}

/** the tarball urls verdaccio hands out for the fixture packages these cases install */
const tarballUrl = {
  "no-deps": `${registryUrl}no-deps/-/no-deps-1.0.0.tgz`,
  "@types/no-deps": `${registryUrl}@types/no-deps/-/no-deps-1.0.0.tgz`,
  "@needs-auth/test-pkg": `${registryUrl}@needs-auth/test-pkg/-/test-pkg-1.0.0.tgz`,
};

/** What `loadNpmrc` returns for a file that configures nothing. */
const npmrcDefaults = {
  default_registry_url: "https://registry.npmjs.org/",
  default_registry_token: "",
  default_registry_username: "",
  default_registry_password: "",
  default_registry_email: "",
};

describe.concurrent("npmrc", () => {
  it("should convert to utf8 if BOM", async () => {
    using dir = tempDir("npmrc-bom", {
      ".npmrc": Buffer.from(`\ufeff\ncache=hi!`, "utf16le"),
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });

    // BUN_INSTALL_CACHE_DIR would win over `cache`
    const { stdout, stderr, exitCode } = await bun(
      ["pm", "cache"],
      String(dir),
      envFor(String(dir), { BUN_INSTALL_CACHE_DIR: undefined }),
    );
    expect(stderr).toBe("");
    const printed = stdout.trim();
    expect(basename(printed)).toBe("hi!");
    expect(realpathSync(dirname(printed))).toBe(realpathSync(String(dir)));
    expect(exitCode).toBe(0);
  });

  it("works with empty file", async () => {
    using dir = tempDir("npmrc-empty", {
      ".npmrc": "",
      "package.json": JSON.stringify({ name: "foo", dependencies: {} }),
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toMatchInlineSnapshot(`"No packages! Deleted empty lockfile"`);
    expect(stdout).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)
       done"
    `);
    expect(exitCode).toBe(0);

    expect(loadNpmrc("")).toEqual(npmrcDefaults);
  });

  it("sets default registry", async () => {
    using dir = tempDir("npmrc-default-registry", {
      ".npmrc": `\nregistry = http://localhost:${registry.port}/\n`,
      "package.json": JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }),
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [4]
      Saved lockfile"
    `);
    expect(stdout).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + no-deps@1.0.0 (v2.0.0 available)

      1 package installed"
    `);
    expect(await lockfileTarballs(String(dir))).toEqual({ "no-deps@1.0.0": tarballUrl["no-deps"] });
    expect(exitCode).toBe(0);
  });

  it("sets scoped registry", async () => {
    using dir = tempDir("npmrc-scoped-registry", {
      ".npmrc": `\n  @types:registry=http://localhost:${registry.port}/\n  `,
      "package.json": JSON.stringify({ name: "foo", dependencies: { "@types/no-deps": "1.0.0" } }),
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [4]
      Saved lockfile"
    `);
    expect(stdout).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + @types/no-deps@1.0.0 (v2.0.0 available)

      1 package installed"
    `);
    expect(await lockfileTarballs(String(dir))).toEqual({ "@types/no-deps@1.0.0": tarballUrl["@types/no-deps"] });
    expect(exitCode).toBe(0);
  });

  it("works with home config", async () => {
    using dir = tempDir("npmrc-home-config", {
      "home/.npmrc": `\n  registry=http://localhost:${registry.port}/\n  `,
      "package.json": JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }),
    });

    // envFor() points $XDG_CONFIG_HOME, $HOME and %USERPROFILE% at <dir>/home
    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [4]
      Saved lockfile"
    `);
    expect(stdout).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + no-deps@1.0.0 (v2.0.0 available)

      1 package installed"
    `);
    expect(await lockfileTarballs(String(dir))).toEqual({ "no-deps@1.0.0": tarballUrl["no-deps"] });
    expect(exitCode).toBe(0);
  });

  it("works with two configs", async () => {
    using dir = tempDir("npmrc-two-configs", {
      ".npmrc": `\n  @types:registry=http://localhost:${registry.port}/\n  `,
      "home/.npmrc": `\n    registry = http://localhost:${registry.port}/\n    `,
      "package.json": JSON.stringify({
        name: "foo",
        dependencies: { "no-deps": "1.0.0", "@types/no-deps": "1.0.0" },
      }),
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [8]
      Saved lockfile"
    `);
    expect(stdout).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + @types/no-deps@1.0.0 (v2.0.0 available)
      + no-deps@1.0.0 (v2.0.0 available)

      2 packages installed"
    `);
    expect(await lockfileTarballs(String(dir))).toEqual({
      "no-deps@1.0.0": tarballUrl["no-deps"],
      "@types/no-deps@1.0.0": tarballUrl["@types/no-deps"],
    });
    expect(exitCode).toBe(0);
  });

  it("package config overrides home config", async () => {
    // the home config routes @types to a registry that must never be asked
    using homeRegistry = recordingRegistry("127.0.0.1");
    using dir = tempDir("npmrc-package-overrides-home", {
      ".npmrc": `\n  @types:registry=http://localhost:${registry.port}/\n  `,
      "home/.npmrc": `@types:registry=http://127.0.0.1:${homeRegistry.port}/`,
      "package.json": JSON.stringify({ name: "foo", dependencies: { "@types/no-deps": "1.0.0" } }),
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(homeRegistry.requests).toEqual([]);
    expect(stderr).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [4]
      Saved lockfile"
    `);
    expect(stdout).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + @types/no-deps@1.0.0 (v2.0.0 available)

      1 package installed"
    `);
    expect(await lockfileTarballs(String(dir))).toEqual({ "@types/no-deps@1.0.0": tarballUrl["@types/no-deps"] });
    expect(exitCode).toBe(0);
  });

  it("default registry from env variable", () => {
    const ini = /* ini */ `
registry=\${LOL}
  `;

    const result = loadNpmrc(ini, { LOL: `http://localhost:${registry.port}/` });

    expect(result).toEqual({ ...npmrcDefaults, default_registry_url: `http://localhost:${registry.port}/` });
  });

  it("default registry from env variable 2", () => {
    const ini = /* ini */ `
registry=http://localhost:\${PORT}/
  `;

    const result = loadNpmrc(ini, { ...bunEnv, PORT: `${registry.port}` });

    expect(result).toEqual({ ...npmrcDefaults, default_registry_url: `http://localhost:${registry.port}/` });
  });

  // `_auth` and `_password` are base64 encoded in the file and come back decoded
  const encoded = (option: string, value: string) =>
    option === "_auth" || option === "_password" ? base64(value) : value;
  const defaultRegistryOptions = (values: Record<string, string>, expected: Partial<typeof npmrcDefaults>) => ({
    name: Object.entries(values)
      .map(([option, value]) => `${option} = ${value}`)
      .join(" "),
    ini: `\n${Object.entries(values)
      .map(([option, value]) => `//registry.npmjs.org/:${option}=${encoded(option, value)}`)
      .join("\n")}\n`,
    expected: { ...npmrcDefaults, ...expected },
  });

  it.each([
    defaultRegistryOptions({ _authToken: "skibidi" }, { default_registry_token: "skibidi" }),
    defaultRegistryOptions(
      { username: "zorp", _password: "skibidi" },
      { default_registry_username: "zorp", default_registry_password: "skibidi" },
    ),
    defaultRegistryOptions({ email: "user@example.com" }, { default_registry_email: "user@example.com" }),
    defaultRegistryOptions(
      { username: "testuser", _password: "testpass", email: "test@example.com" },
      {
        default_registry_username: "testuser",
        default_registry_password: "testpass",
        default_registry_email: "test@example.com",
      },
    ),
  ])("$name", ({ ini, expected }) => {
    expect(loadNpmrc(ini)).toEqual(expected);
  });

  describe("user .npmrc lookup", () => {
    const npmrc = (port: number) => `registry=http://localhost:${port}/\n//localhost:${port}/:_authToken=token\n`;
    const pkg = { "pkg/package.json": JSON.stringify({ name: "npmrc-lookup", version: "0.0.1" }) };

    // `publish --dry-run` never contacts the registry, but it still requires a token
    // for it and prints which registry it picked up, so it shows which .npmrc was read.
    // envFor() sets $HOME and %USERPROFILE% to <dir>/home, each case picks its own $XDG_CONFIG_HOME.
    async function publishDryRun(dir: string, XDG_CONFIG_HOME: string | undefined) {
      const { stdout, stderr, exitCode } = await bun(
        ["publish", "--dry-run"],
        join(dir, "pkg"),
        envFor(dir, { XDG_CONFIG_HOME }),
      );
      return { registry: stdout.match(/^Registry: (.*)$/m)?.[1], stderr, exitCode };
    }

    const usesRegistry = (port: number) => ({ registry: `http://localhost:${port}/`, stderr: "", exitCode: 0 });

    it("uses $XDG_CONFIG_HOME/.npmrc when it exists", async () => {
      using dir = tempDir("npmrc-xdg", { ...pkg, "home/.npmrc": npmrc(1), "xdg/.npmrc": npmrc(2) });
      const result = await publishDryRun(String(dir), join(String(dir), "xdg"));
      expect(result).toEqual(usesRegistry(2));
    });

    // https://github.com/oven-sh/bun/issues/24124: GitHub Actions exports
    // XDG_CONFIG_HOME=~/.config, while `npm login` writes ~/.npmrc.
    it("falls back to $HOME/.npmrc when $XDG_CONFIG_HOME has no .npmrc", async () => {
      using dir = tempDir("npmrc-xdg-without-npmrc", { ...pkg, "home/.npmrc": npmrc(1), "xdg/.keep": "" });
      const result = await publishDryRun(String(dir), join(String(dir), "xdg"));
      expect(result).toEqual(usesRegistry(1));
    });

    it("uses $HOME/.npmrc when $XDG_CONFIG_HOME is unset", async () => {
      using dir = tempDir("npmrc-xdg-unset", { ...pkg, "home/.npmrc": npmrc(1) });
      const result = await publishDryRun(String(dir), undefined);
      expect(result).toEqual(usesRegistry(1));
    });

    it("uses $HOME/.npmrc when $XDG_CONFIG_HOME is empty", async () => {
      using dir = tempDir("npmrc-xdg-empty", { ...pkg, "home/.npmrc": npmrc(1) });
      const result = await publishDryRun(String(dir), "");
      expect(result).toEqual(usesRegistry(1));
    });

    it("fails without a user .npmrc, which is what makes the cases above meaningful", async () => {
      using dir = tempDir("npmrc-xdg-none", { ...pkg, "home/.keep": "", "xdg/.keep": "" });
      const result = await publishDryRun(String(dir), join(String(dir), "xdg"));
      expect(result).toEqual({
        registry: undefined,
        stderr: "error: missing authentication (run `bunx npm login`)\n",
        exitCode: 1,
      });
    });
  });

  // verdaccio answers 401 for `@needs-auth/*` without valid credentials, and every case starts with a cold cache,
  // so an installed `@needs-auth/test-pkg` means the registry accepted the credentials from the .npmrc. A cold
  // install counts 4 tasks per package: download and parse of the manifest, download and extraction of the tarball.
  const authenticatedInstall = (loadsDotEnv = false) => ({
    stderr:
      (loadsDotEnv ? '".env"\n' : "") +
      "Resolving dependencies\nResolved, downloaded and extracted [4]\nSaved lockfile",
    stdout: "bun install <version> (<revision>)\n\n+ @needs-auth/test-pkg@1.0.0\n\n1 package installed",
    tarballs: { "@needs-auth/test-pkg@1.0.0": tarballUrl["@needs-auth/test-pkg"] },
    exitCode: 0,
  });
  const needsAuthPackageJson = JSON.stringify({
    name: "hi",
    version: "1.0.0",
    dependencies: { "@needs-auth/test-pkg": "1.0.0" },
  });

  async function installNeedsAuth(dir: string, env?: Record<string, string | undefined>) {
    const { stdout, stderr, exitCode } = await install(dir, { env: envFor(dir, env) });
    const tarballs = exitCode === 0 ? await lockfileTarballs(dir) : {};
    return { stderr, stdout, tarballs, exitCode };
  }

  it("authentication works", async () => {
    using dir = tempDir("npmrc-auth", {
      ".npmrc": `
registry = http://localhost:${registry.port}/
@needs-auth:registry=http://localhost:${registry.port}/
//localhost:${registry.port}/:_authToken=${user.token}
`,
      "package.json": JSON.stringify({
        name: "hi",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0", "@needs-auth/test-pkg": "1.0.0" },
      }),
    });

    expect(await installNeedsAuth(String(dir))).toEqual({
      stderr: "Resolving dependencies\nResolved, downloaded and extracted [8]\nSaved lockfile",
      stdout:
        "bun install <version> (<revision>)\n\n" +
        "+ @needs-auth/test-pkg@1.0.0\n+ no-deps@1.0.0 (v2.0.0 available)\n\n2 packages installed",
      tarballs: {
        "no-deps@1.0.0": tarballUrl["no-deps"],
        "@needs-auth/test-pkg@1.0.0": tarballUrl["@needs-auth/test-pkg"],
      },
      exitCode: 0,
    });
  });

  // Each case authenticates as `user` through a different set of options keyed to the default registry. `${...}`
  // references are expanded from the process environment (`env`) or from a .env file next to package.json (`dotEnv`).
  it.each<{
    name: string;
    options: () => Record<string, string>;
    env?: () => Record<string, string>;
    dotEnv?: () => Record<string, string>;
  }>([
    { name: "_authToken", options: () => ({ _authToken: user.token }) },
    {
      name: "_authToken with env variable value",
      options: () => ({ _authToken: "${SUPER_SECRET_TOKEN}" }),
      env: () => ({ SUPER_SECRET_TOKEN: user.token }),
    },
    { name: "username and password", options: () => ({ username: user.name, _password: base64(user.password) }) },
    {
      name: "username and password with env variable password",
      options: () => ({ username: user.name, _password: "${SUPER_SECRET_PASSWORD}" }),
      env: () => ({ SUPER_SECRET_PASSWORD: base64(user.password) }),
    },
    {
      name: "username and password with .env variable password",
      options: () => ({ username: user.name, _password: "${SUPER_SECRET_PASSWORD}" }),
      dotEnv: () => ({ SUPER_SECRET_PASSWORD: base64(user.password) }),
    },
    { name: "_auth", options: () => ({ _auth: base64(`${user.name}:${user.password}`) }) },
    {
      name: "_auth from .env variable",
      options: () => ({ _auth: "${SECRET_AUTH}" }),
      dotEnv: () => ({ SECRET_AUTH: base64(`${user.name}:${user.password}`) }),
    },
  ])("sets scoped registry option: $name", async ({ options, env, dotEnv }) => {
    const lines = (vars: Record<string, string>, prefix = "") =>
      Object.entries(vars)
        .map(([key, value]) => `${prefix}${key}=${value}`)
        .join("\n");
    using dir = tempDir("npmrc-registry-option", {
      ".npmrc": `\nregistry = http://localhost:${registry.port}/\n${lines(options(), `//localhost:${registry.port}/:`)}\n`,
      "package.json": needsAuthPackageJson,
      ...(dotEnv ? { ".env": lines(dotEnv()) + "\n" } : {}),
    });

    expect(await installNeedsAuth(String(dir), env?.())).toEqual(authenticatedInstall(dotEnv !== undefined));
  });

  it("sets scoped registry option: _auth from .env variable with no value", async () => {
    const key = `//localhost:${registry.port}/:_auth=`;
    using dir = tempDir("npmrc-registry-option-empty", {
      ".npmrc": `\nregistry = http://localhost:${registry.port}/\n${key}\${SECRET_AUTH}\n`,
      "package.json": needsAuthPackageJson,
      ".env": "SECRET_AUTH=\n",
    });

    // The empty `_auth` is reported (with the value masked) and dropped, so the request carries no credentials
    // and verdaccio refuses it. The error location moves with the number of digits in the port.
    const { stderr, stdout, tarballs, exitCode } = await installNeedsAuth(String(dir));
    expect(stderr).toBe(
      [
        `".env"`,
        `warn: Encountered an error while reading .npmrc:`,
        ``,
        `3 | //localhost:<port>/:_auth=**************`,
        `${" ".repeat("3 | ".length + key.length)}^`,
        `error: invalid _auth value, expected base64 encoded "<username>:<password>", received an empty string`,
        `    at .npmrc:3:${key.length + 1}`,
        `Resolving dependencies`,
        `Resolved, downloaded and extracted [1]`,
        `error: GET http://localhost:<port>/@needs-auth%2ftest-pkg - 401`,
        `error: @needs-auth/test-pkg@1.0.0 failed to resolve`,
      ].join("\n"),
    );
    expect(stdout).toBe(`bun install <version> (<revision>)`);
    expect(tarballs).toEqual({});
    expect(exitCode).toBe(1);
  });

  test("applies auth tokens to default registry correctly - same host different paths", () => {
    // Regression test for https://github.com/oven-sh/bun/issues/26350
    // When multiple auth tokens exist for the same host but different paths,
    // Bun should match the token by both host AND path, not just host.
    const ini = `
registry=https://somehost.com/org1/npm/registry/
//somehost.com/org1/npm/registry/:_authToken=jwt1
//somehost.com/org2/npm/registry/:_authToken=jwt2
//somehost.com/org3/npm/registry/:_authToken=jwt3
`;
    expect(loadNpmrc(ini)).toEqual({
      ...npmrcDefaults,
      default_registry_url: "https://somehost.com/org1/npm/registry/",
      default_registry_token: "jwt1",
    });
  });

  test("auth token not applied when paths don't match - same host", () => {
    // Regression test for https://github.com/oven-sh/bun/issues/26350
    // When auth tokens exist for a different path on the same host,
    // they should not be applied to the default registry.
    const ini = `
registry=https://somehost.com/org1/npm/registry/
//somehost.com/org2/npm/registry/:_authToken=jwt2
`;
    // the token stays empty since there's no matching token for /org1/npm/registry/
    expect(loadNpmrc(ini)).toEqual({
      ...npmrcDefaults,
      default_registry_url: "https://somehost.com/org1/npm/registry/",
    });
  });

  describe("credentials keyed to a bracketed IPv6 host", () => {
    // The `//` is stripped off the key before it is parsed as a URL, leaving
    // `[::1]:4873/`. A leading `[` used to parse to an empty host, so these keys
    // never matched the registry they were written for.
    test.each([
      ["loopback with a port", "http://[::1]:4873/", "//[::1]:4873/"],
      ["loopback without a port", "http://[::1]/", "//[::1]/"],
      ["full address with a path", "http://[2001:db8::1]:4873/npm/registry/", "//[2001:db8::1]:4873/npm/registry/"],
      ["key without the trailing slash", "http://[::1]:4873/", "//[::1]:4873"],
    ])("_authToken is applied: %s", (_, registryUrl, key) => {
      const result = loadNpmrc(`registry=${registryUrl}\n${key}:_authToken=v6-token\n`);
      expect(result).toEqual({
        ...npmrcDefaults,
        default_registry_url: registryUrl,
        default_registry_token: "v6-token",
      });
    });

    test("username, _password and _auth are applied", () => {
      const password = base64("v6-password");
      expect(
        loadNpmrc(`registry=http://[::1]:4873/\n//[::1]:4873/:username=v6-user\n//[::1]:4873/:_password=${password}\n`),
      ).toEqual({
        ...npmrcDefaults,
        default_registry_url: "http://[::1]:4873/",
        default_registry_username: "v6-user",
        default_registry_password: "v6-password",
      });

      const auth = base64("v6-user:v6-password");
      expect(loadNpmrc(`registry=http://[::1]:4873/\n//[::1]:4873/:_auth=${auth}\n`)).toEqual({
        ...npmrcDefaults,
        default_registry_url: "http://[::1]:4873/",
        default_registry_username: "v6-user",
        default_registry_password: "v6-password",
      });
    });

    test.each([
      ["a different port", "//[::1]:4874/"],
      ["a different address", "//[::2]:4873/"],
      ["a different path", "//[::1]:4873/other/"],
    ])("a key for %s is not applied", (_, key) => {
      const result = loadNpmrc(`registry=http://[::1]:4873/\n${key}:_authToken=v6-token\n`);
      expect(result).toEqual({ ...npmrcDefaults, default_registry_url: "http://[::1]:4873/" });
    });
  });

  it("does not print an undecodable _password value", async () => {
    const secret = "s!ecret!pass";
    using dir = tempDir("npmrc-password-decode", {
      ".npmrc": `//registry.npmjs.org/:_password=${secret}\n`,
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain(secret);
    expect(stderr).toMatchInlineSnapshot(`
      "warn: Encountered an error while reading .npmrc:

      1 | //registry.npmjs.org/:_password=************
                                          ^
      error: _password is not valid base64
          at .npmrc:1:33
      No packages! Deleted empty lockfile"
    `);
    expect(stdout).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)
       done"
    `);
    expect(exitCode).toBe(0);
  });
});

/** A registry that records what reaches it: `<METHOD> <path>` plus the authorization header. */
function recordingRegistry(hostname: string, respond: (url: URL) => Response | undefined = () => undefined) {
  const requests: { request: string; authorization: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    hostname,
    fetch(req) {
      const url = new URL(req.url);
      requests.push({ request: `${req.method} ${url.pathname}`, authorization: req.headers.get("authorization") });
      return respond(url) ?? Response.json({ error: "not found" }, { status: 404 });
    },
  });
  return { port: server.port, requests, [Symbol.dispose]: () => void server.stop(true) };
}

describe.concurrent("scoped registry routing", () => {
  // A request for a @scope package must be sent only to that scope's configured
  // registry with that scope's token. The registry map was keyed by a bare
  // Wyhash11 hash of the scope name, so a different scope whose name hashed to
  // the same value would overwrite it and silently inherit its registry + token.
  // https://github.com/oven-sh/bun/issues/32741
  test("does not route to a hash-colliding scope's registry or token", async () => {
    // scopeA and scopeB collide under Bun's internal scope-name hash
    // (Wyhash11(0) == 0xd2c80616f46b9bf2) but are distinct strings.
    const scopeA = "cuxk74rj1jlebf5o-cigmevrqk5-74swpkgcollapkgcollbaaaaaaaa8k0b-p2s";
    const scopeB = "cuxk74rj1jlebf5o-cigmevrqk5-74swpkgcollapkgcollbbbbbbbbb8k0b-p2s";

    using registryA = recordingRegistry("127.0.0.1");
    using registryB = recordingRegistry("127.0.0.1");
    const urlA = `http://127.0.0.1:${registryA.port}/`;
    const urlB = `http://127.0.0.1:${registryB.port}/`;

    // scopeA is declared first, so scopeB's colliding entry overwrites it in the
    // hash-keyed registry map. The default registry also points at A so that a
    // correct fallback stays offline instead of reaching the public registry.
    using dir = tempDir("npmrc-scope-collision", {
      ".npmrc":
        `registry=${urlA}\n` +
        `@${scopeA}:registry=${urlA}\n` +
        `//127.0.0.1:${registryA.port}/:_authToken=scope-A-SECRET-token\n` +
        `@${scopeB}:registry=${urlB}\n` +
        `//127.0.0.1:${registryB.port}/:_authToken=scope-B-SECRET-token\n`,
      "package.json": JSON.stringify({
        name: "victim",
        version: "0.0.0",
        dependencies: { [`@${scopeA}/probe`]: "^1.0.0" },
      }),
    });

    const { stdout, stderr, exitCode } = await install(String(dir), { args: ["--no-cache"] });

    // scopeB's registry must never see the @scopeA/probe request, and must
    // never be handed scopeB's secret token for it.
    expect(registryB.requests).toEqual([]);
    // The request must have been attempted against scopeA's own registry, with scopeA's token.
    expect(registryA.requests).toEqual([
      { request: `GET /@${scopeA}%2fprobe`, authorization: "Bearer scope-A-SECRET-token" },
    ]);
    // The install fails (probe does not exist); we only care where it asked.
    expect(stderr.replaceAll(`127.0.0.1:${registryA.port}`, "127.0.0.1:<port-a>")).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [1]
      error: GET http://127.0.0.1:<port-a>/@cuxk74rj1jlebf5o-cigmevrqk5-74swpkgcollapkgcollbaaaaaaaa8k0b-p2s%2fprobe - 404
      error: @cuxk74rj1jlebf5o-cigmevrqk5-74swpkgcollapkgcollbaaaaaaaa8k0b-p2s/probe@^1.0.0 failed to resolve"
    `);
    expect(stdout).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("--registry override", () => {
  test("does not send the token configured for the previous registry host to the --registry host", async () => {
    const tgz = join(import.meta.dir, "registry", "packages", "no-deps", "no-deps-1.0.0.tgz");

    using registryA = recordingRegistry("127.0.0.1");
    using registryB = recordingRegistry("127.0.0.1", url => {
      if (url.pathname.endsWith(".tgz")) return new Response(file(tgz));
      if (url.pathname === "/no-deps") {
        return Response.json({
          name: "no-deps",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "no-deps",
              version: "1.0.0",
              dist: { tarball: `${url.origin}/no-deps/-/no-deps-1.0.0.tgz` },
            },
          },
        });
      }
    });

    using dir = tempDir("npmrc-registry-override", {
      ".npmrc":
        `registry=http://127.0.0.1:${registryA.port}/\n` +
        `//127.0.0.1:${registryA.port}/:_authToken=first-host-SECRET-token\n`,
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0" },
      }),
    });

    const { stdout, stderr, exitCode } = await install(String(dir), {
      args: ["--registry", `http://127.0.0.1:${registryB.port}/`],
    });

    expect(registryA.requests).toEqual([]);
    expect(registryB.requests).toEqual([
      { request: "GET /no-deps", authorization: null },
      { request: "GET /no-deps/-/no-deps-1.0.0.tgz", authorization: null },
    ]);
    expect(stderr).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [4]
      Saved lockfile"
    `);
    expect(stdout).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + no-deps@1.0.0

      1 package installed"
    `);
    expect(await lockfileTarballs(String(dir))).toEqual({
      "no-deps@1.0.0": `http://127.0.0.1:${registryB.port}/no-deps/-/no-deps-1.0.0.tgz`,
    });
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!isIPv6())("registry on a bracketed IPv6 host", () => {
  test.concurrent("sends the token keyed to //[::1]:port/ to the default and the scoped registry", async () => {
    using server = recordingRegistry("::1");
    const url = `http://[::1]:${server.port}/`;

    using dir = tempDir("npmrc-ipv6-registry", {
      ".npmrc": `registry=${url}\n@v6:registry=${url}\n//[::1]:${server.port}/:_authToken=v6-SECRET-token\n`,
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0", "@v6/no-deps": "1.0.0" },
      }),
    });

    const { stdout, stderr, exitCode } = await install(String(dir), {
      args: ["--no-cache"],
      // An ambient proxy would intercept the requests to the local registry.
      env: envFor(String(dir), { http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "" }),
    });

    expect(server.requests.toSorted((a, b) => a.request.localeCompare(b.request))).toEqual([
      { request: "GET /@v6%2fno-deps", authorization: "Bearer v6-SECRET-token" },
      { request: "GET /no-deps", authorization: "Bearer v6-SECRET-token" },
    ]);
    // The registry answers 404 to both manifest requests, so the install itself fails. The two 404 lines print in
    // the order the responses arrive.
    expect(
      stderr
        .replaceAll(`[::1]:${server.port}`, "[::1]:<port>")
        .split("\n")
        .filter(line => line.startsWith("error:"))
        .sort(),
    ).toEqual([
      "error: @v6/no-deps@1.0.0 failed to resolve",
      "error: GET http://[::1]:<port>/@v6%2fno-deps - 404",
      "error: GET http://[::1]:<port>/no-deps - 404",
      "error: no-deps@1.0.0 failed to resolve",
    ]);
    expect(stdout).toBe("bun install <version> (<revision>)");
    expect(exitCode).toBe(1);
  });
});
