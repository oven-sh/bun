import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { bunEnv, bunExe, readdirSorted, tempDir } from "harness";
import { join } from "path";
import { TestRegistry } from "registry";

const registry = new TestRegistry();
let authToken: string;

beforeAll(async () => {
  await registry.start();
  authToken = await registry.generateUser("config-precedence", "verysecure");
  await registry.generateUser("percent-user", "p@ss:w%rd");
});

afterAll(() => {
  registry.stop();
});

const authLine = () => `//localhost:${registry.port}/:_authToken=${authToken}\n`;
const registryUrlWithoutSlash = () => `http://localhost:${registry.port}`;
const bunfig = (install: Record<string, unknown>) => Bun.TOML.stringify({ install });
const packageJson = (dependencies: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "config-precedence", version: "1.0.0", dependencies, ...extra });

/** A registry that must never be contacted. */
function deadRegistry() {
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      hits++;
      return new Response("wrong registry", { status: 500 });
    },
  });
  return {
    server,
    url: `http://localhost:${server.port}/`,
    get hits() {
      return hits;
    },
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

/** Forwards to the registry while recording every Authorization header it receives. */
function capturingRegistry() {
  const authorizations: (string | null)[] = [];
  const upstream = registry.registryUrl();
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      authorizations.push(req.headers.get("authorization"));
      const { pathname, search } = new URL(req.url);
      const res = await fetch(new URL(pathname.slice(1) + search, upstream), {
        headers: { authorization: req.headers.get("authorization") ?? "" },
      });
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      // Tarball URLs in the manifest must point back here or bun (correctly) withholds credentials from the other origin.
      const body = contentType.includes("json")
        ? (await res.text()).replaceAll(upstream, url)
        : await res.arrayBuffer();
      return new Response(body, { status: res.status, headers: { "content-type": contentType } });
    },
  });
  const url = `http://localhost:${server.port}/`;
  return {
    port: server.port,
    url,
    authorizations,
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

async function run(root: string, cmd: string[], env: Record<string, string | undefined> = {}, cwd = "project") {
  const home = join(root, "home");
  const fullEnv: Record<string, string | undefined> = {
    ...bunEnv,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    // It replaces `$HOME/.npmrc` (actions/setup-node exports it).
    NPM_CONFIG_USERCONFIG: undefined,
    npm_config_userconfig: undefined,
    BUN_INSTALL_CACHE_DIR: join(root, "cache"),
    ...env,
  };
  for (const key in fullEnv) if (fullEnv[key] === undefined) delete fullEnv[key];
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd: join(root, cwd),
    env: fullEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const install = (root: string, args: string[] = [], env?: Record<string, string | undefined>) =>
  run(root, ["install", ...args], env);

const isIsolated = (root: string) => existsSync(join(root, "project", "node_modules", ".bun"));
const installed = (root: string, ...pkg: string[]) =>
  existsSync(join(root, "project", "node_modules", ...pkg, "package.json"));
const projectPackageJson = (root: string) => JSON.parse(readFileSync(join(root, "project", "package.json"), "utf8"));
const postinstallRan = (root: string) =>
  existsSync(join(root, "project", "node_modules", "lifecycle-postinstall", "postinstall.txt"));
const hiddenHoistDir = (root: string) => join(root, "project", "node_modules", ".bun", "node_modules");

describe.concurrent("bun install config precedence", () => {
  test("project bunfig linker beats ~/.npmrc install-strategy", async () => {
    using dir = tempDir("config-precedence", {
      "home/.npmrc": "install-strategy=hoisted\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl(), linker: "isolated" }),
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(isIsolated(String(dir))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("project bunfig registry beats project .npmrc registry", async () => {
    using dead = deadRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `registry=${dead.url}\n`,
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl() }),
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "no-deps", "package.json"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("project bunfig registry beats ~/.npmrc registry", async () => {
    using dead = deadRegistry();
    using dir = tempDir("config-precedence", {
      "home/.npmrc": `registry=${dead.url}\n`,
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl() }),
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "no-deps", "package.json"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("project .npmrc registry beats ~/.npmrc registry", async () => {
    using dead = deadRegistry();
    using dir = tempDir("config-precedence", {
      "home/.npmrc": `registry=${dead.url}\n`,
      "project/.npmrc": `registry=${registry.registryUrl()}\n`,
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "no-deps", "package.json"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("~/.npmrc _authToken applies to the registry set in project bunfig", async () => {
    using dir = tempDir("config-precedence", {
      "home/.npmrc": authLine(),
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl() }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(existsSync(join(String(dir), "project", "node_modules", "@needs-auth", "test-pkg", "package.json"))).toBe(
      true,
    );
    expect(exitCode).toBe(0);
  });

  test("project .npmrc scoped registry and token apply alongside a bunfig registry", async () => {
    using dead = deadRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `@needs-auth:registry=${registry.registryUrl()}\n${authLine()}`,
      "project/bunfig.toml": bunfig({ registry: dead.url }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "@needs-auth", "test-pkg", "package.json"))).toBe(
      true,
    );
    expect(exitCode).toBe(0);
  });

  test("bunfig scoped registry keeps credentials from ~/.npmrc", async () => {
    using dead = deadRegistry();
    using dir = tempDir("config-precedence", {
      "home/.npmrc": authLine(),
      "project/bunfig.toml": bunfig({ registry: dead.url, scopes: { "needs-auth": registry.registryUrl() } }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "@needs-auth", "test-pkg", "package.json"))).toBe(
      true,
    );
    expect(exitCode).toBe(0);
  });

  test("~/.npmrc registry= plus its _authToken still authenticate the registry set in project bunfig", async () => {
    using dead = deadRegistry();
    using dir = tempDir("config-precedence", {
      "home/.npmrc": `registry=${dead.url}\n${authLine()}`,
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl() }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("project .npmrc _authToken applies when bunfig spells the same registry with a trailing slash", async () => {
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `registry=${registryUrlWithoutSlash()}\n${authLine()}`,
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl() }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("project .npmrc scoped _authToken applies when bunfig spells the scope registry with a trailing slash", async () => {
    using dead = deadRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `@needs-auth:registry=${registryUrlWithoutSlash()}\n${authLine()}`,
      "project/bunfig.toml": bunfig({ registry: dead.url, scopes: { "needs-auth": registry.registryUrl() } }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("bunfig registry token beats the _authToken for the same registry in ~/.npmrc", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "home/.npmrc": `//localhost:${capture.port}/:_authToken=token-from-npmrc\n`,
      "project/bunfig.toml": bunfig({ registry: { url: capture.url, token: authToken } }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([`Bearer ${authToken}`]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("bunfig scoped registry beats the same scope in .npmrc", async () => {
    using dead = deadRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `@types:registry=${dead.url}\n`,
      "project/bunfig.toml": bunfig({ registry: dead.url, scopes: { types: registry.registryUrl() } }),
      "project/package.json": packageJson({ "@types/no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "@types", "no-deps", "package.json"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("bunfig registry credentials survive a same-URL registry= line in project .npmrc", async () => {
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `registry=${registry.registryUrl()}\n`,
      "project/bunfig.toml": bunfig({ registry: { url: registry.registryUrl(), token: authToken } }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(existsSync(join(String(dir), "project", "node_modules", "@needs-auth", "test-pkg", "package.json"))).toBe(
      true,
    );
    expect(exitCode).toBe(0);
  });

  test("bunfig scoped registry credentials survive the same scope URL in project .npmrc", async () => {
    using dead = deadRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `@needs-auth:registry=${registry.registryUrl()}\n`,
      "project/bunfig.toml": bunfig({
        registry: dead.url,
        scopes: { "needs-auth": { url: registry.registryUrl(), token: authToken } },
      }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "@needs-auth", "test-pkg", "package.json"))).toBe(
      true,
    );
    expect(exitCode).toBe(0);
  });

  // `registry = "<url>"` and `registry = { url = "<url>" }` must read credentials
  // written into the URL the same way.
  const registryForms: [form: string, registry: (url: string) => unknown][] = [
    ["string", url => url],
    ["object", url => ({ url })],
  ];
  const userBasicAuth = `Basic ${Buffer.from("config-precedence:verysecure").toString("base64")}`;

  test.each(registryForms)("bunfig registry %s sends the user:password written into its URL", async (_, registry) => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/bunfig.toml": bunfig({
        registry: registry(`http://config-precedence:verysecure@localhost:${capture.port}/`),
      }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([userBasicAuth]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test.each(registryForms)("bunfig registry %s sends the :token written into its URL", async (_, registry) => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/bunfig.toml": bunfig({ registry: registry(`http://:token-from-url@localhost:${capture.port}/`) }),
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set(["Bearer token-from-url"]));
    expect(installed(String(dir), "no-deps")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test.each(registryForms)(
    "bunfig scoped registry %s sends the user:password written into its URL",
    async (_, registry) => {
      using dead = deadRegistry();
      using capture = capturingRegistry();
      using dir = tempDir("config-precedence", {
        "project/bunfig.toml": bunfig({
          registry: dead.url,
          scopes: { "needs-auth": registry(`http://config-precedence:verysecure@localhost:${capture.port}/`) },
        }),
        "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
      });
      const { stderr, exitCode } = await install(String(dir));
      expect(stderr).not.toContain("error:");
      expect(dead.hits).toBe(0);
      expect(new Set(capture.authorizations)).toStrictEqual(new Set([userBasicAuth]));
      expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  // Credential keys replace the credentials written into the URL as a set.
  // `authToken` is only known after beforeAll, hence the thunks.
  const keyedRegistries: [
    name: string,
    registry: (port: number) => Record<string, string>,
    expectedAuthorization: () => string,
  ][] = [
    [
      "username/password keys beat the user:password written into its URL",
      port => ({
        url: `http://user-from-url:password-from-url@localhost:${port}/`,
        username: "config-precedence",
        password: "verysecure",
      }),
      () => userBasicAuth,
    ],
    [
      "username/password keys beat the :token written into its URL",
      port => ({
        url: `http://:token-from-url@localhost:${port}/`,
        username: "config-precedence",
        password: "verysecure",
      }),
      () => userBasicAuth,
    ],
    [
      "token key beats the user:password written into its URL",
      port => ({ url: `http://user-from-url:password-from-url@localhost:${port}/`, token: authToken }),
      () => `Bearer ${authToken}`,
    ],
  ];

  test.each(keyedRegistries)("bunfig registry object %s", async (_, registry, expectedAuthorization) => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/bunfig.toml": bunfig({ registry: registry(capture.port) }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([expectedAuthorization()]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("credentials written into a bunfig registry object URL beat the _authToken for the same registry in ~/.npmrc", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "home/.npmrc": `//localhost:${capture.port}/:_authToken=token-from-npmrc\n`,
      "project/bunfig.toml": bunfig({
        registry: { url: `http://config-precedence:verysecure@localhost:${capture.port}/` },
      }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([userBasicAuth]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("--linker beats ~/.npmrc, project .npmrc and bunfig", async () => {
    using dir = tempDir("config-precedence", {
      "home/.npmrc": "install-strategy=hoisted\n",
      "project/.npmrc": "install-strategy=hoisted\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl(), linker: "hoisted" }),
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), ["--linker", "isolated"]);
    expect(stderr).not.toContain("error:");
    expect(isIsolated(String(dir))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("~/.npmrc install-strategy applies when bunfig does not set a linker", async () => {
    using dir = tempDir("config-precedence", {
      "home/.npmrc": "install-strategy=linked\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl() }),
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(isIsolated(String(dir))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("bunfig exact = true beats project .npmrc save-exact=false", async () => {
    using dir = tempDir("config-precedence", {
      "project/.npmrc": "save-exact=false\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl(), exact: true }),
      "project/package.json": packageJson({}),
    });
    const { stderr, exitCode } = await run(String(dir), ["add", "no-deps"]);
    expect(stderr).not.toContain("error:");
    expect(projectPackageJson(String(dir)).dependencies).toStrictEqual({ "no-deps": "2.0.0" });
    expect(exitCode).toBe(0);
  });

  test("bunfig exact = false beats ~/.npmrc save-exact=true", async () => {
    using dir = tempDir("config-precedence", {
      "home/.npmrc": "save-exact=true\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl(), exact: false }),
      "project/package.json": packageJson({}),
    });
    const { stderr, exitCode } = await run(String(dir), ["add", "no-deps"]);
    expect(stderr).not.toContain("error:");
    expect(projectPackageJson(String(dir)).dependencies).toStrictEqual({ "no-deps": "^2.0.0" });
    expect(exitCode).toBe(0);
  });

  test("bunfig ignoreScripts = true beats project .npmrc ignore-scripts=false", async () => {
    using dir = tempDir("config-precedence", {
      "project/.npmrc": "ignore-scripts=false\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl(), ignoreScripts: true }),
      "project/package.json": packageJson(
        { "lifecycle-postinstall": "1.0.0" },
        { trustedDependencies: ["lifecycle-postinstall"] },
      ),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(installed(String(dir), "lifecycle-postinstall")).toBe(true);
    expect(postinstallRan(String(dir))).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("bunfig ignoreScripts = false beats ~/.npmrc ignore-scripts=true", async () => {
    using dir = tempDir("config-precedence", {
      "home/.npmrc": "ignore-scripts=true\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl(), ignoreScripts: false }),
      "project/package.json": packageJson(
        { "lifecycle-postinstall": "1.0.0" },
        { trustedDependencies: ["lifecycle-postinstall"] },
      ),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(postinstallRan(String(dir))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("bunfig publicHoistPattern beats project .npmrc public-hoist-pattern", async () => {
    using dir = tempDir("config-precedence", {
      "project/.npmrc": "public-hoist-pattern=no-deps\n",
      "project/bunfig.toml": bunfig({
        registry: registry.registryUrl(),
        linker: "isolated",
        publicHoistPattern: "*types*",
      }),
      "project/package.json": packageJson({ "two-range-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(await readdirSorted(join(String(dir), "project", "node_modules"))).toStrictEqual([
      ".bun",
      "@types",
      "two-range-deps",
    ]);
    expect(exitCode).toBe(0);
  });

  test("bunfig hoistPattern beats ~/.npmrc hoist-pattern", async () => {
    using dir = tempDir("config-precedence", {
      "home/.npmrc": "hoist-pattern=@types/*\n",
      "project/bunfig.toml": bunfig({
        registry: registry.registryUrl(),
        linker: "isolated",
        hoistPattern: "no-deps",
      }),
      "project/package.json": packageJson({ "two-range-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(await readdirSorted(hiddenHoistDir(String(dir)))).toStrictEqual(["no-deps"]);
    expect(exitCode).toBe(0);
  });

  test("bunfig hoist = true beats project .npmrc hoist=false", async () => {
    using dir = tempDir("config-precedence", {
      "project/.npmrc": "hoist=false\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl(), linker: "isolated", hoist: true }),
      "project/package.json": packageJson({ "two-range-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(await readdirSorted(hiddenHoistDir(String(dir)))).toStrictEqual(["@types", "no-deps", "two-range-deps"]);
    expect(exitCode).toBe(0);
  });

  test("bunfig hoist = false beats ~/.npmrc hoist=true", async () => {
    using dir = tempDir("config-precedence", {
      "home/.npmrc": "hoist=true\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl(), linker: "isolated", hoist: false }),
      "project/package.json": packageJson({ "two-range-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(installed(String(dir), "two-range-deps")).toBe(true);
    expect(existsSync(hiddenHoistDir(String(dir)))).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("scopes from .npmrc and bunfig are merged", async () => {
    using dead = deadRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `@types:registry=${registry.registryUrl()}\n`,
      "project/bunfig.toml": bunfig({
        registry: dead.url,
        scopes: { "needs-auth": { url: registry.registryUrl(), token: authToken } },
      }),
      "project/package.json": packageJson({ "@types/no-deps": "1.0.0", "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(installed(String(dir), "@types", "no-deps")).toBe(true);
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("bunfig install.cache.dir beats project .npmrc cache=", async () => {
    using dir = tempDir("config-precedence", {
      "project/.npmrc": "cache=../npmrc-cache\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl(), cache: { dir: "../bunfig-cache" } }),
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), [], { BUN_INSTALL_CACHE_DIR: undefined });
    expect(stderr).not.toContain("error:");
    expect(readdirSync(join(String(dir), "bunfig-cache")).filter(name => name.startsWith("no-deps@"))).toStrictEqual([
      expect.stringMatching(/^no-deps@1\.0\.0@@localhost__[0-9a-f]{16}@@@1$/),
    ]);
    expect(existsSync(join(String(dir), "npmrc-cache"))).toBe(false);
    expect(installed(String(dir), "no-deps")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["cache = false", false],
    ["cache.disable = true", { disable: true }],
  ])("bunfig install.%s keeps no registry metadata either", async (_, cache) => {
    using dir = tempDir("config-precedence", {
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl(), cache }),
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    // Extracted packages go here instead of the global cache.
    expect(await readdirSorted(join(String(dir), "project", "node_modules", ".cache"))).toEqual([
      "no-deps",
      expect.stringMatching(/^no-deps@1\.0\.0@@/),
    ]);
    expect(existsSync(join(String(dir), "cache"))).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("bunfig registry username/password survive a same-URL registry= line in project .npmrc", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `registry=${capture.url}\n`,
      "project/bunfig.toml": bunfig({
        registry: { url: capture.url, username: "config-precedence", password: "verysecure" },
      }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(
      new Set([`Basic ${Buffer.from("config-precedence:verysecure").toString("base64")}`]),
    );
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  // `http://user:pass@host/` in a registry URL is sent as Basic auth and `http://:token@host/` as a Bearer
  // token, however the URL reaches bun. The .npmrc / bunfig string forms already did this; these cover
  // --registry and the registry env vars, which used to drop the credentials.
  const basicAuth = `Basic ${Buffer.from("config-precedence:verysecure").toString("base64")}`;
  const withUserinfo = (capture: { port: number }, userinfo: string) => `http://${userinfo}@localhost:${capture.port}/`;

  test("--registry with user:pass@ in the URL sends Basic auth", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), [
      "--registry",
      withUserinfo(capture, "config-precedence:verysecure"),
    ]);
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("verysecure");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([basicAuth]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("--registry with :token@ in the URL sends it as a Bearer token", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), ["--registry", withUserinfo(capture, `:${authToken}`)]);
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([`Bearer ${authToken}`]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("BUN_CONFIG_TOKEN beats credentials embedded in the --registry URL", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), ["--registry", withUserinfo(capture, ":wrong-token")], {
      BUN_CONFIG_TOKEN: authToken,
    });
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([`Bearer ${authToken}`]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test.each(["BUN_CONFIG_REGISTRY", "NPM_CONFIG_REGISTRY", "npm_config_registry"])(
    "%s with user:pass@ in the URL sends Basic auth",
    async key => {
      using capture = capturingRegistry();
      using dir = tempDir("config-precedence", {
        "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
      });
      const { stderr, exitCode } = await install(String(dir), [], {
        [key]: withUserinfo(capture, "config-precedence:verysecure"),
      });
      expect(stderr).not.toContain("error:");
      expect(stderr).not.toContain("verysecure");
      expect(new Set(capture.authorizations)).toStrictEqual(new Set([basicAuth]));
      expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  test("BUN_CONFIG_REGISTRY with :token@ in the URL sends it as a Bearer token", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), [], {
      BUN_CONFIG_REGISTRY: withUserinfo(capture, `:${authToken}`),
    });
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([`Bearer ${authToken}`]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  // A username written into the URL without a password is Basic auth with an empty password, which is
  // what npm sends for `http://user@host/`; bun used to leave the userinfo in the URL and send nothing.
  // The URL is spelled `user:@host:port` because `user@host:port` does not get through bun's URL parser
  // yet (#16181); both spellings reach the registry config as a username with an empty password. The
  // registry behind the capturing one accepts any credentials for packages readable by everyone.
  const emptyPasswordAuth = `Basic ${Buffer.from("config-precedence:").toString("base64")}`;
  const userOnlyRegistrySources: [
    source: string,
    configure: (url: string) => {
      files?: Record<string, string>;
      args?: string[];
      env?: Record<string, string>;
      dependency?: string;
    },
  ][] = [
    ["bunfig registry string", url => ({ files: { "project/bunfig.toml": bunfig({ registry: url }) } })],
    ["bunfig registry object", url => ({ files: { "project/bunfig.toml": bunfig({ registry: { url } }) } })],
    [
      "bunfig scoped registry",
      url => ({ files: { "project/bunfig.toml": bunfig({ scopes: { types: url } }) }, dependency: "@types/no-deps" }),
    ],
    [".npmrc registry=", url => ({ files: { "project/.npmrc": `registry=${url}\n` } })],
    [
      ".npmrc @scope:registry=",
      url => ({ files: { "project/.npmrc": `@types:registry=${url}\n` }, dependency: "@types/no-deps" }),
    ],
    ["--registry", url => ({ args: ["--registry", url] })],
    ["BUN_CONFIG_REGISTRY", url => ({ env: { BUN_CONFIG_REGISTRY: url } })],
  ];

  test.each(userOnlyRegistrySources)(
    "%s with user:@ in the URL sends Basic auth with an empty password",
    async (_, configure) => {
      using capture = capturingRegistry();
      const {
        files = {},
        args = [],
        env = {},
        dependency = "no-deps",
      } = configure(withUserinfo(capture, "config-precedence:"));
      using dir = tempDir("config-precedence", {
        ...files,
        "project/package.json": packageJson({ [dependency]: "1.0.0" }),
      });
      const { stderr, exitCode } = await install(String(dir), args, env);
      expect(stderr).not.toContain("error:");
      expect(new Set(capture.authorizations)).toStrictEqual(new Set([emptyPasswordAuth]));
      expect(installed(String(dir), ...dependency.split("/"))).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  // Unlike a username written into the URL, a username configured on its own is not a credential: npm
  // only uses the `username` / `_password` pair when both are set.
  test("bunfig registry object with a username key but no password sends no credentials", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/bunfig.toml": bunfig({ registry: { url: capture.url, username: "config-precedence" } }),
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([null]));
    expect(installed(String(dir), "no-deps")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test(".npmrc :username= without :_password= sends no credentials", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `registry=${capture.url}\n//localhost:${capture.port}/:username=config-precedence\n`,
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([null]));
    expect(installed(String(dir), "no-deps")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("user:pass@ in --registry replaces the .npmrc _authToken for the same host", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `registry=${capture.url}\n//localhost:${capture.port}/:_authToken=token-from-npmrc\n`,
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), [
      "--registry",
      withUserinfo(capture, "config-precedence:verysecure"),
    ]);
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([basicAuth]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("user:pass@ in BUN_CONFIG_REGISTRY replaces the .npmrc _authToken for the same host", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `registry=${capture.url}\n//localhost:${capture.port}/:_authToken=token-from-npmrc\n`,
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), [], {
      BUN_CONFIG_REGISTRY: withUserinfo(capture, "config-precedence:verysecure"),
    });
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([basicAuth]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  // Credentials written into a URL are percent-encoded like the rest of it: the
  // password `p@ss:w%rd` of `percent-user` can only be written as below. Every
  // way a registry URL reaches bun decodes them before building the header.
  // (A tarball dependency URL is covered in bun-install.test.ts.)
  const encodedUserinfo = "percent%2Duser:p%40ss%3Aw%25rd";
  const percentUserBasicAuth = `Basic ${Buffer.from("percent-user:p@ss:w%rd").toString("base64")}`;
  type RegistrySetup = { files?: Record<string, string>; args?: string[]; env?: Record<string, string> };
  const registryEntryPoints: [name: string, setup: (url: string, fallback: string) => RegistrySetup][] = [
    ["bunfig registry string", url => ({ files: { "project/bunfig.toml": bunfig({ registry: url }) } })],
    [
      "bunfig scoped registry object",
      (url, fallback) => ({
        files: { "project/bunfig.toml": bunfig({ registry: fallback, scopes: { "needs-auth": { url } } }) },
      }),
    ],
    ["project .npmrc registry=", url => ({ files: { "project/.npmrc": `registry=${url}\n` } })],
    ["--registry", url => ({ args: ["--registry", url] })],
    ["BUN_CONFIG_REGISTRY", url => ({ env: { BUN_CONFIG_REGISTRY: url } })],
  ];

  test.each(registryEntryPoints)("%s percent-decodes the user:password written into the URL", async (_, setup) => {
    using dead = deadRegistry();
    using capture = capturingRegistry();
    const { files, args, env } = setup(withUserinfo(capture, encodedUserinfo), dead.url);
    using dir = tempDir("config-precedence", {
      ...files,
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), args, env);
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([percentUserBasicAuth]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("bunfig registry percent-decodes the :token written into its URL", async () => {
    using capture = capturingRegistry();
    const encodedToken = Array.from(Buffer.from(authToken), byte => `%${byte.toString(16).padStart(2, "0")}`).join("");
    using dir = tempDir("config-precedence", {
      "project/bunfig.toml": bunfig({ registry: withUserinfo(capture, `:${encodedToken}`) }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([`Bearer ${authToken}`]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("BUN_CONFIG_TOKEN beats the _authToken in ~/.npmrc", async () => {
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "home/.npmrc": `registry=${capture.url}\n//localhost:${capture.port}/:_authToken=token-from-npmrc\n`,
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), [], { BUN_CONFIG_TOKEN: authToken });
    expect(stderr).not.toContain("error:");
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([`Bearer ${authToken}`]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test.each(["BUN_CONFIG_TOKEN", "NPM_CONFIG_TOKEN"])(
    "%s applies to the registry passed with --registry",
    async key => {
      using capture = capturingRegistry();
      using dir = tempDir("config-precedence", {
        "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
      });
      const { stderr, exitCode } = await install(String(dir), ["--registry", capture.url], { [key]: authToken });
      expect(stderr).not.toContain("error:");
      expect(new Set(capture.authorizations)).toStrictEqual(new Set([`Bearer ${authToken}`]));
      expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  test("--registry drops the _authToken of the .npmrc registry but keeps BUN_CONFIG_TOKEN", async () => {
    using dead = deadRegistry();
    using capture = capturingRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `registry=${dead.url}\n//localhost:${dead.server.port}/:_authToken=token-for-dead\n`,
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), ["--registry", capture.url], {
      BUN_CONFIG_TOKEN: authToken,
    });
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(new Set(capture.authorizations)).toStrictEqual(new Set([`Bearer ${authToken}`]));
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("NPM_CONFIG_REGISTRY beats registry= in project .npmrc", async () => {
    using dead = deadRegistry();
    using dir = tempDir("config-precedence", {
      "project/.npmrc": `registry=${dead.url}\n`,
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir), [], { NPM_CONFIG_REGISTRY: registry.registryUrl() });
    expect(stderr).not.toContain("error:");
    expect(dead.hits).toBe(0);
    expect(installed(String(dir), "no-deps")).toBe(true);
    expect(exitCode).toBe(0);
  });

  type Layer = (url: string) => Record<string, string>;
  const lastLayers: [name: string, args: (url: string) => string[], env: Layer, files: Layer][] = [
    ["BUN_CONFIG_REGISTRY", () => [], url => ({ BUN_CONFIG_REGISTRY: url }), () => ({})],
    ["NPM_CONFIG_REGISTRY", () => [], url => ({ NPM_CONFIG_REGISTRY: url }), () => ({})],
    ["BUN_CONFIG_REGISTRY in .env", () => [], () => ({}), url => ({ "project/.env": `BUN_CONFIG_REGISTRY=${url}\n` })],
    ["--registry", url => [`--registry=${url}`], () => ({}), () => ({})],
  ];

  test.each(lastLayers)(
    "a scope with an empty registry URL is at the default registry from %s",
    async (_, args, env, files) => {
      using dead = deadRegistry();
      const url = registry.registryUrl();
      using dir = tempDir("config-precedence", {
        "project/.npmrc": `registry=${dead.url}\n@types:registry=\${EMPTY_URL}\n`,
        "project/package.json": packageJson({ "@types/no-deps": "1.0.0" }),
        ...files(url),
      });
      const { stderr, exitCode } = await install(String(dir), args(url), { ...env(url), EMPTY_URL: "" });
      expect(stderr).not.toContain("error:");
      expect(dead.hits).toBe(0);
      expect(installed(String(dir), "@types", "no-deps")).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  test.each(lastLayers)(
    "a scope with a token and no URL stays at the configured registry when %s points to another host",
    async (_, args, env, files) => {
      using configured = capturingRegistry();
      using other = capturingRegistry();
      using dir = tempDir("config-precedence", {
        "project/bunfig.toml": bunfig({ registry: configured.url, scopes: { "needs-auth": { token: authToken } } }),
        "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0", "no-deps": "1.0.0" }),
        ...files(other.url),
      });
      const { stderr, exitCode } = await install(String(dir), args(other.url), env(other.url));
      expect(stderr).not.toContain("error:");
      // The scope's package, with its token. The other host sees neither.
      expect(new Set(configured.authorizations)).toStrictEqual(new Set([`Bearer ${authToken}`]));
      expect(other.authorizations).not.toBeEmpty();
      expect(new Set(other.authorizations)).toStrictEqual(new Set([null]));
      expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
      expect(installed(String(dir), "no-deps")).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  test.each(lastLayers)(
    "a scope with a token and no URL keeps the token when %s names the configured registry",
    async (_, args, env, files) => {
      using capture = capturingRegistry();
      using dir = tempDir("config-precedence", {
        "project/bunfig.toml": bunfig({ registry: capture.url, scopes: { "needs-auth": { token: authToken } } }),
        "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0", "no-deps": "1.0.0" }),
        ...files(capture.url),
      });
      const { stderr, exitCode } = await install(String(dir), args(capture.url), env(capture.url));
      expect(stderr).not.toContain("error:");
      // The token is the scope's: the other package is asked for without it.
      expect([...new Set(capture.authorizations)].sort()).toEqual([`Bearer ${authToken}`, null]);
      expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
      expect(installed(String(dir), "no-deps")).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  test("a scope with an empty registry URL gets the credentials of the default registry", async () => {
    using dir = tempDir("config-precedence", {
      "project/.npmrc": "@needs-auth:registry=\n",
      "project/bunfig.toml": bunfig({ registry: { url: registry.registryUrl(), token: authToken } }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(installed(String(dir), "@needs-auth", "test-pkg")).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("directories named by config files", () => {
  // Only the config files and $HOME determine where things go.
  const noDirs = {
    BUN_INSTALL: undefined,
    BUN_INSTALL_BIN: undefined,
    BUN_INSTALL_GLOBAL_DIR: undefined,
    BUN_INSTALL_CACHE_DIR: undefined,
    XDG_CACHE_HOME: undefined,
  };
  const files = {
    "home/.keep": "",
    "project/package.json": JSON.stringify({ name: "project", version: "1.0.0", bin: { projectbin: "x.js" } }),
    "project/x.js": "#!/usr/bin/env node\n",
    "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", bin: { depbin: "x.js" } }),
    "dep/x.js": "#!/usr/bin/env node\n",
  };
  const globalDirs = (globalDir: string, globalBinDir: string) => bunfig({ globalDir, globalBinDir });
  const binNames = (dir: string) => readdirSync(dir).map(name => name.replace(/\.(exe|bunx)$/, ""));
  const ignored = (key: string, env: string) =>
    `warn: ignoring "${key}" in project bunfig.toml, set it in $HOME/.bunfig.toml or $${env}\n`;

  describe.each([
    ["$XDG_CONFIG_HOME/.bunfig.toml", "home/.bunfig.toml", [], {}],
    ["$HOME/.bunfig.toml", "home/.bunfig.toml", [], { XDG_CONFIG_HOME: undefined }],
    [
      "--config with an absolute path",
      "elsewhere/named.toml",
      (root: string) => join(root, "elsewhere/named.toml"),
      {},
    ],
    ["--config with a path relative to where bun was run", "project/named.toml", () => "named.toml", {}],
  ] as const)("globalDir and globalBinDir in %s", (_, path, config, env) => {
    const flags = (root: string) => (typeof config === "function" ? [`--config=${config(root)}`] : []);

    test.each([
      ["absolute paths", (root: string) => globalDirs(join(root, "home", "g"), join(root, "home", "b"))],
      ["~/ paths", () => globalDirs("~/g", "~/b")],
      ["paths relative to the file", () => globalDirs("../home/g", "../home/b")],
    ])("%s: -g installs there", async (_, config) => {
      using dir = tempDir("config-global-dir", files);
      const root = String(dir);
      await Bun.write(join(root, path), config(root));

      const added = await run(root, ["add", "-g", ...flags(root), join(root, "dep")], { ...noDirs, ...env });
      expect(added.stderr).not.toContain("error:");
      expect(added.stdout).toContain("installed dep@");
      expect(
        Object.keys(JSON.parse(readFileSync(join(root, "home", "g", "package.json"), "utf8")).dependencies),
      ).toEqual(["dep"]);
      expect(existsSync(join(root, "home", "g", "node_modules", "dep", "package.json"))).toBe(true);
      expect(binNames(join(root, "home", "b"))).toContain("depbin");
      expect(existsSync(join(root, "home", ".bun", "install", "global"))).toBe(false);
      expect(existsSync(join(root, "home", ".bun", "bin"))).toBe(false);
      expect(await readdirSorted(join(root, "project"))).toEqual(
        path.startsWith("project/") ? ["named.toml", "package.json", "x.js"] : ["package.json", "x.js"],
      );
      expect(added.exitCode).toBe(0);

      // the other -g commands look in the same place
      const listed = await run(root, ["pm", "ls", "-g", ...flags(root)], { ...noDirs, ...env });
      expect(listed.stdout).toContain("dep@");
      expect(listed.exitCode).toBe(0);
    });
  });

  // It comes with the project, and a project doesn't get to decide where this user's global packages live.
  describe("globalDir and globalBinDir in ./bunfig.toml", () => {
    const project = () =>
      tempDir("config-global-dir-project", {
        ...files,
        // `bun link` replaces what has the name of a bin in the global bin folder
        "victim/b/projectbin": "not a bin",
        "victim/b/depbin": "not a bin",
      });
    const writeProjectBunfig = (root: string) =>
      Bun.write(join(root, "project", "bunfig.toml"), globalDirs(join(root, "victim", "g"), join(root, "victim", "b")));
    const expectVictimUntouched = async (root: string) => {
      expect(await readdirSorted(join(root, "victim"))).toEqual(["b"]);
      expect(await readdirSorted(join(root, "victim", "b"))).toEqual(["depbin", "projectbin"]);
      expect(readFileSync(join(root, "victim", "b", "projectbin"), "utf8")).toBe("not a bin");
      expect(readFileSync(join(root, "victim", "b", "depbin"), "utf8")).toBe("not a bin");
    };

    test.each([["link"], ["unlink"], ["install"]])("bun %s ignores them with a warning", async subcommand => {
      using dir = project();
      const root = String(dir);
      await writeProjectBunfig(root);

      const { stderr, exitCode } = await run(root, [subcommand], noDirs);
      expect(stderr).not.toContain("error:");
      expect(stderr).toContain(ignored("globalDir", "BUN_INSTALL_GLOBAL_DIR"));
      expect(stderr).toContain(ignored("globalBinDir", "BUN_INSTALL_BIN"));
      expect(stderr).toContain("bunfig.toml:2:");
      expect(stderr).toContain("bunfig.toml:3:");
      await expectVictimUntouched(root);
      if (subcommand === "link") {
        expect(await readdirSorted(join(root, "home", ".bun", "install", "global", "node_modules"))).toEqual([
          "project",
        ]);
        expect(binNames(join(root, "home", ".bun", "bin"))).toContain("projectbin");
      }
      expect(exitCode).toBe(0);
    });

    test("--silent hides the warning", async () => {
      using dir = project();
      await writeProjectBunfig(String(dir));
      expect(await run(String(dir), ["link", "--silent"], noDirs)).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      await expectVictimUntouched(String(dir));
    });

    test("bun run does not warn", async () => {
      using dir = project();
      await writeProjectBunfig(String(dir));
      expect(await run(String(dir), ["run", "x.js"], noDirs)).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    });

    test("-g does not read the file", async () => {
      using dir = project();
      const root = String(dir);
      await writeProjectBunfig(root);

      const { stderr, exitCode } = await run(root, ["add", "-g", join(root, "dep")], noDirs);
      expect(stderr).not.toContain("error:");
      expect(stderr).not.toContain("ignoring");
      await expectVictimUntouched(root);
      expect(existsSync(join(root, "home", ".bun", "install", "global", "node_modules", "dep", "package.json"))).toBe(
        true,
      );
      expect(binNames(join(root, "home", ".bun", "bin"))).toContain("depbin");
      expect(exitCode).toBe(0);
    });

    test("are honored when the file is passed with --config", async () => {
      using dir = tempDir("config-global-dir-named", files);
      const root = String(dir);
      await Bun.write(join(root, "project", "bunfig.toml"), globalDirs(join(root, "g"), join(root, "b")));

      const { stderr, exitCode } = await run(root, ["link", "--config=bunfig.toml"], noDirs);
      expect(stderr).toBe("");
      expect(await readdirSorted(join(root, "g", "node_modules"))).toEqual(["project"]);
      expect(binNames(join(root, "b"))).toContain("projectbin");
      expect(existsSync(join(root, "home", ".bun"))).toBe(false);
      expect(exitCode).toBe(0);
    });
  });

  describe("a leading ~ is $HOME", () => {
    test.each([
      ["bunfig.toml cache.dir", "~/c", { "project/bunfig.toml": bunfig({ cache: { dir: "~/c" } }) }, ["home", "c"]],
      ["bunfig.toml cache.dir", "~", { "project/bunfig.toml": bunfig({ cache: { dir: "~" } }) }, ["home"]],
      ["bunfig.toml cache", "~/c", { "project/bunfig.toml": bunfig({ cache: "~/c" }) }, ["home", "c"]],
      [".npmrc cache", "~/c", { "project/.npmrc": "cache=~/c\n" }, ["home", "c"]],
      // another user's home, which bun does not look up
      [
        "bunfig.toml cache.dir",
        "~user/c",
        { "project/bunfig.toml": bunfig({ cache: { dir: "~user/c" } }) },
        ["project", "~user", "c"],
      ],
    ])("%s = %j", async (_, __, config, expected) => {
      using dir = tempDir("config-tilde-cache", { ...files, ...config });
      expect(await run(String(dir), ["pm", "cache"], noDirs)).toEqual({
        stdout: join(String(dir), ...expected),
        stderr: "",
        exitCode: 0,
      });
      expect(existsSync(join(String(dir), "project", "~"))).toBe(false);
    });

    test.each([
      ["bunfig.toml", { "project/bunfig.toml": bunfig({ registry: "https://localhost:1/", cafile: "~/missing.pem" }) }],
      [".npmrc", { "project/.npmrc": "registry=https://localhost:1/\ncafile=~/missing.pem\n" }],
    ])("%s cafile", async (_, config) => {
      using dir = tempDir("config-tilde-cafile", { ...files, ...config });
      const { stderr, exitCode } = await run(String(dir), ["add", "no-deps"], noDirs);
      // The HTTP thread prints this and exits; the main thread may get "Resolving dependencies" out first.
      // What follows the ~ is appended as written.
      expect(stderr).toContain(`HTTPThread: could not find CA file: '${join(String(dir), "home")}/missing.pem'\n`);
      expect(exitCode).toBe(1);
    });

    test.each([
      ["--cache-dir", ["--cache-dir=~/c"], {}, ["c"]],
      ["$BUN_INSTALL_CACHE_DIR", [], { BUN_INSTALL_CACHE_DIR: "~/c" }, ["c"]],
      ["$BUN_INSTALL", [], { BUN_INSTALL: "~/c" }, ["c", "install", "cache"]],
      ["$XDG_CACHE_HOME", [], { XDG_CACHE_HOME: "~/c" }, ["c", ".bun", "install", "cache"]],
    ])("%s", async (_, args, env, expected) => {
      using dir = tempDir("config-tilde-typed", files);
      expect(await run(String(dir), ["pm", "cache", ...args], { ...noDirs, ...env })).toEqual({
        stdout: join(String(dir), "home", ...expected),
        stderr: "",
        exitCode: 0,
      });
    });

    test.each([
      [{ BUN_INSTALL: "~/c" }, ["c"]],
      [{ XDG_CACHE_HOME: "~/c" }, ["c", ".bun"]],
    ])("-g installs below %j", async (env, expected) => {
      using dir = tempDir("config-tilde-global", files);
      const root = String(dir);
      const { stderr, exitCode } = await run(root, ["add", "-g", join(root, "dep")], { ...noDirs, ...env });
      expect(stderr).not.toContain("error:");
      expect(await readdirSorted(join(root, "home", ...expected, "install", "global", "node_modules"))).toContain(
        "dep",
      );
      expect(binNames(join(root, "home", ...expected, "bin"))).toContain("depbin");
      expect(exitCode).toBe(0);
    });
  });

  // Bun changes to the project's root before it reads most of these.
  describe.each(["project/packages/app", "project/src"])("relative paths, with bun run in %s", cwd => {
    const workspace = {
      "home/.keep": "",
      "project/package.json": JSON.stringify({ name: "project", version: "1.0.0", workspaces: ["packages/*"] }),
      "project/packages/app/package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
      "project/src/.keep": "",
    };
    const unreachable = "https://localhost:1/";

    test.each([
      ["./bunfig.toml cache.dir", { "project/bunfig.toml": bunfig({ cache: { dir: "./c" } }) }, [], "project/c"],
      ["./.npmrc cache", { "project/.npmrc": "cache=./c\n" }, [], "project/c"],
      ["~/.bunfig.toml cache.dir", { "home/.bunfig.toml": bunfig({ cache: { dir: "c" } }) }, [], "home/c"],
      ["~/.bunfig.toml cache", { "home/.bunfig.toml": bunfig({ cache: "c" }) }, [], "home/c"],
      ["~/.npmrc cache", { "home/.npmrc": "cache=c\n" }, [], "home/c"],
      ["--config cache.dir", { "ci/ci.toml": bunfig({ cache: { dir: "c" } }) }, ["--config=/ci/ci.toml"], "ci/c"],
    ])("%s starts at the file", async (_, config, args, expected) => {
      using dir = tempDir("config-relative-cache", { ...workspace, ...config });
      const flags = args.map(arg => arg.replace("=/", `=${dir}/`));
      expect(await run(String(dir), ["pm", "cache", ...flags], noDirs, cwd)).toEqual({
        stdout: join(String(dir), expected),
        stderr: "",
        exitCode: 0,
      });
    });

    test.each([
      ["--cache-dir", "--cache-dir=./c"],
      ["--config", "--config=./ci.toml"],
    ])("%s starts where bun is run", async (_, flag) => {
      using dir = tempDir("config-relative-typed", {
        ...workspace,
        "project/ci.toml": bunfig({ cache: { dir: "the-file-at-the-root" } }),
        [`${cwd}/ci.toml`]: bunfig({ cache: { dir: "c" } }),
      });
      expect(await run(String(dir), ["pm", "cache", flag], noDirs, cwd)).toEqual({
        stdout: join(String(dir), cwd, "c"),
        stderr: "",
        exitCode: 0,
      });
    });

    // CI sets it once for the whole repository, and saves that one folder.
    test("$BUN_INSTALL_CACHE_DIR starts at the project's root", async () => {
      using dir = tempDir("config-relative-env", workspace);
      expect(await run(String(dir), ["pm", "cache"], { ...noDirs, BUN_INSTALL_CACHE_DIR: ".c" }, cwd)).toEqual({
        stdout: join(String(dir), "project", ".c"),
        stderr: "",
        exitCode: 0,
      });
    });

    test.each([
      [
        "./bunfig.toml",
        { "project/bunfig.toml": bunfig({ registry: unreachable, cafile: "ca/x.pem" }) },
        [],
        "project",
      ],
      ["./.npmrc", { "project/.npmrc": `registry=${unreachable}\ncafile=ca/x.pem\n` }, [], "project"],
      ["~/.npmrc", { "home/.npmrc": `registry=${unreachable}\ncafile=ca/x.pem\n` }, [], "home"],
      ["--cafile", {}, [`--registry=${unreachable}`, "--cafile=ca/x.pem"], cwd],
      ["--cafile with -g", {}, ["-g", `--registry=${unreachable}`, "--cafile=ca/x.pem"], cwd],
    ])("cafile: %s", async (_, config, args, base) => {
      using dir = tempDir("config-relative-cafile", { ...workspace, ...config });
      const { stderr, exitCode } = await run(String(dir), ["add", "no-deps", ...args], noDirs, cwd);
      expect(stderr).toContain(`HTTPThread: could not find CA file: '${join(String(dir), base, "ca", "x.pem")}'\n`);
      expect(exitCode).toBe(1);
    });
  });
});
