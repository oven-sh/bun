import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { VerdaccioRegistry, bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Own config dir: other install files' VerdaccioRegistry start()/stop() delete the shared htpasswd, invalidating our token.
const sharedRegistryDir = join(import.meta.dir, "registry");
const registryDir = tempDir("config-precedence-registry", {
  "verdaccio.yaml": readFileSync(join(sharedRegistryDir, "verdaccio.yaml"), "utf8").replace(
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
const bunfig = (install: Record<string, unknown>) => Bun.TOML.stringify({ install });
const packageJson = (dependencies: Record<string, string>) =>
  JSON.stringify({ name: "config-precedence", version: "1.0.0", dependencies });

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

async function install(root: string, args: string[] = []) {
  const home = join(root, "home");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    cwd: join(root, "project"),
    env: {
      ...bunEnv,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: home,
      BUN_INSTALL_CACHE_DIR: join(root, "cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const isIsolated = (root: string) => existsSync(join(root, "project", "node_modules", ".bun"));

describe.concurrent("bun install config precedence", () => {
  test("project bunfig linker beats ~/.npmrc install-strategy", async () => {
    using dir = tempDir("config-precedence", {
      "home/.npmrc": "install-strategy=hoisted\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl(), linker: "isolated" }),
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(isIsolated(String(dir))).toBe(true);
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
    expect(exitCode).toBe(0);
    expect(dead.hits).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "no-deps", "package.json"))).toBe(true);
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
    expect(exitCode).toBe(0);
    expect(dead.hits).toBe(0);
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
    expect(exitCode).toBe(0);
    expect(dead.hits).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "no-deps", "package.json"))).toBe(true);
  });

  test("~/.npmrc _authToken applies to the registry set in project bunfig", async () => {
    using dir = tempDir("config-precedence", {
      "home/.npmrc": authLine(),
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl() }),
      "project/package.json": packageJson({ "@needs-auth/test-pkg": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "@needs-auth", "test-pkg", "package.json"))).toBe(
      true,
    );
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
    expect(exitCode).toBe(0);
    expect(dead.hits).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "@needs-auth", "test-pkg", "package.json"))).toBe(
      true,
    );
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
    expect(exitCode).toBe(0);
    expect(dead.hits).toBe(0);
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
    expect(exitCode).toBe(0);
    expect(dead.hits).toBe(0);
    expect(existsSync(join(String(dir), "project", "node_modules", "@types", "no-deps", "package.json"))).toBe(true);
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
    expect(exitCode).toBe(0);
    expect(isIsolated(String(dir))).toBe(true);
  });

  test("~/.npmrc install-strategy applies when bunfig does not set a linker", async () => {
    using dir = tempDir("config-precedence", {
      "home/.npmrc": "install-strategy=linked\n",
      "project/bunfig.toml": bunfig({ registry: registry.registryUrl() }),
      "project/package.json": packageJson({ "no-deps": "1.0.0" }),
    });
    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(isIsolated(String(dir))).toBe(true);
  });
});
