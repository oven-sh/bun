import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync } from "fs";
import { bunEnv, bunExe, directoryPathOfLength, isASAN, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { mkfifo } from "mkfifo";
import { join } from "path";

//   --install=<val>                 Configure auto-install behavior. One of "auto" (default, auto-installs when no node_modules), "fallback" (missing packages only), "force" (always).
//   -i                              Auto-install dependencies during execution. Equivalent to --install=fallback.

describe("basic autoinstall", () => {
  for (const install of ["", "-i", "--install=auto", "--install=fallback", "--install=force"]) {
    for (const has_node_modules of [true, false]) {
      let should_install = false;
      if (has_node_modules) {
        if (install === "" || install === "--install=auto") {
          should_install = false;
        } else {
          should_install = true;
        }
      } else {
        should_install = true;
      }

      test(`${install || "<no flag>"} ${has_node_modules ? "with" : "without"} node_modules ${should_install ? "should" : "should not"} autoinstall`, async () => {
        const dir = tmpdirSync();
        mkdirSync(dir, { recursive: true });
        await Bun.write(join(dir, "index.js"), "import isEven from 'is-even'; console.log(isEven(2));");
        const env = bunEnv;
        env.BUN_INSTALL = install;
        if (has_node_modules) {
          mkdirSync(join(dir, "node_modules/abc"), { recursive: true });
        }
        const { stdout, stderr } = Bun.spawnSync({
          cmd: [bunExe(), ...(install === "" ? [] : [install]), join(dir, "index.js")],
          cwd: dir,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });

        if (should_install) {
          expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-even'");
          expect(stdout?.toString("utf8")).toBe("true\n");
        } else {
          expect(stderr?.toString("utf8")).toContain("error: Cannot find package 'is-even'");
        }
      });
    }
  }
});

// In auto-install mode the project's own package.json is the lockfile's root
// package (resolution tag `root`, not `npm`). With a name and an exact version
// present, resolving any missing bare specifier used to read that resolution
// through the npm union accessor: "assertion failed: self.tag == Tag::Npm".
test("auto-install in a project whose package.json has a name and version", async () => {
  const requests: string[] = [];
  using registry = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });

  using dir = tempDir("autoinstall-root-name-version", {
    "package.json": JSON.stringify({ name: "myapp", version: "1.0.0" }),
    "index.js": `import "pkg-that-does-not-exist-anywhere";\n`,
    "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The resolver must get as far as asking the (local) registry for the
  // missing package, then report it as missing instead of dying while
  // re-parsing the project's own package.json.
  expect(requests).toContain("/pkg-that-does-not-exist-anywhere");
  expect(stderr).toContain("Cannot find package 'pkg-that-does-not-exist-anywhere'");
  expect(exitCode).toBe(1);
});

test("--install=fallback to install missing packages", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  await Promise.all([
    Bun.write(
      join(dir, "index.js"),
      "import isEven from 'is-even'; import isOdd from 'is-odd'; console.log(isEven(2), isOdd(2));",
    ),
    Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: {
          "is-odd": "1.0.0",
        },
      }),
    ),
  ]);

  Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
  });

  const { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "--install=fallback", join(dir, "index.js")],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-odd'");
  expect(stdout?.toString("utf8")).toBe("true false\n");
});

// https://github.com/oven-sh/bun/issues/14378: `bun install` routed `@corp/*`
// to the registry that `.npmrc` names, but the runtime's auto-install read
// only bunfig.toml and asked the default registry.
describe("auto-install reads the registries and credentials of .npmrc", () => {
  // An ASAN build starts too slowly to run all of these at once within the default timeout.
  const cell = test.concurrentIf(!isASAN);
  const token = "SECRET-TOKEN";

  type Seen = { registry: string; path: string; authorization: string | null };
  type Registries = { PRIVATE: string; DEFAULT: string };
  type Files = Record<string, string>;

  // Three packages at 1.0.0. Each one exports the name of the registry it came from.
  async function buildPackages(registry: string) {
    const packages: Record<string, { index: string; dependencies?: Record<string, string> }> = {
      "@corp/thing": { index: `module.exports = globalThis.servedBy = ${JSON.stringify(registry)};\n` },
      "plain-thing": { index: `module.exports = ${JSON.stringify(registry)};\n` },
      "@corp/with-dep": {
        index: `module.exports = ${JSON.stringify(registry)} + " " + require("plain-thing");\n`,
        dependencies: { "plain-thing": "1.0.0" },
      },
    };
    return Promise.all(
      Object.entries(packages).map(async ([name, { index, dependencies }]) => {
        const manifest = { name, version: "1.0.0", main: "index.js", dependencies };
        const tarball = await new Bun.Archive({
          "package/package.json": JSON.stringify(manifest),
          "package/index.js": index,
        }).bytes("gzip");
        const integrity = "sha512-" + new Bun.CryptoHasher("sha512").update(tarball).digest("base64");
        return { name, manifest, tarball, integrity, tarballPath: `/${name}/-/${name.split("/").pop()}-1.0.0.tgz` };
      }),
    );
  }
  const built = { PRIVATE: buildPackages("PRIVATE"), DEFAULT: buildPackages("DEFAULT") };

  async function serveRegistry(registry: keyof typeof built, seen: Seen[]) {
    const packages = await built[registry];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const path = URL.canParse(req.url) ? decodeURIComponent(new URL(req.url).pathname) : req.url;
        seen.push({ registry, path, authorization: req.headers.get("authorization") });
        for (const { name, manifest, tarball, integrity, tarballPath } of packages) {
          if (path === tarballPath) return new Response(tarball);
          if (path !== "/" + name) continue;
          const dist = { tarball: new URL(tarballPath, server.url).href, integrity };
          return Response.json({
            name,
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { ...manifest, dist } },
          });
        }
        return new Response("{}", { status: 404 });
      },
    });
    return server;
  }

  // Runs bun in `<dir>/app` with `<dir>/home` as the home directory. Both
  // registries serve the packages, and `BUN_CONFIG_REGISTRY` makes DEFAULT the
  // default registry, so only the `.npmrc` under test can lead to PRIVATE.
  async function autoInstall(options: {
    args: string[];
    files: (registries: Registries) => Files;
    env?: (registries: Registries, dir: string) => Record<string, string | undefined>;
    prepare?: (dir: string) => void;
    cwd?: (dir: string) => string;
    timeout?: number;
  }) {
    const seen: Seen[] = [];
    await using privateRegistry = await serveRegistry("PRIVATE", seen);
    await using defaultRegistry = await serveRegistry("DEFAULT", seen);
    const registries = { PRIVATE: privateRegistry.url.host, DEFAULT: defaultRegistry.url.host };

    using dir = tempDir("autoinstall-npmrc", { "home/.keep": "", ...options.files(registries) });
    const home = join(String(dir), "home");
    const env: Record<string, string | undefined> = {
      ...bunEnv,
      // bunEnv spreads process.env, and CI runners export some of these.
      XDG_CONFIG_HOME: undefined,
      NPM_CONFIG_REGISTRY: undefined,
      npm_config_registry: undefined,
      BUN_CONFIG_TOKEN: undefined,
      NPM_CONFIG_TOKEN: undefined,
      npm_config_token: undefined,
      HOME: home,
      USERPROFILE: home,
      BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
      BUN_CONFIG_REGISTRY: `http://${registries.DEFAULT}/`,
      ...options.env?.(registries, String(dir)),
    };
    options.prepare?.(String(dir));

    await using proc = Bun.spawn({
      cmd: [bunExe(), ...options.args],
      cwd: options.cwd?.(String(dir)) ?? join(String(dir), "app"),
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeout,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const created = readdirSync(String(dir)).sort();
    return { stdout, stderr, seen, created, exitCode, signalCode: proc.signalCode };
  }

  const requests = (registry: string, pkg: string, authorization: string | null): Seen[] => [
    { registry, path: `/${pkg}`, authorization },
    { registry, path: `/${pkg}/-/${pkg.split("/").pop()}-1.0.0.tgz`, authorization },
  ];
  const fromPrivateRegistry = {
    stdout: "PRIVATE\n",
    stderr: "",
    seen: requests("PRIVATE", "@corp/thing", `Bearer ${token}`),
    created: ["app", "cache", "home"],
    exitCode: 0,
    signalCode: null,
  };

  const scopeAndToken = (r: Registries) => `@corp:registry=http://${r.PRIVATE}/\n//${r.PRIVATE}/:_authToken=${token}\n`;
  const importIt = `import servedBy from "@corp/thing";\nconsole.log(servedBy);\n`;
  const importLater = `const { default: servedBy } = await import("@corp/thing");\nconsole.log(servedBy);\n`;
  const inNodeModules = {
    "app/node_modules/@corp/thing/package.json": JSON.stringify({ name: "@corp/thing", version: "1.0.0" }),
    "app/node_modules/@corp/thing/index.js": `module.exports = "node_modules";\n`,
  };

  cell.each([
    ["bun <file>", ["x.mjs"], { "app/x.mjs": importIt }],
    ["bun -i <file>", ["-i", "x.mjs"], { "app/x.mjs": importIt }],
    ["bun -e", ["-e", importIt], {}],
    ["require()", ["x.cjs"], { "app/x.cjs": `console.log(require("@corp/thing"));\n` }],
    [
      "Bun.resolveSync()",
      ["x.cjs"],
      { "app/x.cjs": `console.log(require(Bun.resolveSync("@corp/thing", __dirname)));\n` },
    ],
    ["--preload", ["--preload", "@corp/thing", "x.mjs"], { "app/x.mjs": `console.log(globalThis.servedBy);\n` }],
  ] as [string, string[], Files][])("./.npmrc scope and token: %s", async (_, args, files) => {
    const result = await autoInstall({ args, files: r => ({ "app/.npmrc": scopeAndToken(r), ...files }) });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("./.npmrc scope and token beside a bunfig.toml that sets no registry", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": scopeAndToken(r),
        "app/bunfig.toml": `[install]\nexact = true\n`,
        "app/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("~/.npmrc scope and token", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({ "home/.npmrc": scopeAndToken(r), "app/x.mjs": importIt }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("$XDG_CONFIG_HOME/.npmrc scope and token, in place of ~/.npmrc", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "xdg/.npmrc": scopeAndToken(r),
        "home/.npmrc": `@corp:registry=http://${r.DEFAULT}/\n`,
        "app/x.mjs": importIt,
      }),
      env: (_, dir) => ({ XDG_CONFIG_HOME: join(dir, "xdg") }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, created: ["app", "cache", "home", "xdg"] });
  });

  cell("./.npmrc registry= and token", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": `registry=http://${r.PRIVATE}/\n//${r.PRIVATE}/:_authToken=${token}\n`,
        "app/x.mjs": importIt,
      }),
      // Without `registry=` the default registry is https://registry.npmjs.org/.
      // The proxy sends such a request to DEFAULT, not to the internet.
      env: r => ({ BUN_CONFIG_REGISTRY: undefined, HTTPS_PROXY: `http://${r.DEFAULT}/` }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  // The line `jsr add` writes: a scope with no trailing slash and no credential.
  cell("./.npmrc scope without a credential", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": `@corp:registry=http://${r.PRIVATE}\n`,
        "home/.npmrc": `//${r.DEFAULT}/:_authToken=${token}\n`,
        "app/x.mjs": importIt,
      }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, seen: requests("PRIVATE", "@corp/thing", null) });
  });

  cell("~/.npmrc token for the ./.npmrc scope, and no token for an unscoped package", async () => {
    const result = await autoInstall({
      args: ["x.cjs"],
      files: r => ({
        "app/.npmrc": `@corp:registry=http://${r.PRIVATE}/\n`,
        "home/.npmrc": `//${r.PRIVATE}/:_authToken=${token}\n`,
        "app/x.cjs": `console.log(require("@corp/thing"), require("plain-thing"));\n`,
      }),
    });
    expect(result).toEqual({
      ...fromPrivateRegistry,
      stdout: "PRIVATE DEFAULT\n",
      seen: [...requests("PRIVATE", "@corp/thing", `Bearer ${token}`), ...requests("DEFAULT", "plain-thing", null)],
    });
  });

  cell("./.npmrc token for a scope whose URL is in bunfig.toml", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": `//${r.PRIVATE}/:_authToken=${token}\n`,
        "app/bunfig.toml": `[install.scopes]\n"@corp" = "http://${r.PRIVATE}/"\n`,
        "app/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("a bunfig.toml scope overrides the ./.npmrc scope", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": `@corp:registry=http://${r.DEFAULT}/\n`,
        "app/bunfig.toml": `[install.scopes]\n"@corp" = { url = "http://${r.PRIVATE}/", token = "${token}" }\n`,
        "app/x.mjs": importIt,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  // The runtime expands `${NAME}` from the environment the script runs with.
  // `bun install` loads `.env.production` in place of `.env.development`.
  cell.each([
    ["the process environment", {}, { MY_NPM_TOKEN: token }],
    ["./.env", { "app/.env": `MY_NPM_TOKEN=${token}\n` }, {}],
    ["./.env.development", { "app/.env.development": `MY_NPM_TOKEN=${token}\n` }, {}],
  ] as [string, Files, Record<string, string>][])("./.npmrc ${MY_NPM_TOKEN} from %s", async (_, files, env) => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": `@corp:registry=http://${r.PRIVATE}/\n//${r.PRIVATE}/:_authToken=\${MY_NPM_TOKEN}\n`,
        "app/x.mjs": importIt,
        ...files,
      }),
      env: () => env,
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  // bunfig.toml is read from the start directory, and so is `.npmrc`.
  cell.each([
    ["import()", "x.mjs", `process.chdir("../elsewhere");\n` + importLater],
    ["require()", "x.cjs", `process.chdir("../elsewhere");\nconsole.log(require("@corp/thing"));\n`],
  ])("./.npmrc of the start directory after process.chdir(): %s", async (_, file, source) => {
    const result = await autoInstall({
      args: [file],
      files: r => ({
        "app/.npmrc": scopeAndToken(r),
        "elsewhere/.npmrc": `@corp:registry=http://${r.DEFAULT}/\n`,
        [`app/${file}`]: source,
      }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, created: ["app", "cache", "elsewhere", "home"] });
  });

  cell("a ./.npmrc written before the first auto-install", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/x.mjs":
          `import { writeFileSync } from "node:fs";\n` +
          `writeFileSync(".npmrc", ${JSON.stringify(scopeAndToken(r))});\n` +
          importLater,
      }),
    });
    expect(result).toEqual(fromPrivateRegistry);
  });

  cell("a scoped package's unscoped dependency comes from the default registry, without the token", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": scopeAndToken(r),
        "app/x.mjs": `import servedBy from "@corp/with-dep";\nconsole.log(servedBy);\n`,
      }),
    });
    const byPath = (a: Seen, b: Seen) => a.path.localeCompare(b.path);
    expect({ ...result, seen: result.seen.sort(byPath) }).toEqual({
      ...fromPrivateRegistry,
      stdout: "PRIVATE DEFAULT\n",
      seen: [
        ...requests("PRIVATE", "@corp/with-dep", `Bearer ${token}`),
        ...requests("DEFAULT", "plain-thing", null),
      ].sort(byPath),
    });
  });

  // `bun install` takes `cache=` from .npmrc and warns about `certfile=`.
  // The runtime takes the registries only and prints nothing.
  cell("other ./.npmrc keys do not reach the runtime", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({
        "app/.npmrc": scopeAndToken(r) + `cache=../npmrc-cache\n//${r.PRIVATE}/:certfile=/nope.pem\n`,
        "app/x.mjs": importIt,
      }),
      env: (_, dir) => ({ BUN_INSTALL_CACHE_DIR: undefined, BUN_INSTALL: join(dir, "bun-install") }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, created: ["app", "bun-install", "home"] });
  });

  // Neither `.npmrc` path fits a path buffer, so the default registry answers.
  cell.skipIf(!isLinux)("a start directory and a home directory at the path length limit", async () => {
    const atLimit = (dir: string, name: string) => directoryPathOfLength(join(dir, name), 4092);
    const result = await autoInstall({
      args: ["-e", `console.log(require("@corp/thing"));`],
      files: () => ({}),
      env: (_, dir) => ({ HOME: atLimit(dir, "home") }),
      prepare: dir => {
        mkdirSync(atLimit(dir, "app"), { recursive: true });
        mkdirSync(atLimit(dir, "home"), { recursive: true });
      },
      cwd: dir => atLimit(dir, "app"),
    });
    expect(result).toEqual({
      ...fromPrivateRegistry,
      stdout: "DEFAULT\n",
      seen: requests("DEFAULT", "@corp/thing", null),
    });
  });

  cell("nothing is printed and no registry is asked when node_modules has the package", async () => {
    const broken = (r: Registries) => `@corp:registry=http://${r.DEFAULT}/\n//${r.DEFAULT}/:certfile=/nope.pem\n`;
    const result = await autoInstall({
      args: ["x.mjs"],
      files: r => ({ ...inNodeModules, "app/.npmrc": broken(r), "home/.npmrc": broken(r), "app/x.mjs": importIt }),
    });
    expect(result).toEqual({ ...fromPrivateRegistry, stdout: "node_modules\n", seen: [], created: ["app", "home"] });
  });

  // Opening a FIFO for reading blocks until a writer shows up, which never
  // happens. The timeout only turns that hang into a failure.
  cell.skipIf(isWindows)("no .npmrc is opened when node_modules has the package", async () => {
    const result = await autoInstall({
      args: ["x.mjs"],
      files: () => ({ ...inNodeModules, "app/x.mjs": importIt }),
      prepare: dir => {
        mkfifo(join(dir, "app", ".npmrc"));
        mkfifo(join(dir, "home", ".npmrc"));
      },
      timeout: 30_000,
    });
    expect(result).toEqual({ ...fromPrivateRegistry, stdout: "node_modules\n", seen: [], created: ["app", "home"] });
  });
});
