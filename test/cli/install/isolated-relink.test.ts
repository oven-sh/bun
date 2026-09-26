import { file, type Server, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { lstat, mkdir, readdir, readFile, realpath, unlink } from "fs/promises";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { join, relative } from "path";

const packagesPath = join(import.meta.dir, "registry", "packages");
let registry: Server;

type Packument = {
  versions: Record<string, { dist: { tarball: string }; scripts?: Record<string, string>; hasInstallScript?: boolean }>;
};

// The verdaccio fixture store served in-process: the same packuments and tarballs as `VerdaccioRegistry`, without the
// seconds verdaccio takes to start under the binary under test.
beforeAll(() => {
  registry = Bun.serve({
    port: 0,
    async fetch(request) {
      const { origin, pathname } = new URL(request.url);
      const path = decodeURIComponent(pathname.slice(1));
      const separator = path.indexOf("/-/");
      if (separator !== -1) {
        const tarball = file(join(packagesPath, path.slice(0, separator), path.slice(path.lastIndexOf("/") + 1)));
        return (await tarball.exists()) ? new Response(tarball) : new Response("not found", { status: 404 });
      }
      const stored = file(join(packagesPath, path, "package.json"));
      if (!(await stored.exists())) return new Response("not found", { status: 404 });
      const packument: Packument = await stored.json();
      for (const version of Object.values(packument.versions)) {
        // verdaccio serves each stored tarball from its own host, and the abbreviated manifest bun asks for carries
        // `hasInstallScript`, which bun reads from the manifest (src/install/npm.rs).
        const tarball = version.dist.tarball;
        version.dist.tarball = `${origin}/${path}/-/${tarball.slice(tarball.lastIndexOf("/") + 1)}`;
        version.hasInstallScript = ["preinstall", "install", "postinstall"].some(
          name => name in (version.scripts ?? {}),
        );
      }
      return Response.json(packument);
    },
  });
});

afterAll(() => {
  registry.stop(true);
});

function project(packageJson: object) {
  return tempDir("isolated-relink-", {
    "package.json": JSON.stringify(packageJson),
    "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url.href, linker: "isolated" } }),
  });
}

function oneRangeDep(overrides?: Record<string, string>) {
  return { name: "foo", dependencies: { "one-range-dep": "1.0.0" }, ...(overrides && { overrides }) };
}

function usesWhatBin(extra: Record<string, unknown> = {}) {
  return { name: "foo", dependencies: { "uses-what-bin": "1.0.0" }, ...extra };
}

type Output = { out: string; err: string; exitCode: number };

// Runs `bun <cmd> --linker isolated` in `dir`. The task count of the resolve summary depends on the state of the cache
// and is masked.
async function run(cmd: string, dir: string, env: Record<string, string> = {}): Promise<Output> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), cmd, "--linker", "isolated"],
    // CI exports BUN_INSTALL_CACHE_DIR for the whole file. Concurrent installs into one cache race on Windows.
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache"), ...env },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const normalize = (text: string) =>
    normalizeBunSnapshot(text, dir).replace(/(Resolved, downloaded and extracted) \[\d+\]/, "$1 [<n>]");
  return { out: normalize(out), err: normalize(err), exitCode };
}

const install = (dir: string, env?: Record<string, string>) => run("install", dir, env);
const prune = (dir: string) => run("prune", dir);

// The output of a `bun install` that linked packages. A `resolved` install fetched manifests and saved bun.lock.
function installed(summary: string, resolved = true): Output {
  return {
    out: `bun install <version> (<revision>)\n\n${summary}`,
    err: resolved ? "Resolving dependencies\nResolved, downloaded and extracted [<n>]\nSaved lockfile" : "",
    exitCode: 0,
  };
}

const noChanges = installed("Done! Checked 3 packages (no changes)", false);

/**
 * Every link and package below `node_modules`, keyed by path relative to it with `/` separators. A link (a symlink,
 * or a junction or a `.bunx` bin shim on Windows) maps to `-> ` and the path it resolves to, also relative to
 * `node_modules`. A real directory with a package.json maps to its `name@version` and is not entered.
 */
async function layout(packageDir: string): Promise<Record<string, string>> {
  const nm = join(packageDir, "node_modules");
  const entries: Record<string, string> = {};
  const rel = (path: string) => relative(nm, path).replaceAll("\\", "/");
  async function walk(dir: string) {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) {
        entries[rel(path)] = `-> ${rel(await realpath(path))}`;
      } else if (stats.isDirectory()) {
        const packageJson = file(join(path, "package.json"));
        if (await packageJson.exists()) {
          const { name, version } = await packageJson.json();
          entries[rel(path)] = `${name}@${version}`;
        } else {
          await walk(path);
        }
      } else if (isWindows && name.endsWith(".bunx")) {
        // A Windows bin is a `<name>.exe` + `<name>.bunx` pair. The first UTF-16LE field of the shim is the bin
        // target, relative to the parent of `.bin`.
        const shim = (await readFile(path)).toString("utf16le");
        const target = join(dir, "..", shim.slice(0, shim.indexOf('"')));
        entries[rel(path).slice(0, -".bunx".length)] = `-> ${rel(await realpath(target))}`;
      }
    }
  }
  await walk(nm);
  return entries;
}

function without(entries: Record<string, string>, key: string) {
  const { [key]: _, ...rest } = entries;
  return rest;
}

// The `node_modules` of a store entry. The fixtures have no peers, so the entry names carry no peer hash.
function storeNodeModules(packageDir: string, name: string, version: string) {
  return join(packageDir, "node_modules", ".bun", `${name}@${version}`, "node_modules");
}

// On Windows a bin is a `<name>.exe` + `<name>.bunx` shim pair instead of a symlink.
function binFiles(nm: string, name: string) {
  const bin = join(nm, ".bin", name);
  return isWindows ? [`${bin}.exe`, `${bin}.bunx`] : [bin];
}

const noDepsStore = (version: string) => `.bun/no-deps@${version}/node_modules/no-deps`;
const noDepsPackage = (version: string) => ({ [noDepsStore(version)]: `no-deps@${version}` });

// `oneRangeDep()` installed, with `no-deps@<version>` linked under one-range-dep.
function oneRangeDepLayout(noDeps: string) {
  const oneRangeDep = ".bun/one-range-dep@1.0.0/node_modules/one-range-dep";
  return {
    "one-range-dep": `-> ${oneRangeDep}`,
    ".bun/node_modules/one-range-dep": `-> ${oneRangeDep}`,
    ".bun/node_modules/no-deps": `-> ${noDepsStore(noDeps)}`,
    [oneRangeDep]: "one-range-dep@1.0.0",
    ".bun/one-range-dep@1.0.0/node_modules/no-deps": `-> ${noDepsStore(noDeps)}`,
    ...noDepsPackage(noDeps),
  };
}

const whatBinStore = (version: string) => `.bun/what-bin@${version}/node_modules/what-bin`;

// The store entry of `what-bin@<version>`. A package's own bins are linked in its store entry too.
function whatBinPackage(version: string) {
  return {
    [whatBinStore(version)]: `what-bin@${version}`,
    [`.bun/what-bin@${version}/node_modules/.bin/what-bin`]: `-> ${whatBinStore(version)}/what-bin.js`,
  };
}

// `usesWhatBin()` installed, with `what-bin@<version>` linked under uses-what-bin.
function usesWhatBinLayout(whatBin: string) {
  const usesWhatBin = ".bun/uses-what-bin@1.0.0/node_modules/uses-what-bin";
  return {
    "uses-what-bin": `-> ${usesWhatBin}`,
    ".bun/node_modules/uses-what-bin": `-> ${usesWhatBin}`,
    ".bun/node_modules/what-bin": `-> ${whatBinStore(whatBin)}`,
    [usesWhatBin]: "uses-what-bin@1.0.0",
    ".bun/uses-what-bin@1.0.0/node_modules/what-bin": `-> ${whatBinStore(whatBin)}`,
    ".bun/uses-what-bin@1.0.0/node_modules/.bin/what-bin": `-> ${whatBinStore(whatBin)}/what-bin.js`,
    ...whatBinPackage(whatBin),
  };
}

test.concurrent("an existing store entry is re-linked when an override re-resolves its dependency", async () => {
  using packageDir = project(oneRangeDep());
  const link = join(storeNodeModules(packageDir, "one-range-dep", "1.0.0"), "no-deps");

  expect(await install(packageDir)).toEqual(installed("+ one-range-dep@1.0.0\n\n2 packages installed"));
  expect(await layout(packageDir)).toEqual(oneRangeDepLayout("1.1.0"));

  await write(join(packageDir, "package.json"), JSON.stringify(oneRangeDep({ "no-deps": "1.0.0" })));
  expect(await install(packageDir)).toEqual(installed("+ one-range-dep@1.0.0\n\n2 packages installed"));
  // no-deps@1.1.0 is orphaned, not removed
  const relinked = { ...oneRangeDepLayout("1.0.0"), ...noDepsPackage("1.1.0") };
  expect(await layout(packageDir)).toEqual(relinked);

  const linkMtime = (await lstat(link)).mtimeMs;
  expect(await install(packageDir)).toEqual(noChanges);
  expect((await lstat(link)).mtimeMs).toBe(linkMtime);
  expect(await layout(packageDir)).toEqual(relinked);
});

test.concurrent("a dependency link deleted from an existing store entry is recreated", async () => {
  using packageDir = project(oneRangeDep());
  const link = ".bun/one-range-dep@1.0.0/node_modules/no-deps";

  expect(await install(packageDir)).toEqual(installed("+ one-range-dep@1.0.0\n\n2 packages installed"));
  expect(await layout(packageDir)).toEqual(oneRangeDepLayout("1.1.0"));

  await unlink(join(packageDir, "node_modules", link));
  expect(await layout(packageDir)).toEqual(without(oneRangeDepLayout("1.1.0"), link));

  expect(await install(packageDir)).toEqual(installed("+ one-range-dep@1.0.0\n\n1 package installed", false));
  expect(await layout(packageDir)).toEqual(oneRangeDepLayout("1.1.0"));

  expect(await install(packageDir)).toEqual(noChanges);
  expect(await layout(packageDir)).toEqual(oneRangeDepLayout("1.1.0"));
});

test.concurrent("dependency bins are re-linked when a store entry is re-linked", async () => {
  using packageDir = project(usesWhatBin());
  const nm = storeNodeModules(packageDir, "uses-what-bin", "1.0.0");

  expect(await install(packageDir)).toEqual(
    installed("+ uses-what-bin@1.0.0 (v1.5.0 available)\n\n2 packages installed"),
  );
  expect(await layout(packageDir)).toEqual(usesWhatBinLayout("1.0.0"));

  for (const bin of binFiles(nm, "what-bin")) await unlink(bin);
  expect(await layout(packageDir)).toEqual(
    without(usesWhatBinLayout("1.0.0"), ".bun/uses-what-bin@1.0.0/node_modules/.bin/what-bin"),
  );

  await write(join(packageDir, "package.json"), JSON.stringify(usesWhatBin({ overrides: { "what-bin": "1.5.0" } })));
  expect(await install(packageDir)).toEqual(installed("+ uses-what-bin@1.0.0\n\n2 packages installed"));
  // what-bin@1.0.0 is orphaned, not removed
  expect(await layout(packageDir)).toEqual({ ...usesWhatBinLayout("1.5.0"), ...whatBinPackage("1.0.0") });
});

test.concurrent("re-linking a store entry does not re-run its lifecycle scripts", async () => {
  using packageDir = project(usesWhatBin({ trustedDependencies: ["uses-what-bin"] }));
  // The `install` script of uses-what-bin runs `what-bin`, which writes its own version to this file.
  const marker = join(storeNodeModules(packageDir, "uses-what-bin", "1.0.0"), "uses-what-bin", "what-bin.txt");

  expect(await install(packageDir)).toEqual(
    installed("+ uses-what-bin@1.0.0 (v1.5.0 available)\n\n2 packages installed"),
  );
  expect(await layout(packageDir)).toEqual(usesWhatBinLayout("1.0.0"));
  expect(await file(marker).text()).toBe("what-bin@1.0.0");
  const markerMtime = (await lstat(marker)).mtimeMs;

  await write(
    join(packageDir, "package.json"),
    JSON.stringify(usesWhatBin({ trustedDependencies: ["uses-what-bin"], overrides: { "what-bin": "1.5.0" } })),
  );
  expect(await install(packageDir)).toEqual(installed("+ uses-what-bin@1.0.0\n\n2 packages installed"));
  expect(await layout(packageDir)).toEqual({ ...usesWhatBinLayout("1.5.0"), ...whatBinPackage("1.0.0") });
  // The bin now resolves to what-bin@1.5.0. A re-run of the script would have written that version.
  expect(await file(marker).text()).toBe("what-bin@1.0.0");
  expect((await lstat(marker)).mtimeMs).toBe(markerMtime);
});

test.concurrent(
  "a real directory in a store entry's dependency slot is left alone and not counted as a change",
  async () => {
    using packageDir = project(oneRangeDep());
    const link = join(storeNodeModules(packageDir, "one-range-dep", "1.0.0"), "no-deps");

    expect(await install(packageDir)).toEqual(installed("+ one-range-dep@1.0.0\n\n2 packages installed"));
    expect(await layout(packageDir)).toEqual(oneRangeDepLayout("1.1.0"));

    await unlink(link);
    await mkdir(link);
    await write(join(link, "package.json"), JSON.stringify({ name: "no-deps", version: "0.0.0-local-edit" }));
    const withLocalEdit = {
      ...oneRangeDepLayout("1.1.0"),
      ".bun/one-range-dep@1.0.0/node_modules/no-deps": "no-deps@0.0.0-local-edit",
    };

    expect(await install(packageDir)).toEqual(noChanges);
    expect(await layout(packageDir)).toEqual(withLocalEdit);
  },
);

test.concurrent.skipIf(!isWindows)("junction-mode warm install reports no changes", async () => {
  using packageDir = project(oneRangeDep());
  const link = join(storeNodeModules(packageDir, "one-range-dep", "1.0.0"), "no-deps");
  const env = { BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS: "1" };

  expect(await install(packageDir, env)).toEqual(installed("+ one-range-dep@1.0.0\n\n2 packages installed"));
  expect(await layout(packageDir)).toEqual(oneRangeDepLayout("1.1.0"));

  const linkMtime = (await lstat(link)).mtimeMs;
  expect(await install(packageDir, env)).toEqual(noChanges);
  expect((await lstat(link)).mtimeMs).toBe(linkMtime);
  expect(await layout(packageDir)).toEqual(oneRangeDepLayout("1.1.0"));
});

test.concurrent("the orphaned store entry survives the re-link until bun prune", async () => {
  using packageDir = project(oneRangeDep());

  expect(await install(packageDir)).toEqual(installed("+ one-range-dep@1.0.0\n\n2 packages installed"));
  expect(await layout(packageDir)).toEqual(oneRangeDepLayout("1.1.0"));

  await write(join(packageDir, "package.json"), JSON.stringify(oneRangeDep({ "no-deps": "1.0.0" })));
  expect(await install(packageDir)).toEqual(installed("+ one-range-dep@1.0.0\n\n2 packages installed"));
  expect(await layout(packageDir)).toEqual({ ...oneRangeDepLayout("1.0.0"), ...noDepsPackage("1.1.0") });

  const { out, err, exitCode } = await prune(packageDir);
  expect(out).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.1.0
    1 package removed (checked 4 installed packages)"
  `);
  expect(err).toBe("");
  expect(exitCode).toBe(0);
  expect(await layout(packageDir)).toEqual(oneRangeDepLayout("1.0.0"));

  expect(await install(packageDir)).toEqual(noChanges);
  expect(await layout(packageDir)).toEqual(oneRangeDepLayout("1.0.0"));
});
