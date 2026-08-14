import { Archive, file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, runBunInstall, runBunUpdate, tempDir } from "harness";
import { join } from "path";

// Registry: no-deps 1.0.0/1.0.1/1.1.0/2.0.0, @types/no-deps 1.0.0/2.0.0, a-dep 1.0.1..1.0.10, one-range-dep@1.0.0 -> no-deps ^1.0.0.

const verdaccio = new VerdaccioRegistry();

beforeAll(async () => {
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

type Json = Record<string, any>;
const GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

function json(contents: Json | string) {
  return typeof contents === "string" ? contents : JSON.stringify(contents, null, 2) + "\n";
}

async function setup(
  files: Record<string, Json | string>,
  opts: { exact?: boolean; text?: boolean; install?: boolean; allowWarnings?: boolean } = {},
): Promise<string> {
  const dir = String(
    tempDir(
      "lockfile-sync-",
      Object.fromEntries(Object.entries(files).map(([path, contents]) => [path, json(contents)])),
    ),
  );
  await write(
    join(dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: join(dir, ".bun-cache"),
        registry: verdaccio.registryUrl(),
        saveTextLockfile: opts.text ?? true,
        linker: "hoisted",
        exact: opts.exact,
      },
    }),
  );
  if (opts.install !== false) await runBunInstall(bunEnv, dir, { allowWarnings: opts.allowWarnings });
  return dir;
}

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  return { stdout, stderr, exitCode };
}

const pkg = (dir: string, rel = ""): Promise<Json> => file(join(dir, rel, "package.json")).json();
const writePkg = (dir: string, contents: Json, rel = "") => write(join(dir, rel, "package.json"), json(contents));
const installed = (dir: string, name: string): Promise<Json> =>
  file(join(dir, "node_modules", name, "package.json")).json();
const lockText = (dir: string) => file(join(dir, "bun.lock")).text();
const lock = async (dir: string): Promise<Json> => Bun.JSONC.parse(await lockText(dir)) as Json;

function declaredLiteral(manifest: Json, name: string): string | undefined {
  for (const group of GROUPS) {
    const literal = manifest[group]?.[name];
    if (literal !== undefined) return literal;
  }
}

async function expectInSync(dir: string, workspaces: string[] = [""], allowWarnings = false) {
  const lockfile = await lock(dir);
  for (const key of workspaces) {
    const manifest = await pkg(dir, key);
    for (const group of GROUPS) {
      if (manifest[group] === undefined) continue;
      expect({ [key || "."]: { [group]: lockfile.workspaces[key]?.[group] } }).toEqual({
        [key || "."]: { [group]: manifest[group] },
      });
    }
    if (key !== "") continue;
    const overrides = manifest.overrides ?? manifest.resolutions;
    if (overrides !== undefined) {
      const expected = Object.fromEntries(
        Object.entries(overrides).map(([name, value]) => [
          name,
          typeof value === "string" && value.startsWith("$") ? declaredLiteral(manifest, value.slice(1)) : value,
        ]),
      );
      expect(lockfile.overrides).toEqual(expected);
    }
    const catalog = manifest.workspaces?.catalog ?? manifest.catalog;
    if (catalog !== undefined) expect(lockfile.catalog).toEqual(catalog);
    const catalogs = manifest.workspaces?.catalogs ?? manifest.catalogs;
    if (catalogs !== undefined) expect(lockfile.catalogs).toEqual(catalogs);
  }
  await runBunInstall(bunEnv, dir, { frozenLockfile: true, allowWarnings });
  const before = await lockText(dir);
  const { err } = await runBunInstall(bunEnv, dir, { savesLockfile: false, allowWarnings });
  expect(err).not.toContain("Saved lockfile");
  expect(await lockText(dir)).toBe(before);
}

const root = (fields: Json): Json => ({ name: "foo", ...fields });

const MONOREPO = (pkg1: Json = {}, rootFields: Json = {}) => ({
  "package.json": { name: "root", workspaces: ["packages/*"], ...rootFields },
  "packages/pkg1/package.json": { name: "pkg1", version: "1.0.0", ...pkg1 },
});
const PKG1 = "packages/pkg1";

describe.concurrent("bun update rewrites bun.lock together with package.json", () => {
  test("bun update", async () => {
    const dir = await setup({
      "package.json": root({ dependencies: { "no-deps": "^1.0.0", aliased: "npm:no-deps@~1.0.0" } }),
    });
    await run(dir, "update");
    const expected = { "no-deps": "^1.1.0", aliased: "npm:no-deps@~1.0.1" };
    expect((await pkg(dir)).dependencies).toEqual(expected);
    expect((await lock(dir)).workspaces[""].dependencies).toEqual(expected);
    await expectInSync(dir);
  });

  test("bun update --latest", async () => {
    const dir = await setup({
      "package.json": root({ dependencies: { "no-deps": "~1.0.0", aliased: "npm:no-deps@~1.0.0" } }),
    });
    await run(dir, "update", "--latest");
    const expected = { "no-deps": "~2.0.0", aliased: "npm:no-deps@~2.0.0" };
    expect((await pkg(dir)).dependencies).toEqual(expected);
    const ws = (await lock(dir)).workspaces[""];
    expect(ws.dependencies).toEqual(expected);
    expect(JSON.stringify(ws)).not.toContain("latest");
    await expectInSync(dir);
  });

  test("bun update <name> keeps the pin style", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "~1.0.0" } }) });
    await run(dir, "update", "no-deps");
    expect((await pkg(dir)).dependencies).toEqual({ "no-deps": "~1.0.1" });
    expect((await lock(dir)).workspaces[""].dependencies).toEqual({ "no-deps": "~1.0.1" });
    await expectInSync(dir);
  });

  test("bun update <name> on an exact literal", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "1.0.0" } }) });
    await run(dir, "update", "no-deps");
    expect((await pkg(dir)).dependencies).toEqual({ "no-deps": "1.0.0" });
    expect((await lock(dir)).workspaces[""].dependencies).toEqual({ "no-deps": "1.0.0" });
    await expectInSync(dir);
  });

  test("bun update <alias> keeps the alias", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { aliased: "npm:no-deps@~1.0.0" } }) });
    await run(dir, "update", "aliased");
    expect((await pkg(dir)).dependencies).toEqual({ aliased: "npm:no-deps@~1.0.1" });
    expect((await lock(dir)).workspaces[""].dependencies).toEqual({ aliased: "npm:no-deps@~1.0.1" });
    await expectInSync(dir);
  });

  test("bun update <name>@<range>", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "~1.0.0" } }) });
    await run(dir, "update", "no-deps@^1.0.0");
    expect((await pkg(dir)).dependencies).toEqual({ "no-deps": "~1.1.0" });
    expect((await lock(dir)).workspaces[""].dependencies).toEqual({ "no-deps": "~1.1.0" });
    await expectInSync(dir);
  });

  // `bun install` warns about a name declared in two groups, so these two allow warnings.
  const inBothGroups = (version: string) =>
    root({ dependencies: { "no-deps": version }, devDependencies: { "no-deps": version } });

  test("bun update <name> with the name in dependencies and devDependencies", async () => {
    const dir = await setup({ "package.json": inBothGroups("~1.0.0") }, { allowWarnings: true });
    await run(dir, "update", "no-deps");
    const manifest = await pkg(dir);
    expect(manifest.dependencies).toEqual({ "no-deps": "~1.0.1" });
    expect(manifest.devDependencies).toEqual({ "no-deps": "~1.0.0" });
    await expectInSync(dir, [""], true);
  });

  test("bun update with the name in dependencies and devDependencies moves one group", async () => {
    const dir = await setup({ "package.json": inBothGroups("1.0.0") }, { allowWarnings: true });
    await writePkg(dir, inBothGroups("~1.0.0"));
    const { out } = await runBunUpdate(bunEnv, dir);
    expect(out.join("\n")).toMatch(/no-deps 1\.0\.0 (→|->) 1\.0\.1/);
    const manifest = await pkg(dir);
    expect([manifest.dependencies["no-deps"], manifest.devDependencies["no-deps"]].sort()).toEqual([
      "~1.0.0",
      "~1.0.1",
    ]);
    await expectInSync(dir, [""], true);
  });

  test("install.exact", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "^1.0.0" } }) }, { exact: true });
    await run(dir, "update");
    expect((await pkg(dir)).dependencies).toEqual({ "no-deps": "1.1.0" });
    expect((await lock(dir)).workspaces[""].dependencies).toEqual({ "no-deps": "1.1.0" });
    await expectInSync(dir);
  });

  test.each([[[]], [["--latest"]]])("bun update %j leaves folder, tarball and workspace literals alone", async args => {
    const dependencies = {
      "no-deps": "^1.0.0",
      "folder-dep": "file:./folder-target",
      "tgz-dep": "file:./tgz-dep-1.0.0.tgz",
      pkg1: "workspace:*",
    };
    const dir = await setup(
      {
        ...MONOREPO({}, { dependencies }),
        "folder-target/package.json": { name: "folder-dep", version: "1.0.0" },
      },
      { install: false },
    );
    await Archive.write(
      join(dir, "tgz-dep-1.0.0.tgz"),
      { "package/package.json": JSON.stringify({ name: "tgz-dep", version: "1.0.0" }) },
      { compress: "gzip" },
    );
    await runBunInstall(bunEnv, dir);
    await run(dir, "update", ...args);
    const expected = { ...dependencies, "no-deps": args.length ? "^2.0.0" : "^1.1.0" };
    expect((await pkg(dir)).dependencies).toEqual(expected);
    expect((await lock(dir)).workspaces[""].dependencies).toEqual(expected);
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update -r", async () => {
    const dir = await setup(MONOREPO({ dependencies: { "no-deps": "~1.0.0" } }));
    await run(dir, "update", "-r");
    expect((await pkg(dir, PKG1)).dependencies).toEqual({ "no-deps": "~1.0.1" });
    expect((await lock(dir)).workspaces[PKG1].dependencies).toEqual({ "no-deps": "~1.0.1" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update from a workspace member", async () => {
    const dir = await setup(MONOREPO({ dependencies: { "no-deps": "~1.0.0" } }));
    await run(join(dir, PKG1), "update");
    expect((await pkg(dir, PKG1)).dependencies).toEqual({ "no-deps": "~1.0.1" });
    expect((await lock(dir)).workspaces[PKG1].dependencies).toEqual({ "no-deps": "~1.0.1" });
    await expectInSync(dir, ["", PKG1]);
  });
});

describe.concurrent("npm: aliases", () => {
  test.each([
    {
      before: "npm:no-deps@~1.0.0",
      args: ["aliased", "--latest"],
      after: "npm:no-deps@~2.0.0",
      installs: ["no-deps", "2.0.0"],
    },
    { before: "npm:no-deps", args: [], after: "npm:no-deps@^2.0.0", installs: ["no-deps", "2.0.0"] },
    { before: "npm:no-deps", args: ["aliased"], after: "npm:no-deps@^2.0.0", installs: ["no-deps", "2.0.0"] },
    {
      before: "npm:@types/no-deps",
      args: ["--latest"],
      after: "npm:@types/no-deps@^2.0.0",
      installs: ["@types/no-deps", "2.0.0"],
    },
    {
      before: "npm:no-deps@~1.0.0",
      args: ["aliased@2.0.0"],
      after: "npm:no-deps@~2.0.0",
      installs: ["no-deps", "2.0.0"],
    },
    { before: "npm:no-deps@^1.0.0", args: ["aliased"], after: "npm:no-deps@^1.1.0", installs: ["no-deps", "1.1.0"] },
  ])('"aliased": "$before" + bun update $args -> "$after"', async ({ before, args, after, installs }) => {
    const dir = await setup({ "package.json": root({ dependencies: { aliased: before } }) });
    await run(dir, "update", ...args);
    expect((await pkg(dir)).dependencies.aliased).toBe(after);
    const [name, version] = installs;
    expect(await installed(dir, "aliased")).toMatchObject({ name, version });
    await expectInSync(dir);
  });

  test("bun update <alias>@npm:<other> retargets the alias", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { aliased: "npm:no-deps@~1.0.0" } }) });
    await run(dir, "update", "aliased@npm:a-dep");
    expect((await pkg(dir)).dependencies).toEqual({ aliased: "npm:a-dep@~1.0.10" });
    expect(await installed(dir, "aliased")).toMatchObject({ name: "a-dep", version: "1.0.10" });
    await expectInSync(dir);
  });

  test("bun update <new>@npm:<scoped>@<range> refuses to add; bun add keeps the target", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "a-dep": "1.0.1" } }) });
    const [pkgBefore, lockBefore] = await Promise.all([file(join(dir, "package.json")).text(), lockText(dir)]);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", "new-alias@npm:@types/no-deps@^1.0.0"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('error: "new-alias" is not in the lockfile, so there is nothing to update');
    expect(exitCode).toBe(1);
    expect(await file(join(dir, "package.json")).text()).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);

    await run(dir, "add", "new-alias@npm:@types/no-deps@^1.0.0");
    const expected = { "a-dep": "1.0.1", "new-alias": "npm:@types/no-deps@^1.0.0" };
    expect((await pkg(dir)).dependencies).toEqual(expected);
    expect((await lock(dir)).workspaces[""].dependencies).toEqual(expected);
    expect(await installed(dir, "new-alias")).toMatchObject({ name: "@types/no-deps", version: "1.0.0" });
    await expectInSync(dir);
  });

  test("bun update <alias>@npm:<scoped>@<range> retargets a scoped alias in the declared pin style", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { aliased: "npm:no-deps@~1.0.0" } }) });
    await run(dir, "update", "aliased@npm:@types/no-deps@^1.0.0");
    expect((await pkg(dir)).dependencies).toEqual({ aliased: "npm:@types/no-deps@~1.0.0" });
    expect(await installed(dir, "aliased")).toMatchObject({ name: "@types/no-deps", version: "1.0.0" });
    await expectInSync(dir);
  });
});

describe.concurrent("bun add", () => {
  test.each([
    { args: ["no-deps"], expected: { "no-deps": "^2.0.0" } },
    { args: ["no-deps", "--exact"], expected: { "no-deps": "2.0.0" } },
    { args: ["no-deps@~1.0.0"], expected: { "no-deps": "~1.0.0" } },
    { args: ["no-deps@latest"], expected: { "no-deps": "^2.0.0" } },
    { args: ["x@npm:no-deps@~1.0.0"], expected: { x: "npm:no-deps@~1.0.0" } },
    { args: ["x@npm:no-deps@latest"], expected: { x: "npm:no-deps@^2.0.0" } },
    { args: ["x@npm:no-deps"], expected: { x: "npm:no-deps" } },
  ])("bun add $args", async ({ args, expected }) => {
    const dir = await setup({ "package.json": root({}) }, { install: false });
    await run(dir, "add", ...args);
    expect((await pkg(dir)).dependencies).toEqual(expected);
    expect((await lock(dir)).workspaces[""].dependencies).toEqual(expected);
    await expectInSync(dir);
  });

  test("bun add <workspace>@workspace:*", async () => {
    const dir = await setup(MONOREPO());
    await run(dir, "add", "pkg1@workspace:*");
    expect((await pkg(dir)).dependencies).toEqual({ pkg1: "workspace:*" });
    expect((await lock(dir)).workspaces[""].dependencies).toEqual({ pkg1: "workspace:*" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun add --filter", async () => {
    const dir = await setup(MONOREPO());
    await run(dir, "add", "x@npm:no-deps@latest", "--filter", "pkg1");
    expect((await pkg(dir, PKG1)).dependencies).toEqual({ x: "npm:no-deps@^2.0.0" });
    expect((await lock(dir)).workspaces[PKG1].dependencies).toEqual({ x: "npm:no-deps@^2.0.0" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun add --lockfile-only", async () => {
    const dir = await setup({ "package.json": root({}) }, { install: false });
    await run(dir, "add", "no-deps", "--lockfile-only");
    expect((await pkg(dir)).dependencies).toEqual({ "no-deps": "^2.0.0" });
    expect(await exists(join(dir, "node_modules"))).toBe(false);
    await expectInSync(dir);
  });

  test("bun add --trust", async () => {
    const dir = await setup({ "package.json": root({}) }, { install: false });
    await run(dir, "add", "uses-what-bin@1.0.0", "--trust");
    expect(await pkg(dir)).toEqual({
      name: "foo",
      dependencies: { "uses-what-bin": "1.0.0" },
      trustedDependencies: ["uses-what-bin"],
    });
    expect(await exists(join(dir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBe(true);
    await expectInSync(dir);
  });

  test("bun add --trust of a package already listed in devDependencies", async () => {
    const dir = await setup({ "package.json": root({ devDependencies: { "uses-what-bin": "1.0.0" } }) });
    await run(dir, "add", "uses-what-bin@1.0.0", "--trust");
    const manifest = await pkg(dir);
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toEqual({ "uses-what-bin": "1.0.0" });
    expect(manifest.trustedDependencies).toEqual(["uses-what-bin"]);
    expect(await exists(join(dir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBe(true);
    await expectInSync(dir);
  });

  test("bun add --dry-run writes neither file", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "a-dep": "1.0.1" } }) });
    const [pkgBefore, lockBefore] = await Promise.all([file(join(dir, "package.json")).text(), lockText(dir)]);
    await run(dir, "add", "no-deps", "--dry-run");
    expect(await file(join(dir, "package.json")).text()).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);
  });
});

describe.concurrent("catalogs", () => {
  const CATALOG_REPO = (catalog: Json = { "no-deps": "^1.0.0", aliased: "npm:no-deps" }) =>
    MONOREPO(
      { dependencies: { "no-deps": "catalog:", aliased: "catalog:" } },
      { workspaces: { packages: ["packages/*"], catalog } },
    );

  test("bun update", async () => {
    const dir = await setup(CATALOG_REPO());
    await run(dir, "update");
    const expected = { "no-deps": "^1.1.0", aliased: "npm:no-deps@^2.0.0" };
    expect((await pkg(dir)).workspaces.catalog).toEqual(expected);
    expect((await lock(dir)).catalog).toEqual(expected);
    expect((await pkg(dir, PKG1)).dependencies).toEqual({ "no-deps": "catalog:", aliased: "catalog:" });
    await expectInSync(dir, ["", PKG1]);
  });

  test.each([[""], [PKG1]])("bun update --latest from '%s' installs offline afterwards", async cwd => {
    const dir = await setup(CATALOG_REPO());
    await run(join(dir, cwd), "update", "--latest");
    const expected = { "no-deps": "^2.0.0", aliased: "npm:no-deps@^2.0.0" };
    expect((await pkg(dir)).workspaces.catalog).toEqual(expected);
    const lockfile = await lock(dir);
    expect(lockfile.catalog).toEqual(expected);
    expect(JSON.stringify(lockfile)).not.toContain('"latest"');
    await expectInSync(dir, ["", PKG1]);

    await write(
      join(dir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: { cache: join(dir, ".bun-cache"), registry: "http://127.0.0.1:1/", saveTextLockfile: true },
      }),
    );
    await run(join(dir, cwd), "install", "--frozen-lockfile");
  });

  test("bun add --catalog --filter", async () => {
    const dir = await setup(CATALOG_REPO());
    await run(dir, "add", "a-dep", "--catalog", "--filter", "pkg1");
    expect((await pkg(dir)).workspaces.catalog["a-dep"]).toBe("^1.0.10");
    expect((await lock(dir)).catalog["a-dep"]).toBe("^1.0.10");
    expect((await pkg(dir, PKG1)).dependencies["a-dep"]).toBe("catalog:");
    await expectInSync(dir, ["", PKG1]);
  });
});

describe.concurrent("$ref overrides", () => {
  test("$name follows the rewritten dependency", async () => {
    const overrides = { "no-deps": "$no-deps" };
    const dir = await setup({
      "package.json": root({ dependencies: { "no-deps": "1.0.0", "one-range-dep": "1.0.0" }, overrides }),
    });
    await writePkg(dir, root({ dependencies: { "no-deps": "^1.0.0", "one-range-dep": "1.0.0" }, overrides }));
    await run(dir, "update");
    const manifest = await pkg(dir);
    expect(manifest.dependencies).toEqual({ "no-deps": "^1.1.0", "one-range-dep": "1.0.0" });
    expect(manifest.overrides).toEqual(overrides);
    expect((await lock(dir)).overrides).toEqual({ "no-deps": "^1.1.0" });
    await expectInSync(dir);
  });

  test.each([["^1.0.1"], ["^1.0.0"]])("literal override %s stays as written", async override => {
    const dir = await setup({
      "package.json": root({ dependencies: { "no-deps": "^1.0.0" }, overrides: { "no-deps": override } }),
    });
    await run(dir, "update");
    const manifest = await pkg(dir);
    expect(manifest.dependencies).toEqual({ "no-deps": "^1.1.0" });
    expect(manifest.overrides).toEqual({ "no-deps": override });
    expect((await lock(dir)).overrides).toEqual({ "no-deps": override });
    await expectInSync(dir);
  });

  test("$alias follows the rewritten alias", async () => {
    const dir = await setup({
      "package.json": root({ dependencies: { a1: "npm:no-deps@^1.0.0" }, overrides: { a1: "$a1" } }),
    });
    await run(dir, "update");
    expect((await pkg(dir)).dependencies).toEqual({ a1: "npm:no-deps@^1.1.0" });
    expect((await lock(dir)).overrides).toEqual({ a1: "npm:no-deps@^1.1.0" });
    await expectInSync(dir);
  });
});

describe.concurrent("bumping a direct dependency re-points its dependents", () => {
  const nested = (dir: string) => exists(join(dir, "node_modules", "one-range-dep", "node_modules"));
  const deps = (noDeps: string) => root({ dependencies: { "one-range-dep": "1.0.0", "no-deps": noDeps } });

  test.each([
    ["text", true],
    ["binary", false],
  ])("bun install after editing package.json (%s lockfile)", async (_, text) => {
    const dir = await setup({ "package.json": deps("1.0.0") }, { text });
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "1.0.0" });
    expect(await nested(dir)).toBe(false);

    await writePkg(dir, deps("1.0.1"));
    await runBunInstall(bunEnv, dir);
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "1.0.1" });
    expect(await nested(dir)).toBe(false);
    if (text) {
      const { packages } = await lock(dir);
      expect(Object.keys(packages).sort()).toEqual(["no-deps", "one-range-dep"]);
      expect(packages["no-deps"][0]).toBe("no-deps@1.0.1");
    }

    await writePkg(dir, deps("2.0.0"));
    await runBunInstall(bunEnv, dir);
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "2.0.0" });
    expect(await installed(dir, "one-range-dep/node_modules/no-deps")).toMatchObject({ version: "1.0.1" });
    if (text) {
      const { packages } = await lock(dir);
      expect(packages["no-deps"][0]).toBe("no-deps@2.0.0");
      expect(packages["one-range-dep/no-deps"][0]).toBe("no-deps@1.0.1");
    }
  });

  test("declared by a workspace member", async () => {
    const dir = await setup(MONOREPO({ dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0" } }));
    expect((await lock(dir)).packages["no-deps"][0]).toBe("no-deps@1.0.0");

    await writePkg(
      dir,
      { name: "pkg1", version: "1.0.0", dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.1" } },
      PKG1,
    );
    await runBunInstall(bunEnv, dir);
    const { packages } = await lock(dir);
    expect(packages["no-deps"][0]).toBe("no-deps@1.0.1");
    expect(packages["one-range-dep/no-deps"]).toBeUndefined();
    expect(await nested(dir)).toBe(false);
  });

  test("bun update", async () => {
    const dir = await setup({ "package.json": deps("1.0.0") });
    await writePkg(dir, deps("^1.0.0"));
    await run(dir, "update");
    const { packages } = await lock(dir);
    expect(packages["no-deps"][0]).toBe("no-deps@1.1.0");
    expect(packages["one-range-dep/no-deps"]).toBeUndefined();
    expect(await nested(dir)).toBe(false);
    await expectInSync(dir);
  });

  test("a dependency added later never drags dependents along", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "one-range-dep": "1.0.0" } }) });
    expect((await lock(dir)).packages["no-deps"][0]).toBe("no-deps@1.1.0");

    await writePkg(dir, deps("1.0.0"));
    await runBunInstall(bunEnv, dir);
    const { packages } = await lock(dir);
    expect(packages["no-deps"][0]).toBe("no-deps@1.0.0");
    expect(packages["one-range-dep/no-deps"][0]).toBe("no-deps@1.1.0");
    await expectInSync(dir);
  });
});
