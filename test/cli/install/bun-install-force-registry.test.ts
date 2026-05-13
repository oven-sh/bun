import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

setDefaultTimeout(1000 * 60 * 5);

type Registry = {
  server: ReturnType<typeof Bun.serve>;
  hits: string[];
  auth: (string | null)[];
  url: string;
};

function makeRegistry(): Registry {
  const hits: string[] = [];
  const auth: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      hits.push(new URL(req.url).pathname);
      auth.push(req.headers.get("authorization"));
      // 404 is fine — we only care which registry was contacted.
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { server, hits, auth, url: `http://localhost:${server.port}/` };
}

function makeEnv(dir: string, extra: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    ...bunEnv,
    XDG_CONFIG_HOME: join(dir, "home"),
    HOME: join(dir, "home"),
    USERPROFILE: join(dir, "home"),
    BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache"),
    // Make sure nothing from the host leaks in.
    BUN_CONFIG_REGISTRY: undefined,
    NPM_CONFIG_REGISTRY: undefined,
    npm_config_registry: undefined,
    BUN_CONFIG_TOKEN: undefined,
    NPM_CONFIG_TOKEN: undefined,
    npm_config_token: undefined,
    BUN_CONFIG_FORCE_REGISTRY: undefined,
    ...extra,
  };
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key];
  }
  return env as Record<string, string>;
}

async function runInstall(dir: string, env: Record<string, string>, extraArgs: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...extraArgs],
    cwd: join(dir, "project"),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("install.forceRegistry", () => {
  test("global bunfig forceRegistry overrides local bunfig registry", async () => {
    const forced = makeRegistry();
    const other = makeRegistry();
    await using _f = forced.server;
    await using _o = other.server;

    using dir = tempDir("force-registry-local-bunfig", {
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      "project/bunfig.toml": `[install]\ncache = false\nregistry = "${other.url}"\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    const { stderr } = await runInstall(String(dir), makeEnv(String(dir)));

    expect({ forced: forced.hits, other: other.hits }).toEqual({
      forced: ["/no-deps"],
      other: [],
    });
    // Surface that the device-level override is active so the developer
    // isn't confused why their project `install.registry` didn't apply.
    expect(stderr).toContain(`using forced registry ${forced.url}`);
    expect(stderr).toContain("install.forceRegistry is set on this machine");
  });

  test("no notice when forceRegistry is not overriding anything", async () => {
    const forced = makeRegistry();
    await using _f = forced.server;

    using dir = tempDir("force-registry-no-override", {
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      // Project has no custom registry — nothing is being overridden.
      "project/bunfig.toml": `[install]\ncache = false\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    const { stderr } = await runInstall(String(dir), makeEnv(String(dir)));

    expect(forced.hits).toEqual(["/no-deps"]);
    expect(stderr).not.toContain("using forced registry");
  });

  test("global bunfig forceRegistry cannot be changed by project bunfig forceRegistry", async () => {
    const forced = makeRegistry();
    const other = makeRegistry();
    await using _f = forced.server;
    await using _o = other.server;

    using dir = tempDir("force-registry-sticky", {
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      // Project tries to point forceRegistry elsewhere — must be ignored.
      "project/bunfig.toml": `[install]\ncache = false\nforceRegistry = "${other.url}"\nregistry = "${other.url}"\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    await runInstall(String(dir), makeEnv(String(dir)));

    expect({ forced: forced.hits, other: other.hits }).toEqual({
      forced: ["/no-deps"],
      other: [],
    });
  });

  test("project .env cannot inject BUN_CONFIG_FORCE_REGISTRY", async () => {
    const forced = makeRegistry();
    const other = makeRegistry();
    await using _f = forced.server;
    await using _o = other.server;

    using dir = tempDir("force-registry-dotenv", {
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      // A checked-in .env tries to hijack the forced registry. Must be
      // ignored — BUN_CONFIG_FORCE_REGISTRY is read from the real process
      // environment only, not the DotEnv loader.
      "project/.env": `BUN_CONFIG_FORCE_REGISTRY=${other.url}\n`,
      "project/bunfig.toml": `[install]\ncache = false\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    await runInstall(String(dir), makeEnv(String(dir)));

    expect({ forced: forced.hits, other: other.hits }).toEqual({
      forced: ["/no-deps"],
      other: [],
    });
  });

  test("global bunfig forceRegistry overrides .npmrc scoped registry", async () => {
    const forced = makeRegistry();
    const other = makeRegistry();
    await using _f = forced.server;
    await using _o = other.server;

    using dir = tempDir("force-registry-scoped", {
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      "project/.npmrc": `registry=${other.url}\n@scoped:registry=${other.url}\n`,
      "project/bunfig.toml": `[install]\ncache = false\n`,
      "project/package.json": JSON.stringify({
        name: "test",
        dependencies: { "@scoped/pkg": "1.0.0" },
      }),
    });

    await runInstall(String(dir), makeEnv(String(dir)));

    expect({ forced: forced.hits, other: other.hits }).toEqual({
      forced: ["/@scoped%2fpkg"],
      other: [],
    });
  });

  test("global bunfig forceRegistry overrides --registry CLI flag", async () => {
    const forced = makeRegistry();
    const other = makeRegistry();
    await using _f = forced.server;
    await using _o = other.server;

    using dir = tempDir("force-registry-cli", {
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      "project/bunfig.toml": `[install]\ncache = false\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    await runInstall(String(dir), makeEnv(String(dir)), ["--registry", other.url]);

    expect({ forced: forced.hits, other: other.hits }).toEqual({
      forced: ["/no-deps"],
      other: [],
    });
  });

  test("global bunfig forceRegistry overrides NPM_CONFIG_REGISTRY", async () => {
    const forced = makeRegistry();
    const other = makeRegistry();
    await using _f = forced.server;
    await using _o = other.server;

    using dir = tempDir("force-registry-envreg", {
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      "project/bunfig.toml": `[install]\ncache = false\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    await runInstall(String(dir), makeEnv(String(dir), { NPM_CONFIG_REGISTRY: other.url }));

    expect({ forced: forced.hits, other: other.hits }).toEqual({
      forced: ["/no-deps"],
      other: [],
    });
  });

  test("BUN_CONFIG_FORCE_REGISTRY env var overrides everything", async () => {
    const forced = makeRegistry();
    const other = makeRegistry();
    await using _f = forced.server;
    await using _o = other.server;

    using dir = tempDir("force-registry-envforce", {
      // Global bunfig sets a *different* forceRegistry — env var must win.
      "home/.bunfig.toml": `[install]\nforceRegistry = "${other.url}"\n`,
      "project/bunfig.toml": `[install]\ncache = false\nregistry = "${other.url}"\n[install.scopes]\nscoped = "${other.url}"\n`,
      "project/.npmrc": `registry=${other.url}\n@scoped:registry=${other.url}\n`,
      "project/package.json": JSON.stringify({
        name: "test",
        dependencies: { "no-deps": "1.0.0", "@scoped/pkg": "1.0.0" },
      }),
    });

    await runInstall(
      String(dir),
      makeEnv(String(dir), {
        BUN_CONFIG_FORCE_REGISTRY: forced.url,
        NPM_CONFIG_REGISTRY: other.url,
      }),
      ["--registry", other.url],
    );

    expect({ forced: forced.hits.sort(), other: other.hits }).toEqual({
      forced: ["/@scoped%2fpkg", "/no-deps"],
      other: [],
    });
  });

  test("BUN_CONFIG_FORCE_REGISTRY preserves BUN_CONFIG_TOKEN", async () => {
    const forced = makeRegistry();
    await using _f = forced.server;

    using dir = tempDir("force-registry-token", {
      "home/.keep": "",
      "project/bunfig.toml": `[install]\ncache = false\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    await runInstall(
      String(dir),
      makeEnv(String(dir), {
        BUN_CONFIG_FORCE_REGISTRY: forced.url,
        BUN_CONFIG_TOKEN: "corp-token-123",
      }),
    );

    expect(forced.hits).toEqual(["/no-deps"]);
    expect(forced.auth).toEqual(["Bearer corp-token-123"]);
  });

  test("string-form forceRegistry in bunfig preserves BUN_CONFIG_TOKEN", async () => {
    const forced = makeRegistry();
    await using _f = forced.server;

    using dir = tempDir("force-registry-bunfig-string-token", {
      // URL-only string form — token should fall back to BUN_CONFIG_TOKEN.
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      "project/bunfig.toml": `[install]\ncache = false\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    await runInstall(
      String(dir),
      makeEnv(String(dir), {
        BUN_CONFIG_TOKEN: "corp-token-789",
      }),
    );

    expect(forced.hits).toEqual(["/no-deps"]);
    expect(forced.auth).toEqual(["Bearer corp-token-789"]);
  });

  test("forceRegistry object carries its own token", async () => {
    const forced = makeRegistry();
    const other = makeRegistry();
    await using _f = forced.server;
    await using _o = other.server;

    using dir = tempDir("force-registry-obj-token", {
      "home/.bunfig.toml": `[install]\nforceRegistry = { url = "${forced.url}", token = "corp-token-456" }\n`,
      "project/bunfig.toml": `[install]\ncache = false\nregistry = { url = "${other.url}", token = "project-token" }\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    await runInstall(String(dir), makeEnv(String(dir)));

    expect({ forced: forced.hits, other: other.hits }).toEqual({
      forced: ["/no-deps"],
      other: [],
    });
    expect(forced.auth).toEqual(["Bearer corp-token-456"]);
  });

  test("forceRegistry with basic-auth is not clobbered by an unrelated token", async () => {
    const forced = makeRegistry();
    await using _f = forced.server;

    using dir = tempDir("force-registry-basic-auth", {
      "home/.bunfig.toml": `[install]\nforceRegistry = { url = "${forced.url}", username = "corpuser", password = "corppass" }\n`,
      // Project config carries a bearer token for a different host — must
      // NOT be inherited by the forced registry's basic-auth.
      "project/bunfig.toml": `[install]\ncache = false\nregistry = { url = "http://localhost:1/", token = "project-token" }\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    await runInstall(
      String(dir),
      makeEnv(String(dir), {
        BUN_CONFIG_TOKEN: "developer-npmjs-token",
      }),
    );

    expect(forced.hits).toEqual(["/no-deps"]);
    expect(forced.auth).toEqual(["Basic " + Buffer.from("corpuser:corppass").toString("base64")]);
  });
});
