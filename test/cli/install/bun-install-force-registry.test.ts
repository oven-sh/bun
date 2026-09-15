import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

type Registry = {
  server: ReturnType<typeof Bun.serve>;
  hits: string[];
  auth: (string | null)[];
  url: string;
  // `url` without the trailing slash, which is how the notice prints it.
  origin: string;
};

function makeRegistry(): Registry {
  const hits: string[] = [];
  const auth: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      hits.push(new URL(req.url).pathname);
      auth.push(req.headers.get("authorization"));
      // A 404 is enough: the tests only check which registry bun contacts, and with which header.
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const origin = `http://localhost:${server.port}`;
  return { server, hits, auth, url: `${origin}/`, origin };
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
    // The note tells the developer why the project's `install.registry` has no effect.
    expect(stderr).toContain(
      `using forced registry ${forced.origin} (install.forceRegistry is set on this machine, ignoring other registry configuration)`,
    );
  });

  test("no notice when forceRegistry is not overriding anything", async () => {
    const forced = makeRegistry();
    await using _f = forced.server;

    using dir = tempDir("force-registry-no-override", {
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      // The project sets no registry, so there is nothing to override.
      "project/bunfig.toml": `[install]\ncache = false\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    const { stderr } = await runInstall(String(dir), makeEnv(String(dir)));

    expect(forced.hits).toEqual(["/no-deps"]);
    expect(stderr).not.toContain("using forced registry");
  });

  test("a project bunfig cannot set forceRegistry", async () => {
    const attacker = makeRegistry();
    const other = makeRegistry();
    await using _a = attacker.server;
    await using _o = other.server;

    using dir = tempDir("force-registry-project-scope", {
      "home/.keep": "",
      // No user bunfig and no environment variable: only the project names a forced registry.
      "project/bunfig.toml": `[install]\ncache = false\nregistry = "${other.url}"\nforceRegistry = "${attacker.url}"\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    const { stderr } = await runInstall(String(dir), makeEnv(String(dir)));

    expect({ attacker: attacker.hits, other: other.hits }).toEqual({
      attacker: [],
      other: ["/no-deps"],
    });
    expect(stderr).toContain(`"forceRegistry" is ignored in a project bunfig.toml`);
    expect(stderr).not.toContain("using forced registry");
  });

  test("a ~/.npmrc token keyed to another host does not reach the forced registry", async () => {
    const forced = makeRegistry();
    await using _f = forced.server;

    using dir = tempDir("force-registry-npmrc-token", {
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      // The default registry stays registry.npmjs.org, so this token loads into the default scope.
      "home/.npmrc": `//registry.npmjs.org/:_authToken=npm_publish_token_for_npmjs\n`,
      "project/bunfig.toml": `[install]\ncache = false\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    await runInstall(String(dir), makeEnv(String(dir)));

    expect(forced.hits).toEqual(["/no-deps"]);
    expect(forced.auth).toEqual([null]);
  });

  test("global bunfig forceRegistry cannot be changed by project bunfig forceRegistry", async () => {
    const forced = makeRegistry();
    const other = makeRegistry();
    await using _f = forced.server;
    await using _o = other.server;

    using dir = tempDir("force-registry-sticky", {
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      // The project tries to point forceRegistry somewhere else. Bun must ignore it.
      "project/bunfig.toml": `[install]\ncache = false\nforceRegistry = "${other.url}"\nregistry = "${other.url}"\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    const { stderr } = await runInstall(String(dir), makeEnv(String(dir)));

    expect({ forced: forced.hits, other: other.hits }).toEqual({
      forced: ["/no-deps"],
      other: [],
    });
    expect(stderr).toContain(`"forceRegistry" is ignored in a project bunfig.toml`);
  });

  test("project .env cannot inject BUN_CONFIG_FORCE_REGISTRY", async () => {
    const forced = makeRegistry();
    const other = makeRegistry();
    await using _f = forced.server;
    await using _o = other.server;

    using dir = tempDir("force-registry-dotenv", {
      "home/.bunfig.toml": `[install]\nforceRegistry = "${forced.url}"\n`,
      // A checked-in .env tries to replace the forced registry. Bun reads
      // BUN_CONFIG_FORCE_REGISTRY from the process environment only, so it must ignore this.
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

    const { stderr } = await runInstall(String(dir), makeEnv(String(dir)), ["--registry", other.url]);

    expect({ forced: forced.hits, other: other.hits }).toEqual({
      forced: ["/no-deps"],
      other: [],
    });
    // An explicit --registry that has no effect also gets the note.
    expect(stderr).toContain(`using forced registry ${forced.origin} (`);
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
      // The global bunfig sets a different forceRegistry. The environment variable must win.
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

  test("a BUN_CONFIG_FORCE_REGISTRY value that is not an http(s) URL fails the install", async () => {
    const other = makeRegistry();
    await using _o = other.server;

    using dir = tempDir("force-registry-env-invalid", {
      "home/.keep": "",
      "project/bunfig.toml": `[install]\ncache = false\nregistry = "${other.url}"\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    // The value has no scheme. Bun must not skip it and use the project registry.
    const { stderr, exitCode } = await runInstall(
      String(dir),
      makeEnv(String(dir), { BUN_CONFIG_FORCE_REGISTRY: `localhost:${other.server.port}/` }),
    );

    expect(stderr).toContain("BUN_CONFIG_FORCE_REGISTRY is set, but its value is not an http:// or https:// URL");
    expect(other.hits).toEqual([]);
    expect(exitCode).toBe(1);
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

  test("BUN_CONFIG_FORCE_REGISTRY sends credentials embedded in the URL and keeps them out of the output", async () => {
    const forced = makeRegistry();
    await using _f = forced.server;

    using dir = tempDir("force-registry-env-userinfo", {
      "home/.keep": "",
      // A project registry, so that the override notice prints the forced URL.
      "project/bunfig.toml": `[install]\ncache = false\nregistry = "http://localhost:1/"\n`,
      "project/package.json": JSON.stringify({ name: "test", dependencies: { "no-deps": "1.0.0" } }),
    });

    const { stderr } = await runInstall(
      String(dir),
      makeEnv(String(dir), {
        BUN_CONFIG_FORCE_REGISTRY: `http://corpuser:corppass@localhost:${forced.server.port}/`,
      }),
    );

    expect(forced.hits).toEqual(["/no-deps"]);
    expect(forced.auth).toEqual(["Basic " + Buffer.from("corpuser:corppass").toString("base64")]);
    // The notice and the 404 line both print the registry URL.
    expect(stderr).toContain(
      `using forced registry ${forced.origin} (BUN_CONFIG_FORCE_REGISTRY is set on this machine`,
    );
    expect(stderr).not.toContain("corppass");
  });

  test("string-form forceRegistry in bunfig preserves BUN_CONFIG_TOKEN", async () => {
    const forced = makeRegistry();
    await using _f = forced.server;

    using dir = tempDir("force-registry-bunfig-string-token", {
      // The string form carries no token, so BUN_CONFIG_TOKEN applies.
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
      // The project registry has a bearer token for a different host. The forced registry
      // has basic-auth of its own and must not take that token or BUN_CONFIG_TOKEN.
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
