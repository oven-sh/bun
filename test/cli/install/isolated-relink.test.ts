import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { lstat, mkdir, realpath, unlink } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, isWindows, normalizeBunSnapshot } from "harness";
import { dirname, join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type Output = [stdout: string, stderr: string, exitCode: number];

async function run(cmd: string, dir: string, env: Record<string, string> = {}): Promise<Output> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), cmd, "--linker", "isolated"],
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache"), ...env },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

const install = (dir: string, env?: Record<string, string>) => run("install", dir, env);
const prune = (dir: string) => run("prune", dir);

async function installOk(dir: string, env?: Record<string, string>) {
  const [out, err, exitCode] = await install(dir, env);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  return out;
}

// Store entry names may carry peer-hash suffixes, so reach an entry's node_modules through its top-level link.
async function storeNodeModules(packageDir: string, name: string) {
  return dirname(await realpath(join(packageDir, "node_modules", name)));
}

async function nestedNoDeps(packageDir: string) {
  return join(await storeNodeModules(packageDir, "one-range-dep"), "no-deps");
}

function nestedNoDepsPackageJson(link: string) {
  return file(join(link, "package.json")).json();
}

function oneRangeDep(overrides?: Record<string, string>) {
  return JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0" }, ...(overrides && { overrides }) });
}

function usesWhatBin(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ name: "foo", dependencies: { "uses-what-bin": "1.0.0" }, ...extra });
}

// POSIX bins are symlinks; Windows writes `<name>.exe` + `<name>.bunx` whose first UTF-16LE field is the target relative to node_modules.
function binFiles(nm: string, name: string) {
  const bin = join(nm, ".bin", name);
  return isWindows ? [`${bin}.exe`, `${bin}.bunx`] : [bin];
}

async function binTargetContents(nm: string, name: string) {
  if (isWindows) {
    const raw = readFileSync(join(nm, ".bin", `${name}.bunx`)).toString("utf16le");
    return await file(join(nm, raw.slice(0, raw.indexOf('"')))).text();
  }
  return await file(await realpath(join(nm, ".bin", name))).text();
}

test.concurrent("an existing store entry is re-linked when an override re-resolves its dependency", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(packageJson, oneRangeDep());
  await installOk(packageDir);
  const link = await nestedNoDeps(packageDir);
  expect(await nestedNoDepsPackageJson(link)).toStrictEqual({ name: "no-deps", version: "1.1.0" });

  await write(packageJson, oneRangeDep({ "no-deps": "1.0.0" }));
  const out = await installOk(packageDir);
  expect(await nestedNoDepsPackageJson(link)).toStrictEqual({ name: "no-deps", version: "1.0.0" });
  expect(out).toMatch(/\d+ packages? installed/);
  expect(out).not.toContain("(no changes)");

  const linkMtime = (await lstat(link)).mtimeMs;
  const again = await installOk(packageDir);
  expect(again).toContain("(no changes)");
  expect((await lstat(link)).mtimeMs).toBe(linkMtime);
  expect(await nestedNoDepsPackageJson(link)).toStrictEqual({ name: "no-deps", version: "1.0.0" });
});

test.concurrent("a dependency link deleted from an existing store entry is recreated", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(packageJson, oneRangeDep());
  await installOk(packageDir);
  const link = await nestedNoDeps(packageDir);
  expect(await nestedNoDepsPackageJson(link)).toStrictEqual({ name: "no-deps", version: "1.1.0" });

  await unlink(link);
  expect((await lstat(link).catch(e => e.code)) as string).toBe("ENOENT");

  const out = await installOk(packageDir);
  expect(out).toMatch(/\d+ packages? installed/);
  expect(out).not.toContain("(no changes)");
  expect((await lstat(link)).isSymbolicLink()).toBeTrue();
  expect(await nestedNoDepsPackageJson(link)).toStrictEqual({ name: "no-deps", version: "1.1.0" });

  expect(await installOk(packageDir)).toContain("(no changes)");
});

test.concurrent("dependency bins are re-linked when a store entry is re-linked", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(packageJson, usesWhatBin());
  await installOk(packageDir);
  const nm = await storeNodeModules(packageDir, "uses-what-bin");
  expect(await file(join(nm, "what-bin", "package.json")).json()).toMatchObject({ name: "what-bin", version: "1.0.0" });
  expect(await binTargetContents(nm, "what-bin")).toContain("what-bin@1.0.0");

  for (const bin of binFiles(nm, "what-bin")) await unlink(bin);

  await write(packageJson, usesWhatBin({ overrides: { "what-bin": "1.5.0" } }));
  const out = await installOk(packageDir);
  expect(out).not.toContain("(no changes)");
  expect(await file(join(nm, "what-bin", "package.json")).json()).toMatchObject({ name: "what-bin", version: "1.5.0" });
  expect(binFiles(nm, "what-bin").map(bin => existsSync(bin))).toStrictEqual(binFiles(nm, "what-bin").map(() => true));
  expect(await binTargetContents(nm, "what-bin")).toContain("what-bin@1.5.0");
});

test.concurrent("re-linking a store entry does not re-run its lifecycle scripts", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(packageJson, usesWhatBin({ trustedDependencies: ["uses-what-bin"] }));
  await installOk(packageDir);
  const nm = await storeNodeModules(packageDir, "uses-what-bin");
  const marker = join(nm, "uses-what-bin", "what-bin.txt");
  expect(await file(marker).text()).toBe("what-bin@1.0.0");

  await unlink(marker);
  await write(packageJson, usesWhatBin({ trustedDependencies: ["uses-what-bin"], overrides: { "what-bin": "1.5.0" } }));
  const out = await installOk(packageDir);
  expect(out).not.toContain("(no changes)");
  expect(await file(join(nm, "what-bin", "package.json")).json()).toMatchObject({ name: "what-bin", version: "1.5.0" });
  expect(existsSync(marker)).toBeFalse();
});

test.concurrent(
  "a real directory in a store entry's dependency slot is left alone and not counted as a change",
  async () => {
    const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

    await write(packageJson, oneRangeDep());
    await installOk(packageDir);
    const link = await nestedNoDeps(packageDir);

    await unlink(link);
    await mkdir(link);
    await write(join(link, "package.json"), JSON.stringify({ name: "no-deps", version: "0.0.0-local-edit" }));

    const out = await installOk(packageDir);
    expect(out).toContain("(no changes)");
    expect((await lstat(link)).isDirectory()).toBeTrue();
    expect(await nestedNoDepsPackageJson(link)).toStrictEqual({ name: "no-deps", version: "0.0.0-local-edit" });
  },
);

test.concurrent.skipIf(!isWindows)("junction-mode warm install reports no changes", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
  const env = { BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS: "1" };

  await write(packageJson, oneRangeDep());
  const first = await installOk(packageDir, env);
  expect(first).toMatch(/\d+ packages? installed/);
  const link = await nestedNoDeps(packageDir);
  expect(await nestedNoDepsPackageJson(link)).toStrictEqual({ name: "no-deps", version: "1.1.0" });

  const linkMtime = (await lstat(link)).mtimeMs;
  expect(await installOk(packageDir, env)).toContain("(no changes)");
  expect((await lstat(link)).mtimeMs).toBe(linkMtime);
});

test.concurrent("the orphaned store entry survives the re-link until bun prune", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
  const orphan = join(packageDir, "node_modules", ".bun", "no-deps@1.1.0");

  await write(packageJson, oneRangeDep());
  await installOk(packageDir);
  expect(existsSync(join(orphan, "node_modules", "no-deps", "package.json"))).toBeTrue();

  await write(packageJson, oneRangeDep({ "no-deps": "1.0.0" }));
  await installOk(packageDir);
  const link = await nestedNoDeps(packageDir);
  expect(await nestedNoDepsPackageJson(link)).toStrictEqual({ name: "no-deps", version: "1.0.0" });
  expect(existsSync(join(orphan, "node_modules", "no-deps", "package.json"))).toBeTrue();

  const [out, err, exitCode] = await prune(packageDir);
  expect(normalizeBunSnapshot(out).replaceAll("\\", "/")).toMatchInlineSnapshot(`
    "bun prune <version> (<revision>)

    - no-deps@1.1.0
    1 package removed (checked 4 installed packages)"
  `);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(existsSync(orphan)).toBeFalse();
  expect(await nestedNoDepsPackageJson(link)).toStrictEqual({ name: "no-deps", version: "1.0.0" });

  expect(await installOk(packageDir)).toContain("(no changes)");
});
