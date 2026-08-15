import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { VerdaccioRegistry, bunEnv, bunExe, readdirSorted, tempDir } from "harness";
import { join } from "path";

// Own config dir: other install files' VerdaccioRegistry start()/stop() delete the shared htpasswd, invalidating our token.
const sharedRegistryDir = join(import.meta.dir, "registry");
const sharedVerdaccioConfig = readFileSync(join(sharedRegistryDir, "verdaccio.yaml"), "utf8");
if (!sharedVerdaccioConfig.includes("storage: ./packages")) {
  throw new Error("registry/verdaccio.yaml no longer has a 'storage: ./packages' line to redirect");
}
const registryDir = tempDir("config-precedence-registry", {
  "verdaccio.yaml": sharedVerdaccioConfig.replace(
    "storage: ./packages",
    `storage: ${JSON.stringify(join(sharedRegistryDir, "packages"))}`,
  ),
});
const registry = new VerdaccioRegistry({ configPath: join(String(registryDir), "verdaccio.yaml") });
let authToken: string;

beforeAll(async () => {
  await registry.start();
  authToken = await registry.generateUser("config-precedence", "verysecure");
});

afterAll(() => {
  registry.stop();
  registryDir[Symbol.dispose]();
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

/** Forwards to verdaccio while recording every Authorization header it receives. */
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

async function run(root: string, cmd: string[], env: Record<string, string | undefined> = {}) {
  const home = join(root, "home");
  const fullEnv: Record<string, string | undefined> = {
    ...bunEnv,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    BUN_INSTALL_CACHE_DIR: join(root, "cache"),
    ...env,
  };
  for (const key in fullEnv) if (fullEnv[key] === undefined) delete fullEnv[key];
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd: join(root, "project"),
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
      "no-deps@1.0.0@@localhost@@@1",
    ]);
    expect(existsSync(join(String(dir), "npmrc-cache"))).toBe(false);
    expect(installed(String(dir), "no-deps")).toBe(true);
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
});
