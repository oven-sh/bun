import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { rm } from "fs/promises";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";
import {
  aliasRegistry,
  aliasRows,
  failAfterDependencyRows,
  ownNames,
  plainDependencies,
  targetNames,
} from "../install/npm-alias-fixtures";

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

// An `npm:` alias that bun knows sends a plain dependency with the name of the alias to the alias
// target. At run time bun reads no overrides and no catalogs from package.json, and it reads the
// root package.json before the package manager exists, which registers nothing. The aliases come
// from the lockfile that bun keeps. bun loads one only when the project has a bun.lockb.
describe("auto-install with npm: aliases in the lockfile", () => {
  const catalog = aliasRows("catalog");
  const namedCatalog = aliasRows("named-catalog");
  const packageJson = {
    name: "app",
    workspaces: { packages: [], catalog, catalogs: { group: namedCatalog } },
    dependencies: { ...aliasRows("dependency"), "has-aliases": "1.0.0" },
    overrides: aliasRows("override"),
  };
  const hasAliases = { name: "has-aliases", version: "1.0.0", dependencies: aliasRows("transitive") };
  const dependencyRows = { ...aliasRows("dependency"), ...hasAliases.dependencies };
  const overrideAndCatalogRows = { ...packageJson.overrides, ...catalog, ...namedCatalog };
  const aliases = { ...dependencyRows, ...overrideAndCatalogRows };
  // Each package of the registry exports its name. This one has plain dependencies with the
  // names of the aliases, and exports what each of them exports.
  const notInLockfile = {
    name: "not-in-lockfile",
    version: "1.0.0",
    dependencies: plainDependencies(aliases),
    files: {
      "index.js": `module.exports = Object.fromEntries(${JSON.stringify(Object.keys(aliases))}.map(name => [name, require(name)]));`,
    },
  };

  async function run(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // Each project has a lockfile of `packageJson`. `install` puts the packages of the lockfile in
  // the cache, and the run takes them from there.
  let registry: Awaited<ReturnType<typeof aliasRegistry>>;
  let kept: ReturnType<typeof tempDir>;
  let failsToLoad: ReturnType<typeof tempDir>;
  let textLockfile: ReturnType<typeof tempDir>;
  beforeAll(async () => {
    registry = await aliasRegistry(aliases, [hasAliases, notInLockfile]);
    const files = (saveTextLockfile: boolean, manifest: object) => ({
      "package.json": JSON.stringify(manifest),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url, saveTextLockfile } }),
      "index.js": `console.log(JSON.stringify(require("not-in-lockfile")));`,
    });
    kept = tempDir("autoinstall-npm-alias-kept-", files(false, packageJson));
    failsToLoad = tempDir("autoinstall-npm-alias-fails-", files(false, { name: "app" }));
    textLockfile = tempDir("autoinstall-npm-alias-text-", files(true, packageJson));
    expect(await Promise.all([run(String(kept), "install"), run(String(textLockfile), "install")])).toMatchObject([
      { exitCode: 0 },
      { exitCode: 0 },
    ]);

    const lockb = await Bun.file(join(String(kept), "bun.lockb")).bytes();
    await Promise.all([
      rm(join(String(kept), "node_modules"), { recursive: true }),
      rm(join(String(textLockfile), "node_modules"), { recursive: true }),
      Bun.write(join(String(failsToLoad), "bun.lockb"), failAfterDependencyRows(Buffer.from(lockb))),
      // bun reads bun.lock and not the bun.lockb next to it.
      Bun.write(join(String(textLockfile), "bun.lockb"), lockb),
    ]);
  });
  afterAll(() => {
    registry?.[Symbol.dispose]();
    kept?.[Symbol.dispose]();
    failsToLoad?.[Symbol.dispose]();
    textLockfile?.[Symbol.dispose]();
  });

  test("bun.lockb fails to load after the rows", async () => {
    expect(await run(String(failsToLoad), "--install=fallback", "index.js")).toEqual({
      stdout: JSON.stringify(ownNames(aliases)) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // These two pass with and without the registration in the loader.
  test("a package that is not in bun.lockb follows the aliases", async () => {
    expect(await run(String(kept), "--install=fallback", "index.js")).toEqual({
      stdout: JSON.stringify(targetNames(aliases)) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a dependency row of bun.lock registers no alias", async () => {
    expect(await run(String(textLockfile), "--install=fallback", "index.js")).toEqual({
      stdout: JSON.stringify({ ...ownNames(dependencyRows), ...targetNames(overrideAndCatalogRows) }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
