import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "fs";
import { rm } from "fs/promises";
import { bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";
import { installEnv, TestRegistry } from "registry";

const registry = new TestRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type Linker = "hoisted" | "isolated";

async function run(dir: string, ...cmd: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd: dir,
    env: installEnv(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, exitCode };
}

const install = (dir: string, ...args: string[]) => run(dir, "install", ...args);
const migrate = (dir: string) => run(dir, "pm", "migrate");

// Filters out the stderr lines about a command's progress, as opposed to its findings: install progress, "Saved
// lockfile" (the cases that care assert it on `err` directly), and the package.json excerpt printed under a located
// warning.
const stderrNoise =
  /^(?:Resolving dependencies|Resolved, downloaded and extracted \[\d+\]|Saved lockfile|\s*\d+ \| .*|\s*\^|\s+at .*)$/;

// The warnings, errors and notes a command printed, one entry per line; a migration line loses its timing prefix.
function diagnostics(err: string): string[] {
  return err
    .split(/\r?\n/)
    .filter(line => line !== "" && !stderrNoise.test(line))
    .map(line => line.replace(/^\[[\d.]+m?s\] /, ""));
}

// Returns what a successful install prints after its last blank line. A direct dependency that was removed adds the
// "Removed: N" line, which replaces the summary if nothing had to be linked.
const installSummary =
  /^(?:\d+ packages? installed(?:\nRemoved: \d+)?|\d+ packages? removed|Checked \d+ installs? across \d+ packages? \(no changes\)|Done! Checked \d+ packages? \(no changes\)|Saved bun\.lock \(\d+ packages?\))$/;

// An install that prints nothing but progress to stderr and ends stdout with a summary, returned without its timing.
async function installOk(dir: string, ...args: string[]) {
  const result = await install(dir, ...args);
  expect(diagnostics(result.err)).toEqual([]);
  const out = result.out.trimEnd().split(/\r?\n/);
  expect(out[0]).toBe(`bun install ${Bun.version_with_sha}`);
  const summary = out
    .slice(out.lastIndexOf("") + 1)
    .join("\n")
    .replace(/ \[[\d.]+m?s\]/, "");
  expect(summary).toMatch(installSummary);
  expect(result.exitCode).toBe(0);
  return { ...result, summary };
}

// An install that finds everything in place: it links nothing and does not write bun.lock.
async function installNoChanges(dir: string, ...args: string[]) {
  const result = await installOk(dir, ...args);
  expect(result.summary).toEndWith("(no changes)");
  expect(result.err).not.toContain("Saved lockfile");
  return result;
}

// What `from` (a dependency name, a workspace path, or "." / undefined for the root) gets when it requires `name`, as
// `name@version`. Walks the node_modules directories require() would try, from the dependency's real directory so that
// the isolated linker's per-package links are what is under test. It reads the disk every time: the in-process resolver
// caches directory listings, and several cases look at a project again after a re-install has moved packages around.
async function packageSeenBy(packageDir: string, from: string | undefined, name: string): Promise<string> {
  const start =
    from === undefined || from === "."
      ? packageDir
      : from.includes("/")
        ? join(packageDir, from)
        : realpathSync(join(packageDir, "node_modules", from));
  let dir = start;
  while (true) {
    const manifest = join(dir, "node_modules", name, "package.json");
    if (existsSync(manifest)) {
      const installed = await file(manifest).json();
      return `${installed.name}@${installed.version}`;
    }
    const parent = join(dir, "..");
    if (dir === packageDir || parent === dir) {
      throw new Error(`${name} is not installed for ${from ?? "the root"} (looked up from ${start})`);
    }
    dir = parent;
  }
}

async function versionSeenBy(packageDir: string, from: string | undefined, name: string): Promise<string> {
  const seen = await packageSeenBy(packageDir, from, name);
  return seen.slice(seen.lastIndexOf("@") + 1);
}

// Asserts the version of `name` that every dependent listed in `expected` gets; keys are `from` values as packageSeenBy takes them.
async function expectVersionsSeenBy(packageDir: string, name: string, expected: Record<string, string>) {
  const seen: Record<string, string> = {};
  for (const from of Object.keys(expected)) seen[from] = await versionSeenBy(packageDir, from, name);
  expect(seen).toEqual(expected);
}

const lock = (dir: string) => file(join(dir, "bun.lock")).text();
const packageJsonText = (dir: string) => file(join(dir, "package.json")).text();
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

function overridesSection(text: string) {
  const start = text.indexOf('  "overrides": {');
  expect(start).not.toBe(-1);
  const end = text.indexOf("\n  },\n", start);
  expect(end).not.toBe(-1);
  return text
    .slice(start, end + "\n  },".length)
    .split("\n")
    .map(line => line.slice(2))
    .join("\n");
}

async function integrityOf(name: string, version: string): Promise<string> {
  const manifest = await file(join(registry.packagesPath, name, "package.json")).json();
  return manifest.versions[version].dist.integrity;
}

function project(pkg: Record<string, unknown>, linker: Linker = "hoisted", extraFiles: Record<string, string> = {}) {
  return registry
    .createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": JSON.stringify({ name: "nested-overrides", ...pkg }),
        ...extraFiles,
      },
    })
    .then(({ packageDir }) => packageDir);
}

const twoParents = { ofd1: "npm:one-fixed-dep@1.0.0", ofd2: "npm:one-fixed-dep@2.0.0" };

const npmObjectProject = {
  dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0" },
  overrides: { "one-dep": { "no-deps": "2.0.0" } },
};

const precedenceProject = {
  dependencies: { ...twoParents, "one-range-dep": "1.0.0" },
  overrides: {
    "no-deps": "1.0.0",
    "one-fixed-dep": { "no-deps": "1.0.1" },
    "one-fixed-dep@2": { "no-deps": "1.1.0" },
  },
};

// one-range-dep -> no-deps 1.0.0, one-dep -> no-deps 2.0.0
const rangedProject = {
  dependencies: { "one-range-dep": "1.0.0", "one-dep": "1.0.0" },
  overrides: { "no-deps@1": "1.0.0", "one-dep": { "no-deps@1": "2.0.0" } },
};

describe.concurrent("syntax", () => {
  test("npm object scopes the rule to the parent's edge", async () => {
    const dir = await project(npmObjectProject);
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "2.0.0", "one-range-dep": "1.1.0" });
    const text = await lock(dir);
    expect(overridesSection(text)).toMatchInlineSnapshot(`
      ""overrides": {
        "one-dep": {
          "no-deps": "2.0.0",
        },
      },"
    `);
    expect(text).toContain('"lockfileVersion": 3');
  });

  test('"." overrides the parent itself next to its children', async () => {
    const dir = await project({
      dependencies: { "one-fixed-dep": "^2.0.0" },
      overrides: { "one-fixed-dep": { ".": "1.0.0", "no-deps": "1.1.0" } },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, undefined, "one-fixed-dep")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "one-fixed-dep", "no-deps")).toBe("1.1.0");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "one-fixed-dep": {
          ".": "1.0.0",
          "no-deps": "1.1.0",
        },
      },"
    `);
  });

  test("parent range is matched against the parent's resolved version, through an alias", async () => {
    const dir = await project({
      dependencies: twoParents,
      overrides: { "one-fixed-dep@1": { "no-deps": "1.1.0" } },
    });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.1.0", ofd2: "2.0.0" });
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "one-fixed-dep@1": {
          "no-deps": "1.1.0",
        },
      },"
    `);
  });

  test("$ref inside a nested value resolves against the root's dependencies", async () => {
    const dir = await project({
      dependencies: { "no-deps": "1.1.0", "one-dep": "1.0.0" },
      overrides: { "one-dep": { "no-deps": "$no-deps" } },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.1.0");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "one-dep": {
          "no-deps": "1.1.0",
        },
      },"
    `);
  });

  test("$ref inside a nested value that names nothing warns and is skipped", async () => {
    const dir = await project({
      dependencies: { "one-dep": "1.0.0" },
      overrides: { "one-dep": { "no-deps": "$nope" } },
    });
    const { err, exitCode } = await install(dir);
    expect(diagnostics(err)).toEqual(['warn: Could not resolve "$nope": "nope" is not in dependencies']);
    expect(exitCode).toBe(0);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
  });

  describe.concurrent.each([
    "one-dep/no-deps",
    "**/one-dep/no-deps",
    "**/one-dep/**/no-deps",
    "one-dep@npm:1.0.0/no-deps",
  ])("yarn resolutions path %s", key => {
    test("applies to one-dep's edge only", async () => {
      const dir = await project({
        dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0" },
        resolutions: { [key]: "2.0.0" },
      });
      await installOk(dir);
      await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "2.0.0", "one-range-dep": "1.1.0" });
    });
  });

  test("yarn resolutions path with scoped parent and child", async () => {
    const dir = await project(
      { workspaces: ["packages/*"], resolutions: { "@scoped/app/@types/no-deps": "1.0.0" } },
      "hoisted",
      {
        "packages/app/package.json": JSON.stringify({ name: "@scoped/app", dependencies: { "@types/no-deps": "*" } }),
        "packages/other/package.json": JSON.stringify({ name: "other", dependencies: { "@types/no-deps": "2.0.0" } }),
      },
    );
    await installOk(dir);
    await expectVersionsSeenBy(dir, "@types/no-deps", { "packages/app": "1.0.0", "packages/other": "2.0.0" });
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "@scoped/app": {
          "@types/no-deps": "1.0.0",
        },
      },"
    `);
  });

  test("pnpm parent>child selector", async () => {
    const dir = await project({
      dependencies: { "one-dep": "1.0.0" },
      overrides: { "one-dep>no-deps": "2.0.0" },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });

  test("pnpm parent@range>child selectors, including a range containing >", async () => {
    const dir = await project({
      dependencies: twoParents,
      overrides: { "one-fixed-dep@1>no-deps": "1.1.0", "one-fixed-dep@>=2 <3>no-deps": "1.0.1" },
    });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.1.0", ofd2: "1.0.1" });
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "one-fixed-dep@1": {
          "no-deps": "1.1.0",
        },
        "one-fixed-dep@>=2 <3": {
          "no-deps": "1.0.1",
        },
      },"
    `);
  });

  // pnpm splits on the first `>` not preceded by a space, `|` or `@`, so a compound parent range may contain ` >`.
  describe.concurrent.each([
    { key: "one-dep@<2 >=1>no-deps", object: { "one-dep@<2 >=1": { "no-deps": "2.0.0" } } },
    { key: "one-dep@1 >0>no-deps", object: { "one-dep@1 >0": { "no-deps": "2.0.0" } } },
    { key: "one-dep@>=1 <2>no-deps", object: { "one-dep@>=1 <2": { "no-deps": "2.0.0" } } },
    { key: "one-dep>no-deps@>=1", object: { "one-dep": { "no-deps@>=1": "2.0.0" } } },
    { key: "one-dep@1 >0>no-deps@>=1", object: { "one-dep@1 >0": { "no-deps@>=1": "2.0.0" } } },
  ])("pnpm selector $key", ({ key, object }) => {
    test("applies and writes the same bun.lock as the object form", async () => {
      const dependencies = { "one-dep": "1.0.0", "one-range-dep": "1.0.0" };
      const [pnpmDir, objectDir] = await Promise.all([
        project({ dependencies, overrides: { [key]: "2.0.0" } }),
        project({ dependencies, overrides: object }),
      ]);
      await Promise.all([installOk(pnpmDir), installOk(objectDir)]);
      await expectVersionsSeenBy(pnpmDir, "no-deps", { "one-dep": "2.0.0", "one-range-dep": "1.1.0" });
      const [pnpmLock, objectLock] = await Promise.all([lock(pnpmDir), lock(objectDir)]);
      expect(pnpmLock).toContain('"lockfileVersion": 3');
      expect(pnpmLock).toBe(objectLock);
      const [parent, child] = Object.entries(object)[0];
      expect(overridesSection(pnpmLock)).toBe(
        `"overrides": {\n  ${JSON.stringify(parent)}: {\n    ${JSON.stringify(Object.keys(child)[0])}: "2.0.0",\n  },\n},`,
      );
      await installNoChanges(pnpmDir, "--frozen-lockfile");
    });
  });

  test("precedence: ranged parent > unranged parent > flat", async () => {
    const dir = await project(precedenceProject);
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.0.1", ofd2: "1.1.0", "one-range-dep": "1.0.0" });
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps": "1.0.0",
        "one-fixed-dep": {
          "no-deps": "1.0.1",
        },
        "one-fixed-dep@2": {
          "no-deps": "1.1.0",
        },
      },"
    `);
  });

  test("a flat rule and an unranged group for the same name share one lockfile object", async () => {
    const dir = await project({
      dependencies: { "one-dep": "^1.0.0" },
      overrides: { "one-dep": "1.0.0", "one-dep>no-deps": "2.0.0" },
    });
    await installOk(dir);
    const first = await lock(dir);
    expect(overridesSection(first)).toMatchInlineSnapshot(`
      ""overrides": {
        "one-dep": {
          ".": "1.0.0",
          "no-deps": "2.0.0",
        },
      },"
    `);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
    await installNoChanges(dir);
    expect(await lock(dir)).toBe(first);
  });

  test("the same rule spelled in two syntaxes: last one wins and one row is written", async () => {
    const dir = await project({
      dependencies: { "one-dep": "1.0.0" },
      overrides: { "one-dep>no-deps": "1.0.0", "one-dep": { "no-deps": "2.0.0" } },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "one-dep": {
          "no-deps": "2.0.0",
        },
      },"
    `);
    await installNoChanges(dir, "--frozen-lockfile");
  });

  describe.concurrent.each(["overrides", "resolutions"] as const)('a "//" comment key in %s', field => {
    test("is ignored without a warning and never reaches bun.lock", async () => {
      const dir = await project({
        dependencies: { "one-dep": "1.0.0" },
        [field]: { "//": "pins no-deps until upstream updates", "no-deps": "1.0.0" },
      });
      await installOk(dir);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.0");
      const text = await lock(dir);
      expect(text).not.toContain('"//"');
      expect(overridesSection(text)).toMatchInlineSnapshot(`
        ""overrides": {
          "no-deps": "1.0.0",
        },"
      `);
      await installNoChanges(dir, "--frozen-lockfile");
    });
  });

  describe.concurrent("rejected keys warn and are ignored", () => {
    test("pnpm a>b>c", async () => {
      const dir = await project({
        dependencies: { "one-one-dep": "1.0.0" },
        overrides: { "one-one-dep>one-dep>no-deps": "2.0.0" },
      });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual(['warn: Bun currently only supports one level of nested "overrides"']);
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await lock(dir)).not.toContain('"overrides"');
    });

    test.each([
      { rules: { overrides: { "one-dep>": "2.0.0" } }, warning: "Missing overridden package name" },
      { rules: { overrides: { "": "2.0.0" } }, warning: "Missing overridden package name" },
      { rules: { overrides: { "one-dep": { "": "2.0.0" } } }, warning: "Missing overridden package name" },
      { rules: { resolutions: { "one-dep/**": "2.0.0" } }, warning: "Missing resolution package name" },
      { rules: { resolutions: { "one-dep/": "2.0.0" } }, warning: "Missing resolution package name" },
      { rules: { resolutions: { "one-dep/@scope": "2.0.0" } }, warning: 'invalid package name "one-dep/@scope"' },
      { rules: { overrides: { "@types": "2.0.0" } }, warning: 'invalid package name "@types"' },
      { rules: { overrides: { "@types": { "no-deps": "2.0.0" } } }, warning: 'invalid package name "@types"' },
      { rules: { overrides: { "one-dep": { "@types": "2.0.0" } } }, warning: 'invalid package name "@types"' },
      { rules: { resolutions: { "@types": "2.0.0" } }, warning: 'invalid package name "@types"' },
    ])("selector %j", async ({ rules, warning }) => {
      const dir = await project({ dependencies: { "one-dep": "1.0.0" }, ...rules });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual([`warn: ${warning}`]);
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await lock(dir)).not.toContain('"overrides"');
    });

    test.each([
      { rules: { overrides: { "no-deps": 2 } }, warning: 'Invalid override value for "no-deps"' },
      { rules: { overrides: { "no-deps": ["2.0.0"] } }, warning: 'Invalid override value for "no-deps"' },
      { rules: { overrides: { "one-dep": { "no-deps": 2 } } }, warning: 'Invalid override value for "no-deps"' },
      { rules: { overrides: { "one-dep": { "no-deps": null } } }, warning: 'Invalid override value for "no-deps"' },
      {
        rules: { resolutions: { "one-dep": { "no-deps": "2.0.0" } } },
        warning: 'Invalid resolution value for "one-dep"',
      },
      { rules: { resolutions: { "no-deps": 2 } }, warning: 'Invalid resolution value for "no-deps"' },
      {
        rules: { overrides: { "one-dep": { "no-deps": "patch:no-deps@1.0.1#patches/no-deps.patch" } } },
        warning: 'Bun currently does not support patched package "overrides"',
      },
      {
        rules: { resolutions: { "one-dep/no-deps": "patch:no-deps@1.0.1#patches/no-deps.patch" } },
        warning: 'Bun currently does not support patched package "resolutions"',
      },
      { rules: { overrides: { "no-deps": "" } }, warning: "Missing override value" },
      { rules: { overrides: { "one-dep": { "no-deps": "" } } }, warning: "Missing override value" },
      { rules: { overrides: { "one-dep": { ".": "" } } }, warning: "Missing override value" },
      { rules: { resolutions: { "one-dep/no-deps": "" } }, warning: "Missing resolution value" },
    ])("value %j", async ({ rules, warning }) => {
      const dir = await project({ dependencies: { "one-dep": "1.0.0" }, ...rules });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual([`warn: ${warning}`]);
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, undefined, "one-dep")).toBe("1.0.0");
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await lock(dir)).not.toContain('"overrides"');
    });

    test("two levels of objects", async () => {
      const dir = await project({
        dependencies: { "one-one-dep": "1.0.0" },
        overrides: { "one-one-dep": { "one-dep": { "no-deps": "2.0.0" } } },
      });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual(['warn: Bun currently only supports one level of nested "overrides"']);
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await lock(dir)).not.toContain('"lockfileVersion": 3');
    });

    test("three-segment resolutions path", async () => {
      const dir = await project({
        dependencies: { "one-one-dep": "1.0.0" },
        resolutions: { "one-one-dep/one-dep/no-deps": "2.0.0" },
      });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual(['warn: Bun currently only supports one level of nested "resolutions"']);
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await lock(dir)).not.toContain('"lockfileVersion": 3');
    });

    test("unparsable parent range with several children warns once, pointing at the parent key", async () => {
      const dir = await project({
        dependencies: { "one-dep": "1.0.0" },
        overrides: { "one-dep@banana": { "no-deps": "2.0.0", "left-pad": "1.0.0", "a-dep": "$zzz" } },
      });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual(['warn: Invalid version range "banana" for "one-dep"']);
      const column = (await packageJsonText(dir)).indexOf('"one-dep@banana"') + 1;
      expect(column).toBeGreaterThan(0);
      expect(err).toContain(`package.json:1:${column}`);
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await lock(dir)).not.toContain('"lockfileVersion": 3');
    });

    test("an empty parent range warns with the key it is missing from", async () => {
      const dir = await project({
        dependencies: { "one-dep": "1.0.0" },
        overrides: { "one-dep@": { "no-deps": "2.0.0" } },
      });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual(['warn: Missing version range after "one-dep@"']);
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await lock(dir)).not.toContain('"overrides"');
    });

    // Installing with no rule applied would hide the typo.
    describe.concurrent.each([
      { field: "overrides", value: "no-deps@2.0.0" },
      { field: "overrides", value: ["no-deps@2.0.0"] },
      { field: "overrides", value: null },
      { field: "resolutions", value: "no-deps@2.0.0" },
      { field: "resolutions", value: ["no-deps@2.0.0"] },
      { field: "resolutions", value: null },
    ])("a non-object field %j", ({ field, value }) => {
      test("fails the install with an error that points at the value", async () => {
        const dir = await project({ dependencies: { "one-dep": "1.0.0" }, [field]: value });
        const { err, exitCode } = await install(dir);
        const column =
          (await packageJsonText(dir)).indexOf(`"${field}":${JSON.stringify(value)}`) + `"${field}":`.length;
        expect(err).toContain(
          `error: "${field}" expects a map of package names to versions, e.g.\n  "${field}": {\n    "react": "18.2.0"\n  }\n`,
        );
        expect(err).toContain(`package.json:1:${column + 1}\n`);
        expect(err).not.toContain("internal error");
        expect(exitCode).toBe(1);
        expect(existsSync(join(dir, "node_modules"))).toBeFalse();
        expect(existsSync(join(dir, "bun.lock"))).toBeFalse();
      });
    });

    test("--silent prints nothing for rejected rules", async () => {
      const dir = await project({
        dependencies: { "one-dep": "1.0.0" },
        overrides: { "no-deps": "-", "one-dep@": { "no-deps": "1.0.0" }, "a-dep": "$nope", "one-dep>": "1.0.0" },
      });
      const { out, err, exitCode } = await install(dir, "--silent");
      expect(out).toBe("");
      expect(err).toBe("");
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await lock(dir)).not.toContain('"overrides"');
    });
  });

  // pnpm's `-` deletes the dependency; Bun warns and installs as if the rule were absent (both dependents pin no-deps exactly, so nothing can dedupe onto the other's version).
  describe.concurrent.each([
    { overrides: { "no-deps": "-" } },
    { overrides: { "one-dep": { "no-deps": "-" } } },
    { resolutions: { "no-deps": "-" } },
    { resolutions: { "one-dep/no-deps": "-" } },
  ])('a "-" value warns and is ignored %j', rules => {
    test("install still succeeds", async () => {
      const dir = await project({ dependencies: { "one-dep": "1.0.0", ofd2: twoParents.ofd2 }, ...rules });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual(['warn: Removing "no-deps" with "-" is not supported']);
      expect(exitCode).toBe(0);
      await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "1.0.1", ofd2: "2.0.0" });
      expect(await lock(dir)).not.toContain('"overrides"');
    });
  });
});

// two-range-deps declares no-deps ^1.0.0 (1.1.0 without a rule) and @types/is-number >=1.0.0 (2.0.0 without a rule).
describe.concurrent("overrides and resolutions in the same package.json", () => {
  test.each([
    ["a flat rule", { "@types/is-number": "1.0.0" }],
    ["a scoped rule", { "two-range-deps/@types/is-number": "1.0.0" }],
    ["what is not an object", "1.0.0"],
  ])("%s in resolutions is not read", async (_, resolutions) => {
    const dir = await project({
      dependencies: { "two-range-deps": "1.0.0" },
      overrides: { "no-deps": "1.0.0" },
      resolutions,
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, "two-range-deps", "no-deps")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "two-range-deps", "@types/is-number")).toBe("2.0.0");
    const first = await lock(dir);
    expect(overridesSection(first)).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps": "1.0.0",
      },"
    `);
    await installNoChanges(dir, "--frozen-lockfile");
    await installNoChanges(dir);
    expect(await lock(dir)).toBe(first);
  });

  test("the same name in both fields: overrides wins", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0" },
      overrides: { "no-deps": "1.0.0" },
      resolutions: { "no-deps": "1.0.1" },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps": "1.0.0",
      },"
    `);
  });

  // A flat `npm:` rule also registers an alias that redirects matching edges before overrides are consulted.
  test("a resolutions rule with an npm: value does not redirect the edge", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0" },
      overrides: { "no-deps": "1.0.0" },
      resolutions: { "no-deps": "npm:a-dep@1.0.1" },
    });
    await installOk(dir);
    expect(await packageSeenBy(dir, "one-range-dep", "no-deps")).toBe("no-deps@1.0.0");
    expect(await lock(dir)).not.toContain("a-dep");
  });

  test("the same scoped selector in both fields: overrides wins", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0" },
      overrides: { "one-range-dep": { "no-deps": "1.0.0" } },
      resolutions: { "one-range-dep/no-deps": "1.0.1" },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "one-range-dep": {
          "no-deps": "1.0.0",
        },
      },"
    `);
  });

  test("editing resolutions next to overrides changes nothing", async () => {
    const pkg = {
      dependencies: { "two-range-deps": "1.0.0" },
      overrides: { "no-deps": "1.0.0" },
      resolutions: { "@types/is-number": "2.0.0" },
    };
    const dir = await project(pkg);
    await installOk(dir);
    const first = await lock(dir);
    pkg.resolutions["@types/is-number"] = "1.0.0";
    await write(join(dir, "package.json"), JSON.stringify({ name: "nested-overrides", ...pkg }));
    await installNoChanges(dir, "--frozen-lockfile");
    await installNoChanges(dir);
    expect(await lock(dir)).toBe(first);
  });
});

// The selector range is matched against the range the dependent declares; a rule applies when the two intersect.
describe.concurrent("version-scoped targets", () => {
  test("a flat name@range rule applies to edges whose declared range intersects it", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0", ...twoParents },
      overrides: { "no-deps@1": "1.0.0" },
    });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { "one-range-dep": "1.0.0", ofd2: "2.0.0", ofd1: "1.0.0" });
    const text = await lock(dir);
    expect(overridesSection(text)).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps@1": {
          ".": "1.0.0",
        },
      },"
    `);
    expect(text).toContain('"lockfileVersion": 3');
  });

  test("pnpm audit --fix shaped key with a compound range", async () => {
    const dir = await project({
      dependencies: { "one-dep": "1.0.0", ...twoParents },
      overrides: { "no-deps@>=1.0.0 <1.1.0": "1.1.0" },
    });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "1.1.0", ofd1: "1.1.0", ofd2: "2.0.0" });
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps@>=1.0.0 <1.1.0": {
          ".": "1.1.0",
        },
      },"
    `);
  });

  test("|| alternatives are matched independently", async () => {
    const dir = await project({
      dependencies: { "one-dep": "1.0.0", ...twoParents },
      overrides: { "no-deps@1.0.0 || 2.0.0": "1.1.0" },
    });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.1.0", ofd2: "1.1.0", "one-dep": "1.0.1" });
  });

  test("a declared || range matches when either alternative intersects the selector", async () => {
    const dir = await project({
      dependencies: { "no-deps": "1.0.0 || 2.0.0" },
      overrides: { "no-deps@2": "1.1.0" },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, undefined, "no-deps")).toBe("1.1.0");
    await installNoChanges(dir, "--frozen-lockfile");
  });

  // Both resolve the `latest` tag, which no selector matches, and write a range that one does.
  test.each([
    ["bun add no-deps", { "a-dep": "1.0.1" }, ["add", "no-deps"], "dependencies"],
    ["bun add --optional no-deps", { "a-dep": "1.0.1" }, ["add", "--optional", "no-deps"], "optionalDependencies"],
    ["bun add --peer no-deps", { "a-dep": "1.0.1" }, ["add", "--peer", "no-deps"], "peerDependencies"],
    ["bun update --latest", { "no-deps": "^1.0.0" }, ["update", "--latest"], "dependencies"],
  ])("%s installs what the rule gives the range it writes", async (_, dependencies, command, group) => {
    const dir = await project({ dependencies, overrides: { "no-deps@2": "1.0.0" } });
    await installOk(dir);
    const { err, exitCode } = await run(dir, ...command);
    expect(diagnostics(err)).toEqual([]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(await packageJsonText(dir))[group]["no-deps"]).toBe("^2.0.0");
    expect(await versionSeenBy(dir, undefined, "no-deps")).toBe("1.0.0");
    expect(await lock(dir)).not.toContain("no-deps@2.0.0");
    await installNoChanges(dir, "--frozen-lockfile");
    await installNoChanges(dir);
  });

  describe.concurrent.each([
    { declared: "*", rule: { "no-deps@1": "1.0.0" }, expected: "1.0.0" },
    { declared: "*", rule: { "no-deps@>2.0.0": "1.0.1" }, expected: "1.0.1" },
    { declared: ">=1.0.0", rule: { "no-deps@1": "1.0.0" }, expected: "1.0.0" },
    { declared: ">=1.0.0", rule: { "no-deps@>2.0.0": "1.0.1" }, expected: "1.0.1" },
  ])("an unbounded declared range %j", ({ declared, rule, expected }) => {
    test("intersects the selector", async () => {
      const dir = await project({ dependencies: { "no-deps": declared }, overrides: rule });
      await installOk(dir);
      expect(await versionSeenBy(dir, undefined, "no-deps")).toBe(expected);
      await installNoChanges(dir, "--frozen-lockfile");
    });
  });

  // `intersects` is what npm's semver 7.7.4 returns, and npm applies a rule based on that. Every rule sets 1.0.0.
  // `untouched` is what the declared range resolves to without the rule.
  describe.concurrent.each([
    // #41371. `^1.0.0` ends at `<2.0.0-0`, so a selector that starts at a 2.0.0 prerelease does not intersect it.
    { declared: "^1.0.0", selector: ">=2.0.0-alpha.0 <3", intersects: false, untouched: "1.1.0" },
    { declared: "^1.0.0", selector: ">=2.0.0-0", intersects: false, untouched: "1.1.0" },
    { declared: "~1.0.0", selector: ">=1.1.0-alpha.0 <2", intersects: false, untouched: "1.0.1" },
    { declared: "1.0.x", selector: ">=1.1.0-alpha.0 <2", intersects: false, untouched: "1.0.1" },
    { declared: "1.0", selector: ">=1.1.0-alpha.0 <2", intersects: false, untouched: "1.0.1" },
    { declared: "1.x", selector: ">=2.0.0-alpha.0 <3", intersects: false, untouched: "1.1.0" },
    { declared: "1", selector: ">=2.0.0-alpha.0 <3", intersects: false, untouched: "1.1.0" },
    { declared: "<2", selector: ">=2.0.0-alpha.0 <3", intersects: false, untouched: "1.1.0" },
    { declared: "1.0.0 - 1.0", selector: ">=1.1.0-alpha.0 <2", intersects: false, untouched: "1.0.1" },
    { declared: "1.0.0 - 1.x", selector: ">=2.0.0-alpha.0 <3", intersects: false, untouched: "1.1.0" },
    // the same pairs with the selector as the sugar
    { declared: ">=2.0.0-alpha.0 <3", selector: "^1.0.0", intersects: false, untouched: "2.0.0" },
    { declared: ">=1.1.0-alpha.0 <2", selector: "~1.0.0", intersects: false, untouched: "1.1.0" },
    { declared: ">=2.0.0-alpha.0", selector: "1.x", intersects: false, untouched: "2.0.0" },
    { declared: ">=2.0.0-alpha.0", selector: "1", intersects: false, untouched: "2.0.0" },
    { declared: ">=2.0.0-alpha.0", selector: "<2", intersects: false, untouched: "2.0.0" },
    { declared: ">=1.1.0-alpha.0", selector: "1.0.0 - 1.0", intersects: false, untouched: "2.0.0" },
    // ranges that do meet, and a bound written in full, which keeps its form
    { declared: "^1.0.0", selector: ">=1.1.0-alpha.0 <2", intersects: true, untouched: "1.1.0" },
    { declared: "~1.0.0", selector: ">=1.0.1-alpha.0 <1.1", intersects: true, untouched: "1.0.1" },
    { declared: ">=1.0.0 <2.0.0-beta", selector: ">=2.0.0-alpha.0 <3", intersects: true, untouched: "1.1.0" },
    { declared: ">=1.0.0 <2.0.0", selector: ">=2.0.0-alpha.0 <3", intersects: true, untouched: "1.1.0" },

    // `<x` and `>x` are `<0.0.0-0`, the empty set.
    { declared: "^1.0.0", selector: "<x", intersects: false, untouched: "1.1.0" },
    { declared: "^1.0.0", selector: ">*", intersects: false, untouched: "1.1.0" },
    // neither side has a lower bound
    { declared: "<2", selector: "<x", intersects: false, untouched: "1.1.0" },
    { declared: "<=1.0.1", selector: ">x", intersects: false, untouched: "1.0.1" },
    // the other alternative of the selector still matches
    { declared: "^1.0.0", selector: "<x || 1", intersects: true, untouched: "1.1.0" },

    // `>1` is `>=2.0.0` and `>1.0` is `>=1.1.0`, so neither meets a range that ends below that bound.
    { declared: "^1.0.0", selector: ">1", intersects: false, untouched: "1.1.0" },
    { declared: "^1.0.0", selector: "> 1", intersects: false, untouched: "1.1.0" },
    { declared: "^1.0.0", selector: ">1.x", intersects: false, untouched: "1.1.0" },
    { declared: "^1.0.0", selector: ">1 <3", intersects: false, untouched: "1.1.0" },
    { declared: "^1.0.0", selector: ">1 || <1.0.0", intersects: false, untouched: "1.1.0" },
    { declared: "1.x", selector: ">1", intersects: false, untouched: "1.1.0" },
    { declared: ">=1.0.0 <2.0.0", selector: ">1", intersects: false, untouched: "1.1.0" },
    { declared: "~1.0.0 || ^1.1.0", selector: ">1", intersects: false, untouched: "1.1.0" },
    { declared: "~1.0.0", selector: ">1.0", intersects: false, untouched: "1.0.1" },
    { declared: "~1.0.0", selector: ">1.0.x", intersects: false, untouched: "1.0.1" },
    { declared: "1.0.x", selector: ">1.0", intersects: false, untouched: "1.0.1" },
    { declared: ">=1.0.0 <1.1.0", selector: ">1.0", intersects: false, untouched: "1.0.1" },
    // the same pairs with `>` in the declared range
    { declared: ">1", selector: "^1.0.0", intersects: false, untouched: "2.0.0" },
    { declared: ">1", selector: "<2.0.0", intersects: false, untouched: "2.0.0" },
    { declared: ">1.0", selector: "~1.0.0", intersects: false, untouched: "2.0.0" },
    // pairs that already did not meet
    { declared: "1.0.0 - 1.1.0", selector: ">1", intersects: false, untouched: "1.1.0" },
    { declared: "1.0.1", selector: ">1.0", intersects: false, untouched: "1.0.1" },
    // ranges that do meet
    { declared: "^2.0.0", selector: ">1", intersects: true, untouched: "2.0.0" },
    { declared: "2.0.0", selector: ">1", intersects: true, untouched: "2.0.0" },
    { declared: "<=2.0.0", selector: ">1", intersects: true, untouched: "2.0.0" },
    { declared: ">=1.0.0", selector: ">1", intersects: true, untouched: "2.0.0" },
    { declared: "^1.0.0", selector: ">1 || 1.0.1", intersects: true, untouched: "1.1.0" },
    { declared: "^1.0.0", selector: ">1.0", intersects: true, untouched: "1.1.0" },
    { declared: "1.1.0", selector: ">1.0", intersects: true, untouched: "1.1.0" },
    { declared: "<=1.1.0", selector: ">1.0", intersects: true, untouched: "1.1.0" },
    { declared: ">1", selector: "^2.0.0", intersects: true, untouched: "2.0.0" },
    { declared: ">1.0", selector: "~1.1.0", intersects: true, untouched: "2.0.0" },
  ])("a declared range and a selector with a derived bound %j", ({ declared, selector, intersects, untouched }) => {
    test(intersects ? "the rule applies" : "the rule leaves the edge alone", async () => {
      const dir = await project({
        dependencies: { "no-deps": declared },
        overrides: { [`no-deps@${selector}`]: "1.0.0" },
      });
      await installOk(dir);
      expect(await versionSeenBy(dir, undefined, "no-deps")).toBe(intersects ? "1.0.0" : untouched);
      await installNoChanges(dir, "--frozen-lockfile");
    });
  });

  // one-range-dep declares no-deps@^1.0.0. The key of #41371 is at the top level of `overrides`.
  describe.concurrent.each([
    { rule: { "one-range-dep": { "no-deps@>=2.0.0-alpha.0 <3": "1.0.0" } } },
    { rule: { "one-range-dep": { "no-deps@>1": "1.0.0" } } },
    { rule: { "no-deps@>=2.0.0-alpha.0 <3": "1.0.0" } },
    { rule: { "no-deps@>=2.0.0-0": "1.0.0" } },
  ])("a selector that starts at the next major %j", ({ rule }) => {
    test("doesn't change a transitive ^ dependency", async () => {
      const dir = await project({ dependencies: { "one-range-dep": "1.0.0" }, overrides: rule });
      await installOk(dir);
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
      await installNoChanges(dir, "--frozen-lockfile");
    });
  });

  test("a selector that no version satisfies doesn't change a * dependency", async () => {
    // npm applies the rule here: its `*` comparator intersects every comparator, `<0.0.0-0` included.
    // Bun does not, because no version satisfies the selector.
    const dir = await project({ dependencies: { "no-deps": "*" }, overrides: { "no-deps@<x": "1.0.0" } });
    await installOk(dir);
    expect(await versionSeenBy(dir, undefined, "no-deps")).toBe("2.0.0");
    await installNoChanges(dir, "--frozen-lockfile");
  });

  // #43138. An edge pinned at an exact prerelease matches a ranged selector only when the
  // prerelease satisfies it, which needs a comparator with a prerelease of the same
  // major.minor.patch. `<1.0.0` has none, so the rule leaves the edge alone, as in npm.
  // `>=1.0.0-0 <1.0.0` applies because `Bun.semver.satisfies` admits the prerelease (npm
  // tests each comparator alone and does not). `*` matches every edge, as in npm, and
  // `>=0.0.0` parses to the same range (npm reads it as a comparator and does not match).
  describe.concurrent.each([
    { declared: "1.0.0-rc.1", selector: "<1.0.0", applies: false },
    { declared: "1.0.0-rc.1 || 1.0.0-rc.0", selector: "<1.0.0", applies: false },
    { declared: "1.0.0-rc.1", selector: ">=1.0.0-0 <1.0.0", applies: true },
    { declared: "1.0.0-rc.1", selector: "1.0.0-rc.1", applies: true },
    { declared: "1.0.0-rc.1", selector: "*", applies: true },
    { declared: "1.0.0-rc.1", selector: ">=0.0.0", applies: true },
  ])("an exact prerelease edge and a ranged selector %j", ({ declared, selector, applies }) => {
    test(applies ? "the rule applies" : "the rule leaves the edge alone", async () => {
      const dir = await project({
        dependencies: { "no-deps-tags": declared },
        overrides: { [`no-deps-tags@${selector}`]: "1.0.0" },
      });
      await installOk(dir);
      expect(await versionSeenBy(dir, undefined, "no-deps-tags")).toBe(applies ? "1.0.0" : "1.0.0-rc.1");
      await installNoChanges(dir, "--frozen-lockfile");
    });
  });

  test("an exact prerelease selector matches a declared range only when the range admits it", async () => {
    const dir = await project({
      dependencies: { "no-deps": "<2" },
      overrides: { "no-deps@2.0.0-alpha.0": "1.0.0" },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, undefined, "no-deps")).toBe("1.1.0");
    await installNoChanges(dir, "--frozen-lockfile");
  });

  test("pnpm key whose range contains > after ||", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0", ofd2: twoParents.ofd2 },
      overrides: { "no-deps@1 || >=2": "1.1.0" },
    });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { "one-range-dep": "1.1.0", ofd2: "1.1.0" });
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps@1 || >=2": {
          ".": "1.1.0",
        },
      },"
    `);
    await installNoChanges(dir, "--frozen-lockfile");
  });

  test("an edge declared with catalog: never matches a selector", async () => {
    const dir = await project(
      {
        workspaces: { packages: ["packages/*"], catalog: { "no-deps": "1.1.0" } },
        dependencies: { "one-range-dep": "1.0.0" },
        overrides: { "no-deps@1": "1.0.0" },
      },
      "hoisted",
      { "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "catalog:" } }) },
    );
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { "packages/app": "1.1.0", "one-range-dep": "1.0.0" });
    await installNoChanges(dir, "--frozen-lockfile");
  });

  test("an edge declared with workspace: never matches a selector", async () => {
    const dir = await project(
      {
        workspaces: ["packages/*"],
        dependencies: { "one-range-dep": "1.0.0" },
        overrides: { "no-deps@1": "1.0.0" },
      },
      "hoisted",
      {
        "packages/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "9.0.0" }),
        "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { "no-deps": "workspace:*" } }),
      },
    );
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { "packages/app": "9.0.0", "one-range-dep": "1.0.0" });
    await installNoChanges(dir, "--frozen-lockfile");
  });

  test("a prerelease selector keeps applying after the lockfile is cloned for a dependency change", async () => {
    const overrides = { "no-deps@>=1.0.0-0 <2": "1.1.0" };
    const dir = await project({ dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0" }, overrides });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "1.1.0", "one-range-dep": "1.1.0" });
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "nested-overrides",
        dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0", "a-dep": "1.0.1" },
        overrides,
      }),
    );
    const { err, summary } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    expect(summary).toBe("1 package installed");
    await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "1.1.0", "one-range-dep": "1.1.0" });
    expect(await versionSeenBy(dir, undefined, "a-dep")).toBe("1.0.1");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps@>=1.0.0-0 <2": {
          ".": "1.1.0",
        },
      },"
    `);
    await installNoChanges(dir, "--frozen-lockfile");
  });

  test("a non-intersecting range leaves the edge alone and is still recorded", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0", "one-dep": "1.0.0" },
      overrides: { "no-deps@2": "1.0.0", "no-deps@<1.0.1": "2.0.0" },
    });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { "one-range-dep": "2.0.0", "one-dep": "1.0.1" });
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps@2": {
          ".": "1.0.0",
        },
        "no-deps@<1.0.1": {
          ".": "2.0.0",
        },
      },"
    `);
    await installNoChanges(dir, "--frozen-lockfile");
  });

  test("edges declared with a dist-tag never match", async () => {
    const dir = await project({
      dependencies: { "no-deps": "latest", "one-range-dep": "1.0.0" },
      overrides: { "no-deps@>=1": "1.0.0" },
    });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { ".": "2.0.0", "one-range-dep": "1.0.0" });
  });

  describe.concurrent.each([
    { overrides: { "one-dep>no-deps@1": "2.0.0" } },
    { overrides: { "one-dep": { "no-deps@1": "2.0.0" } } },
    { resolutions: { "one-dep/no-deps@1": "2.0.0" } },
  ])("nested rules accept a target range in every spelling %j", rules => {
    test("applies to one-dep's edge only", async () => {
      const dir = await project({ dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0" }, ...rules });
      await installOk(dir);
      await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "2.0.0", "one-range-dep": "1.1.0" });
      expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
        ""overrides": {
          "one-dep": {
            "no-deps@1": "2.0.0",
          },
        },"
      `);
    });
  });

  test("a nested rule whose target range does not intersect is inert", async () => {
    const dir = await project({
      dependencies: { "one-dep": "1.0.0" },
      overrides: { "one-dep>no-deps@2": "2.0.0", "one-dep>no-deps@1.0.x": "1.1.0" },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.1.0");
  });

  test('"." inside a ranged group overrides the parent itself only where the declared range intersects', async () => {
    const dir = await project({
      dependencies: { "one-fixed-dep": "^2.0.0" },
      overrides: { "one-fixed-dep@^2": { ".": "1.0.0", "no-deps": "1.1.0" } },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, undefined, "one-fixed-dep")).toBe("1.0.0");
    // The parented rule needs a resolved parent in ^2, and "." just moved the parent to 1.0.0.
    expect(await versionSeenBy(dir, "one-fixed-dep", "no-deps")).toBe("1.0.0");
    const first = await lock(dir);
    expect(overridesSection(first)).toMatchInlineSnapshot(`
      ""overrides": {
        "one-fixed-dep@^2": {
          ".": "1.0.0",
          "no-deps": "1.1.0",
        },
      },"
    `);
    await installNoChanges(dir);
    expect(await lock(dir)).toBe(first);
  });

  test("precedence: parent tiers first, then a matching target range, then flat", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0", "one-dep": "1.0.0", ...twoParents },
      overrides: {
        "no-deps": "1.0.0",
        "no-deps@1": "1.1.0",
        "one-range-dep": { "no-deps": "1.0.1", "no-deps@1": "2.0.0" },
        "one-dep": { "no-deps": "2.0.0" },
      },
    });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", {
      "one-range-dep": "2.0.0",
      "one-dep": "2.0.0",
      ofd1: "1.1.0",
      ofd2: "1.0.0",
    });
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps": "1.0.0",
        "no-deps@1": {
          ".": "1.1.0",
        },
        "one-dep": {
          "no-deps": "2.0.0",
        },
        "one-range-dep": {
          "no-deps": "1.0.1",
          "no-deps@1": "2.0.0",
        },
      },"
    `);
  });

  test("two matching ranged rules: the range text that sorts first wins", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0" },
      overrides: { "no-deps@>=1": "1.0.0", "no-deps@1": "1.0.1" },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.1");
  });

  test("an empty selector warns and is skipped", async () => {
    const dir = await project({ dependencies: { "one-range-dep": "1.0.0" }, overrides: { "no-deps@": "1.0.0" } });
    const { err, exitCode } = await install(dir);
    expect(diagnostics(err)).toEqual(['warn: Missing version range after "no-deps@"']);
    expect(exitCode).toBe(0);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
    expect(await lock(dir)).not.toContain('"overrides"');
  });

  test("an unparsable target range warns with the same message as a parent range", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0" },
      overrides: { "no-deps@banana": "1.0.0" },
    });
    const { err, exitCode } = await install(dir);
    expect(diagnostics(err)).toEqual(['warn: Invalid version range "banana" for "no-deps"']);
    expect(exitCode).toBe(0);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
    expect(await lock(dir)).not.toContain('"lockfileVersion": 3');
  });

  // Yarn matches a `name@range` key against the range as declared, so `catalog:` and `npm:` aliases are valid keys.
  describe.each(["overrides", "resolutions"] as const)("%s", field => {
    test("a catalog: key only overrides dependencies declared with that catalog", async () => {
      const dir = await project({
        workspaces: ["packages/*"],
        catalog: { "no-deps": "^1.0.0" },
        dependencies: { "no-deps": "catalog:", "one-range-dep": "1.0.0" },
        [field]: { "no-deps@catalog:": "2.0.0" },
      });
      await installOk(dir);
      // one-range-dep declares a plain ^1.0.0
      await expectVersionsSeenBy(dir, "no-deps", { ".": "2.0.0", "one-range-dep": "1.1.0" });
      expect(overridesSection(await lock(dir))).toBe(
        `"overrides": {\n  "no-deps@catalog:": {\n    ".": "2.0.0",\n  },\n},`,
      );
      await installNoChanges(dir);
      await installNoChanges(dir, "--frozen-lockfile");
    });

    test.each([
      ["catalog:", "catalog:default"],
      ["catalog:default", "catalog:"],
    ])("a %s key matches a dependency declared as %s", async (key, declared) => {
      const dir = await project({
        workspaces: ["packages/*"],
        catalog: { "no-deps": "^1.0.0" },
        dependencies: { "no-deps": declared },
        [field]: { [`no-deps@${key}`]: "2.0.0" },
      });
      await installOk(dir);
      expect(await versionSeenBy(dir, ".", "no-deps")).toBe("2.0.0");
      await installNoChanges(dir, "--frozen-lockfile");
    });

    test("a catalog: key does not match another catalog group", async () => {
      const dir = await project({
        workspaces: ["packages/*"],
        catalog: { "no-deps": "^1.0.0" },
        catalogs: { old: { "no-deps": "^1.0.0" } },
        dependencies: { "no-deps": "catalog:" },
        [field]: { "no-deps@catalog:old": "1.0.0" },
      });
      await installOk(dir);
      expect(await versionSeenBy(dir, ".", "no-deps")).toBe("1.1.0");
    });

    test("an alias key overrides that alias", async () => {
      const dir = await project({
        dependencies: { "my-alias": "npm:no-deps@^1.0.0" },
        [field]: { "my-alias@npm:no-deps@^1.0.0": "npm:no-deps@1.0.0" },
      });
      await installOk(dir);
      expect(await packageSeenBy(dir, ".", "my-alias")).toBe("no-deps@1.0.0");
      expect(overridesSection(await lock(dir))).toBe(
        `"overrides": {\n  "my-alias@npm:no-deps@^1.0.0": {\n    ".": "npm:no-deps@1.0.0",\n  },\n},`,
      );
      await installNoChanges(dir);
      await installNoChanges(dir, "--frozen-lockfile");
    });

    test("an alias key without a version overrides that alias at any range", async () => {
      const dir = await project({
        dependencies: { "my-alias": "npm:no-deps@^1.0.0" },
        [field]: { "my-alias@npm:no-deps": "npm:no-deps@1.0.0" },
      });
      await installOk(dir);
      expect(await packageSeenBy(dir, ".", "my-alias")).toBe("no-deps@1.0.0");
      await installNoChanges(dir);
      await installNoChanges(dir, "--frozen-lockfile");
    });

    test("an alias key can point at a scoped package", async () => {
      const dir = await project({
        dependencies: { "my-alias": "npm:@types/no-deps@^1.0.0" },
        [field]: { "my-alias@npm:@types/no-deps@^1.0.0": "npm:@types/no-deps@2.0.0" },
      });
      await installOk(dir);
      expect(await packageSeenBy(dir, ".", "my-alias")).toBe("@types/no-deps@2.0.0");
      expect(overridesSection(await lock(dir))).toBe(
        `"overrides": {\n  "my-alias@npm:@types/no-deps@^1.0.0": {\n    ".": "npm:@types/no-deps@2.0.0",\n  },\n},`,
      );
      await installNoChanges(dir);
      await installNoChanges(dir, "--frozen-lockfile");
    });

    // The value of a rule is read under the name in its key, like the specifier of a dependency of that name. For an
    // alias key that name is the alias, not the package that the alias points at. So a `catalog:` rule takes the
    // catalog entry of the alias, also when the package that the alias points at has an entry of its own.
    describe("an alias key with a catalog: value", () => {
      const aliased = (catalogs: Record<string, unknown>, key: string, value = "catalog:") =>
        project({
          workspaces: [],
          ...catalogs,
          dependencies: { "my-alias": "npm:no-deps@^1.0.0" },
          [field]: { [key]: value },
        });

      test.each([
        ["a range", "my-alias@npm:no-deps@^1.0.0"],
        ["no version", "my-alias@npm:no-deps"],
      ])("with %s takes the catalog entry of the alias", async (_, key) => {
        const dir = await aliased({ catalog: { "my-alias": "npm:no-deps@1.0.0", "no-deps": "1.0.1" } }, key);
        await installOk(dir);
        expect(await packageSeenBy(dir, ".", "my-alias")).toBe("no-deps@1.0.0");
        expect(overridesSection(await lock(dir))).toBe(`"overrides": {\n  "${key}": {\n    ".": "catalog:",\n  },\n},`);
        await installNoChanges(dir);
        await installNoChanges(dir, "--frozen-lockfile");
      });

      // one-dep pins no-deps@1.0.1, which is also what the catalog has for no-deps. The alias stays on its own entry.
      test("bun dedupe leaves the alias on the version of its catalog entry", async () => {
        const dir = await project({
          workspaces: [],
          catalog: { "my-alias": "npm:no-deps@1.0.0", "no-deps": "1.0.1" },
          dependencies: { "my-alias": "npm:no-deps@^1.0.0", "one-dep": "1.0.0" },
          [field]: { "my-alias@npm:no-deps@^1.0.0": "catalog:" },
        });
        await installOk(dir);
        expect(await packageSeenBy(dir, ".", "my-alias")).toBe("no-deps@1.0.0");
        expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
        const locked = await lock(dir);
        const { out, err, exitCode } = await run(dir, "dedupe", "--check");
        expect(out).toContain("No duplicates");
        expect(diagnostics(err)).toEqual([]);
        expect(exitCode).toBe(0);
        expect(await lock(dir)).toBe(locked);
      });

      // The entry of the alias is a plain version, so the rule asks the registry for a package with the name in its
      // key, as the same version does when the rule has it inline.
      test.each([
        ["in the catalog entry of the alias", "catalog:"],
        ["inline", "1.0.1"],
      ])("a plain version %s installs the package with the name in the key", async (_, value) => {
        const dir = await project({
          workspaces: [],
          catalog: { "a-dep": "1.0.1", "no-deps": "1.0.0" },
          dependencies: { "a-dep": "npm:no-deps@^1.0.0" },
          [field]: { "a-dep@npm:no-deps@^1.0.0": value },
        });
        await installOk(dir);
        expect(await packageSeenBy(dir, ".", "a-dep")).toBe("a-dep@1.0.1");
        await installNoChanges(dir);
        await installNoChanges(dir, "--frozen-lockfile");
      });

      test("takes the entry of the alias in a named catalog", async () => {
        const dir = await aliased(
          {
            catalog: { "my-alias": "npm:no-deps@1.0.0" },
            catalogs: { pinned: { "my-alias": "npm:no-deps@1.0.1", "no-deps": "2.0.0" } },
          },
          "my-alias@npm:no-deps@^1.0.0",
          "catalog:pinned",
        );
        await installOk(dir);
        expect(await packageSeenBy(dir, ".", "my-alias")).toBe("no-deps@1.0.1");
        await installNoChanges(dir);
        await installNoChanges(dir, "--frozen-lockfile");
      });

      test("scoped to a parent takes the catalog entry of the alias", async () => {
        const dir = await project(
          {
            workspaces: ["packages/*"],
            catalog: { "my-alias": "npm:no-deps@1.0.0", "no-deps": "1.0.1" },
            [field]: { "app>my-alias@npm:no-deps@^1.0.0": "catalog:" },
          },
          "hoisted",
          {
            "packages/app/package.json": JSON.stringify({
              name: "app",
              dependencies: { "my-alias": "npm:no-deps@^1.0.0" },
            }),
          },
        );
        await installOk(dir);
        expect(await packageSeenBy(dir, "packages/app", "my-alias")).toBe("no-deps@1.0.0");
        await installNoChanges(dir);
        await installNoChanges(dir, "--frozen-lockfile");
      });

      test("does not take the entry of the package that the alias points at", async () => {
        const dir = await aliased({ catalog: { "no-deps": "1.0.0" } }, "my-alias@npm:no-deps@^1.0.0");
        const { err, exitCode } = await install(dir);
        expect(diagnostics(err)).toEqual([
          "warn: my-alias@catalog: not in catalog",
          "error: my-alias@npm:no-deps@^1.0.0 failed to resolve",
        ]);
        expect(exitCode).toBe(1);
        expect(existsSync(join(dir, "node_modules", "my-alias"))).toBe(false);
      });
    });

    // `workspace:*` has no name of its own. It links the workspace with the name in the key, as it does for a
    // dependency of that name, and not the workspace with the name of the package that the alias points at.
    describe.each([
      ["in the catalog entry of the alias", "catalog:"],
      ["inline", "workspace:*"],
    ])("an alias key with workspace:* %s", (_, value) => {
      const withMembers = (members: Record<string, string>) =>
        project(
          {
            workspaces: ["packages/*"],
            catalog: { "my-alias": "workspace:*", "no-deps": "1.0.1" },
            [field]: { "my-alias@npm:no-deps@^1.0.0": value },
          },
          "hoisted",
          {
            "packages/app/package.json": JSON.stringify({
              name: "app",
              dependencies: { "my-alias": "npm:no-deps@^1.0.0" },
            }),
            ...members,
          },
        );
      const forAlias = { "packages/my-alias/package.json": `{"name":"my-alias","version":"7.0.0"}` };
      const forTarget = { "packages/no-deps/package.json": `{"name":"no-deps","version":"3.0.0"}` };

      test.each([
        ["next to a workspace for the alias target", { ...forAlias, ...forTarget }],
        ["alone", forAlias],
      ])("links the workspace with the name in the key, %s", async (_, members) => {
        const dir = await withMembers(members);
        await installOk(dir);
        expect(await packageSeenBy(dir, "packages/app", "my-alias")).toBe("my-alias@7.0.0");
        await installNoChanges(dir);
        await installNoChanges(dir, "--frozen-lockfile");
      });

      test("does not link the workspace of the package that the alias points at", async () => {
        const dir = await withMembers(forTarget);
        const { err, exitCode } = await install(dir);
        expect(err).toContain('error: Workspace dependency "my-alias" not found');
        expect(exitCode).toBe(1);
        expect(existsSync(join(dir, "node_modules", "my-alias"))).toBe(false);
      });
    });

    // Two dependents wait for one download, and the tarball names its package only when it arrives.
    test("an alias key with a tarball value installs one package for two dependents", async () => {
      const tarball = `${registry.registryUrl()}no-deps/-/no-deps-1.0.1.tgz`;
      const member = (name: string) => JSON.stringify({ name, dependencies: { "my-alias": "npm:no-deps@^1.0.0" } });
      const dir = await project(
        { workspaces: ["packages/*"], [field]: { "my-alias@npm:no-deps@^1.0.0": tarball } },
        "hoisted",
        { "packages/a/package.json": member("a"), "packages/b/package.json": member("b") },
      );
      await installOk(dir);
      expect(await packageSeenBy(dir, "packages/a", "my-alias")).toBe("no-deps@1.0.1");
      expect(await packageSeenBy(dir, "packages/b", "my-alias")).toBe("no-deps@1.0.1");
      const text = await lock(dir);
      expect(text).toContain(`"my-alias": ["no-deps@${tarball}", {}, "sha512-`);
      expect(text).not.toContain('/my-alias": [');
      await installNoChanges(dir);
      await installNoChanges(dir, "--frozen-lockfile");
    });

    // An alias of a dist-tag goes by the name of its package, so a rule for that package applies to it. That rule
    // takes the catalog entry of the name in its key too.
    test("a catalog: rule for the package of a dist-tag alias takes the catalog entry of that package", async () => {
      const dir = await project({
        workspaces: [],
        catalog: { "my-alias": "npm:no-deps@1.0.0", "no-deps": "1.0.1" },
        dependencies: { "my-alias": "npm:no-deps@latest" },
        [field]: { "no-deps": "catalog:" },
      });
      await installOk(dir);
      expect(await packageSeenBy(dir, ".", "my-alias")).toBe("no-deps@1.0.1");
      await installNoChanges(dir);
      await installNoChanges(dir, "--frozen-lockfile");
    });

    test.each([
      ["another package", "my-alias@npm:a-dep@^1.0.0"],
      ["another package and no version", "my-alias@npm:a-dep"],
      ["a range that does not intersect", "my-alias@npm:no-deps@^2.0.0"],
      ["no alias in the key", "my-alias@^1.0.0"],
      ["no range at all", "my-alias"],
    ])("an alias is left alone by a key with %s", async (_, key) => {
      const dir = await project({
        dependencies: { "my-alias": "npm:no-deps@^1.0.0" },
        [field]: { [key]: "npm:no-deps@1.0.0" },
      });
      await installOk(dir);
      expect(await packageSeenBy(dir, ".", "my-alias")).toBe("no-deps@1.1.0");
    });

    test("an alias key doesn't change a plain dependency with that name", async () => {
      const dir = await project({
        dependencies: { "no-deps": "^1.0.0" },
        [field]: { "no-deps@npm:no-deps@^1.0.0": "1.0.0" },
      });
      await installOk(dir);
      expect(await versionSeenBy(dir, ".", "no-deps")).toBe("1.1.0");
    });
  });

  test("an alias is not a valid range for a parent", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0" },
      overrides: { "one-range-dep@npm:one-range-dep@1": { "no-deps": "1.0.0" } },
    });
    const { err, exitCode } = await install(dir);
    expect(diagnostics(err)).toEqual(['warn: Invalid version range "npm:one-range-dep@1" for "one-range-dep"']);
    expect(exitCode).toBe(0);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
  });
});

describe.concurrent.each(["hoisted", "isolated"] as const)("linker=%s", linker => {
  test("two dependents of one name see different versions", async () => {
    const dir = await project(npmObjectProject, linker);
    await installOk(dir, "--linker", linker);
    await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "2.0.0", "one-range-dep": "1.1.0" });
  });

  test("a rule stays recorded while its parent is removed, and applies again when the parent comes back", async () => {
    const dir = await project(npmObjectProject, linker);
    await installOk(dir, "--linker", linker);
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "nested-overrides",
        dependencies: { "one-range-dep": "1.0.0" },
        overrides: npmObjectProject.overrides,
      }),
    );
    const removed = await installOk(dir, "--linker", linker);
    // The hoisted linker also re-links the remaining no-deps, so it reports the removal on a second line.
    expect(removed.summary).toMatch(/^1 package removed$|\nRemoved: 1$/);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
    const without = await lock(dir);
    expect(without).not.toContain("no-deps@2.0.0");
    expect(overridesSection(without)).toMatchInlineSnapshot(`
      ""overrides": {
        "one-dep": {
          "no-deps": "2.0.0",
        },
      },"
    `);

    await write(join(dir, "package.json"), JSON.stringify({ name: "nested-overrides", ...npmObjectProject }));
    const { err } = await installOk(dir, "--linker", linker);
    expect(err).toContain("Saved lockfile");
    await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "2.0.0", "one-range-dep": "1.1.0" });
    await installNoChanges(dir, "--linker", linker, "--frozen-lockfile");
  });

  test("workspace packages can be parents", async () => {
    const dir = await project(
      {
        workspaces: ["packages/*"],
        overrides: { "app-a": { "no-deps": "1.0.0" }, "app-b": { "no-deps": "2.0.0" } },
      },
      linker,
      {
        "packages/app-a/package.json": JSON.stringify({ name: "app-a", dependencies: { "no-deps": "*" } }),
        "packages/app-b/package.json": JSON.stringify({ name: "app-b", dependencies: { "no-deps": "*" } }),
      },
    );
    await installOk(dir, "--linker", linker);
    await expectVersionsSeenBy(dir, "no-deps", { "packages/app-a": "1.0.0", "packages/app-b": "2.0.0" });
    await installNoChanges(dir, "--linker", linker, "--frozen-lockfile");
  });

  test.each([
    ["another workspace changes", {}],
    ["the root starts to depend on the overridden name", { "no-deps": "2.0.0" }],
  ])("a workspace parent keeps its rule when %s", async (_, rootDependencies) => {
    const root = (dependencies: Record<string, string>) => ({
      workspaces: ["packages/*"],
      overrides: { "app-b": { "no-deps": "1.0.0" } },
      dependencies,
    });
    const appA = (dependencies: Record<string, string>) =>
      JSON.stringify({ name: "app-a", dependencies: { "app-b": "workspace:*", ...dependencies } });
    const dir = await project(root({}), linker, {
      "packages/app-a/package.json": appA({}),
      "packages/app-b/package.json": JSON.stringify({ name: "app-b", dependencies: { "no-deps": "2.0.0" } }),
    });
    await installOk(dir, "--linker", linker);
    expect(await versionSeenBy(dir, "packages/app-b", "no-deps")).toBe("1.0.0");

    await Promise.all([
      write(join(dir, "package.json"), JSON.stringify({ name: "nested-overrides", ...root(rootDependencies) })),
      write(join(dir, "packages", "app-a", "package.json"), appA({ "a-dep": "1.0.1" })),
    ]);
    await installOk(dir, "--linker", linker);
    expect(await versionSeenBy(dir, "packages/app-b", "no-deps")).toBe("1.0.0");
    await installOk(dir, "--linker", linker, "--frozen-lockfile");
  });

  // The new rule makes the install resolve app-b's row again and read app-b's package.json again, which replaces that
  // row: the rule has to find the owner of the new row. With no manifest in the cache the old row is still pending then.
  test.each([
    ["no manifest in the cache", false],
    ["the manifest in the cache", true],
  ])("a rule added for a workspace parent applies to a row that bun.lock binds, %s", async (_, keepCache) => {
    const root = (overrides: Record<string, string>) =>
      JSON.stringify({ name: "nested-overrides", workspaces: ["packages/*"], overrides });
    const dir = await project({ workspaces: ["packages/*"] }, linker, {
      "packages/app-b/package.json": JSON.stringify({ name: "app-b", dependencies: { "no-deps": "^1.0.0" } }),
    });
    await installOk(dir, "--linker", linker);
    expect(await versionSeenBy(dir, "packages/app-b", "no-deps")).toBe("1.1.0");

    await write(join(dir, "package.json"), root({ "app-b>no-deps": "1.0.0" }));
    if (!keepCache) await rm(join(dir, ".bun-cache"), { recursive: true, force: true });
    await installOk(dir, "--linker", linker);
    expect(await versionSeenBy(dir, "packages/app-b", "no-deps")).toBe("1.0.0");
    await installOk(dir, "--linker", linker, "--frozen-lockfile");
  });

  test("a ranged parent rule matches a workspace package by its version", async () => {
    const dir = await project(
      {
        workspaces: ["packages/*"],
        overrides: {
          "app-a@1": { "no-deps": "1.0.0" },
          "app-a@2": { "no-deps": "1.0.1" },
          "app-b@2": { "no-deps": "1.0.1" },
        },
      },
      linker,
      {
        "packages/app-a/package.json": JSON.stringify({
          name: "app-a",
          version: "1.2.3",
          dependencies: { "no-deps": "*" },
        }),
        "packages/app-b/package.json": JSON.stringify({
          name: "app-b",
          version: "1.2.3",
          dependencies: { "no-deps": "1.1.0" },
        }),
      },
    );
    await installOk(dir, "--linker", linker);
    await expectVersionsSeenBy(dir, "no-deps", { "packages/app-a": "1.0.0", "packages/app-b": "1.1.0" });
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "app-a@1": {
          "no-deps": "1.0.0",
        },
        "app-a@2": {
          "no-deps": "1.0.1",
        },
        "app-b@2": {
          "no-deps": "1.0.1",
        },
      },"
    `);
    await installNoChanges(dir, "--linker", linker, "--frozen-lockfile");
  });

  // peer-deps declares no-deps@*, which resolves to 2.0.0 without the rule.
  test("a scoped rule applies to the parent's peer dependency edge", async () => {
    const dir = await project(
      { dependencies: { "peer-deps": "1.0.0" }, overrides: { "peer-deps": { "no-deps": "1.0.0" } } },
      linker,
    );
    await installOk(dir, "--linker", linker);
    expect(await versionSeenBy(dir, "peer-deps", "no-deps")).toBe("1.0.0");
    const first = await lock(dir);
    expect(first).toContain('"no-deps@1.0.0"');
    expect(first).not.toContain('"no-deps@2.0.0"');
    expect(overridesSection(first)).toMatchInlineSnapshot(`
      ""overrides": {
        "peer-deps": {
          "no-deps": "1.0.0",
        },
      },"
    `);
    await installNoChanges(dir, "--linker", linker, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "peer-deps", "no-deps")).toBe("1.0.0");
    await installNoChanges(dir, "--linker", linker);
    expect(await lock(dir)).toBe(first);
  });

  test("an overridden peer edge is still a peer: it takes the tree's copy and warns against the overridden range", async () => {
    const dir = await project(
      {
        dependencies: { "peer-deps": "1.0.0", "no-deps": "1.1.0" },
        overrides: { "peer-deps": { "no-deps": "1.0.0" } },
      },
      linker,
    );
    const { err, exitCode } = await install(dir, "--linker", linker, "--verbose");
    expect(err.split(/\r?\n/).filter(line => line.startsWith("warn: incorrect peer dependency"))).toEqual([
      'warn: incorrect peer dependency "no-deps@1.1.0": "peer-deps@1.0.0" requires "no-deps@1.0.0"',
    ]);
    expect(exitCode).toBe(0);
    expect(await versionSeenBy(dir, "peer-deps", "no-deps")).toBe("1.1.0");
    const first = await lock(dir);
    await installNoChanges(dir, "--linker", linker, "--frozen-lockfile");
    expect(await lock(dir)).toBe(first);
    expect(await versionSeenBy(dir, "peer-deps", "no-deps")).toBe("1.1.0");
  });

  test.each([
    ["a plain rule", { "no-deps": "1.0.0" }],
    ["a rule for the parent", { "peer-deps>no-deps": "1.0.0" }],
  ])("%s added after the install moves a package that only a peer holds", async (_, overrides) => {
    const pkg = { name: "nested-overrides", dependencies: { "peer-deps": "1.0.0" } };
    const dir = await project(pkg, linker);
    await installOk(dir, "--linker", linker);
    expect(await versionSeenBy(dir, "peer-deps", "no-deps")).toBe("2.0.0");

    await write(join(dir, "package.json"), JSON.stringify({ ...pkg, overrides }));
    await installOk(dir, "--linker", linker);
    expect(await versionSeenBy(dir, "peer-deps", "no-deps")).toBe("1.0.0");
    expect(await lock(dir)).not.toContain("no-deps@2.0.0");
    await installNoChanges(dir, "--linker", linker, "--frozen-lockfile");
  });

  // The root's "no-deps" is an alias of a-dep. peer-deps-fixed has the peer no-deps@^1.0.0, which a-dep@1.0.1 fits.
  describe("next to a root alias of the same name", () => {
    const aliased = { "no-deps": "npm:a-dep@1.0.1" };

    test.each([
      ["peer-deps-fixed>no-deps", { "peer-deps-fixed>no-deps": "npm:no-deps@1.0.0" }],
      ["a group", { "peer-deps-fixed": { "no-deps": "1.0.0" } }],
    ])("a rule for a peer is not lost (%s)", async (_, overrides) => {
      const dir = await project({ dependencies: { ...aliased, "peer-deps-fixed": "1.0.0" }, overrides }, linker);
      const check = async () =>
        expect({
          root: await packageSeenBy(dir, undefined, "no-deps"),
          dependent: await packageSeenBy(dir, "peer-deps-fixed", "no-deps"),
        }).toEqual({ root: "a-dep@1.0.1", dependent: "no-deps@1.0.0" });

      await installOk(dir, "--linker", linker);
      await check();
      const first = await lock(dir);
      await installNoChanges(dir, "--linker", linker);
      await rm(join(dir, "node_modules"), { recursive: true, force: true });
      await installOk(dir, "--linker", linker, "--frozen-lockfile");
      await check();
      expect(await lock(dir)).toBe(first);
    });

    test("a peer without a rule shares the alias", async () => {
      const dir = await project({ dependencies: { ...aliased, "peer-deps-fixed": "1.0.0" } }, linker);
      await installOk(dir, "--linker", linker);
      expect(await packageSeenBy(dir, "peer-deps-fixed", "no-deps")).toBe("a-dep@1.0.1");
      expect(await lock(dir)).not.toContain('"no-deps@');
    });

    test("a flat rule applies to a dependency's range", async () => {
      const dir = await project(
        { dependencies: { ...aliased, "one-range-dep": "1.0.0" }, overrides: { "no-deps": "1.0.0" } },
        linker,
      );
      await installOk(dir, "--linker", linker);
      expect({
        root: await packageSeenBy(dir, undefined, "no-deps"),
        dependent: await packageSeenBy(dir, "one-range-dep", "no-deps"),
      }).toEqual({ root: "a-dep@1.0.1", dependent: "no-deps@1.0.0" });
      await installNoChanges(dir, "--linker", linker, "--frozen-lockfile");
    });
  });

  test("a nested rule with an npm: alias value", async () => {
    const dir = await project(
      {
        dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0" },
        overrides: { "one-dep": { "no-deps": "npm:a-dep@1.0.1" } },
      },
      linker,
    );
    await installOk(dir, "--linker", linker);
    expect(await packageSeenBy(dir, "one-dep", "no-deps")).toBe("a-dep@1.0.1");
    expect(await packageSeenBy(dir, "one-range-dep", "no-deps")).toBe("no-deps@1.1.0");
    const first = await lock(dir);
    expect(overridesSection(first)).toMatchInlineSnapshot(`
      ""overrides": {
        "one-dep": {
          "no-deps": "npm:a-dep@1.0.1",
        },
      },"
    `);
    await installNoChanges(dir, "--linker", linker, "--frozen-lockfile");
    await installNoChanges(dir, "--linker", linker);
    expect(await lock(dir)).toBe(first);
  });

  test("a nested rule with a workspace:* value", async () => {
    const dir = await project(
      {
        workspaces: ["packages/*"],
        dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0" },
        overrides: { "one-dep": { "no-deps": "workspace:*" } },
      },
      linker,
      { "packages/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "9.0.0" }) },
    );
    await installOk(dir, "--linker", linker);
    await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "9.0.0", "one-range-dep": "1.1.0" });
    const first = await lock(dir);
    expect(overridesSection(first)).toMatchInlineSnapshot(`
      ""overrides": {
        "one-dep": {
          "no-deps": "workspace:*",
        },
      },"
    `);
    await installNoChanges(dir, "--linker", linker, "--frozen-lockfile");
    await installNoChanges(dir, "--linker", linker);
    expect(await lock(dir)).toBe(first);
  });

  test("ranged flat and nested targets", async () => {
    const dir = await project(rangedProject, linker);
    await installOk(dir, "--linker", linker);
    await expectVersionsSeenBy(dir, "no-deps", { "one-range-dep": "1.0.0", "one-dep": "2.0.0" });
    await installNoChanges(dir, "--linker", linker, "--frozen-lockfile");
  });

  test("ranged parent precedence", async () => {
    const dir = await project(precedenceProject, linker);
    await installOk(dir, "--linker", linker);
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.0.1", ofd2: "1.1.0", "one-range-dep": "1.0.0" });
    await installNoChanges(dir, "--linker", linker, "--frozen-lockfile");
  });

  test("bun.lockb round-trips nested rules", async () => {
    const { packageDir: dir } = await registry.createTestDir({
      bunfigOpts: { linker, saveTextLockfile: false },
      files: { "package.json": JSON.stringify({ name: "nested-overrides", ...precedenceProject }) },
    });
    await installOk(dir, "--linker", linker);
    expect(existsSync(join(dir, "bun.lockb"))).toBe(true);
    expect(existsSync(join(dir, "bun.lock"))).toBe(false);
    await rm(join(dir, "node_modules"), { recursive: true, force: true });
    const { summary } = await installOk(dir, "--linker", linker, "--frozen-lockfile");
    expect(summary).toBe("6 packages installed");
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.0.1", ofd2: "1.1.0", "one-range-dep": "1.0.0" });
  });

  test("bun.lockb round-trips ranged rules", async () => {
    const { packageDir: dir } = await registry.createTestDir({
      bunfigOpts: { linker, saveTextLockfile: false },
      files: { "package.json": JSON.stringify({ name: "nested-overrides", ...rangedProject }) },
    });
    await installOk(dir, "--linker", linker);
    expect(existsSync(join(dir, "bun.lockb"))).toBe(true);
    expect(existsSync(join(dir, "bun.lock"))).toBe(false);
    await rm(join(dir, "node_modules"), { recursive: true, force: true });
    const { summary } = await installOk(dir, "--linker", linker, "--frozen-lockfile");
    expect(summary).toBe("4 packages installed");
    await expectVersionsSeenBy(dir, "no-deps", { "one-range-dep": "1.0.0", "one-dep": "2.0.0" });
  });
});

describe.concurrent("lockfile", () => {
  test("round trip: stable across installs, value changes are frozen-lockfile changes", async () => {
    const dir = await project(precedenceProject);
    await installOk(dir);
    const first = await lock(dir);
    await installNoChanges(dir, "--frozen-lockfile");
    await installNoChanges(dir);
    expect(await lock(dir)).toBe(first);

    // 2.0.0 keeps ofd2's edge nested; the hoisted installer leaves a nested folder behind when an edge moves up to the root's copy.
    const pkg = structuredClone(precedenceProject);
    pkg.overrides["one-fixed-dep@2"]["no-deps"] = "2.0.0";
    await write(join(dir, "package.json"), JSON.stringify({ name: "nested-overrides", ...pkg }));
    await expectFrozenOverridesFailure(dir);
    await installOk(dir);
    const second = await lock(dir);
    expect(overridesSection(second)).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps": "1.0.0",
        "one-fixed-dep": {
          "no-deps": "1.0.1",
        },
        "one-fixed-dep@2": {
          "no-deps": "2.0.0",
        },
      },"
    `);
    expect(second).not.toContain("no-deps@1.1.0");
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.0.1", ofd2: "2.0.0", "one-range-dep": "1.0.0" });
  });

  test("adding a nested rule while the flat rules stay the same is a change", async () => {
    const dir = await project({ dependencies: { "one-dep": "1.0.0" }, overrides: { "no-deps": "1.0.0" } });
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.0");
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "nested-overrides",
        dependencies: { "one-dep": "1.0.0" },
        overrides: { "no-deps": "1.0.0", "one-dep": { "no-deps": "1.1.0" } },
      }),
    );
    await expectFrozenOverridesFailure(dir);
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.1.0");
  });

  // An older Bun reading a v3 file takes bun-lock.test.ts's `lockfile version newer than this build supports` path.
  test("lockfileVersion 3 is stamped only while a scoped rule exists", async () => {
    const flatOnly = { dependencies: { "one-dep": "1.0.0" }, overrides: { "no-deps": "1.0.0" } };
    const [x, y, z] = await Promise.all([
      project(flatOnly),
      project({
        dependencies: flatOnly.dependencies,
        overrides: { ...flatOnly.overrides, "one-dep": { "no-deps": "1.0.0" } },
      }),
      project({ dependencies: flatOnly.dependencies, overrides: { "no-deps@1": "1.0.0" } }),
    ]);
    await Promise.all([installOk(x), installOk(y), installOk(z)]);
    const xLock = await lock(x);
    expect(xLock).toContain('"lockfileVersion": 2');
    expect(xLock).toContain('\n    "no-deps": "1.0.0",\n');
    expect(await lock(y)).toContain('"lockfileVersion": 3');
    expect(await lock(z)).toContain('"lockfileVersion": 3');

    const flatOnlyJson = JSON.stringify({ name: "nested-overrides", ...flatOnly });
    await Promise.all([write(join(y, "package.json"), flatOnlyJson), write(join(z, "package.json"), flatOnlyJson)]);
    await Promise.all([installOk(y), installOk(z)]);
    expect(await lock(y)).toBe(xLock);
    expect(await lock(z)).toBe(xLock);
  });

  // The registry's tarball URLs are not under the default registry, so a row with an empty integrity walks the writer down to v1.
  const walkFallbackDeps = { "one-dep": "1.0.0" };
  async function projectWithWalkFallbackLock(stampVersion: 1 | 2 | 3) {
    const dir = await project({ dependencies: walkFallbackDeps });
    await installOk(dir);
    const text = await lock(dir);
    expect(text).toContain('"lockfileVersion": 2');
    expect(text).toContain('one-dep-1.0.0.tgz", ');
    const stripped = text
      .replace('"lockfileVersion": 2', `"lockfileVersion": ${stampVersion}`)
      .replace(/, "sha512-[^"]*"\]/g, ', ""]');
    expect(stripped).not.toContain("sha512-");
    await write(join(dir, "bun.lock"), stripped);
    return dir;
  }

  test("a walk-fallback row without scoped rules is re-saved as v1", async () => {
    const dir = await projectWithWalkFallbackLock(3);
    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "nested-overrides", dependencies: walkFallbackDeps, overrides: { "no-deps": "1.0.1" } }),
    );
    const { err } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    const after = await lock(dir);
    expect(after).toContain('"lockfileVersion": 1');
    expect(after).toContain('one-dep-1.0.0.tgz", {');
    expect(after).toContain(', ""]');
  });

  describe.concurrent.each([1, 2, 3] as const)("an existing v%i lockfile with a walk-fallback row", loaded => {
    test("gains a nested rule: re-saved lockfile stays at 1 because the walk-fallback row outranks the v3 stamp", async () => {
      const dir = await projectWithWalkFallbackLock(loaded);
      await write(
        join(dir, "package.json"),
        JSON.stringify({
          name: "nested-overrides",
          dependencies: walkFallbackDeps,
          overrides: { "one-dep": { "no-deps": "2.0.0" } },
        }),
      );
      const { err } = await installOk(dir);
      expect(err).toContain("Saved lockfile");
      const after = await lock(dir);
      expect(after).toContain(', ""]');
      expect(overridesSection(after)).toMatchInlineSnapshot(`
        ""overrides": {
          "one-dep": {
            "no-deps": "2.0.0",
          },
        },"
      `);
      expect(after).toContain('"lockfileVersion": 1');
      expect(after).not.toContain('"lockfileVersion": 3');
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
      await installNoChanges(dir, "--frozen-lockfile");
    });
  });

  // A v3 stamp makes readers demand integrity for tarball URLs outside their registries, which this row can never satisfy.
  test("a walk-fallback row under no configured registry plus a nested rule re-reads frozen-clean", async () => {
    const dir = await projectWithWalkFallbackLock(1);
    const foreignUrl = "http://127.0.0.1:1/one-dep/-/one-dep-1.0.0.tgz";
    const before = await lock(dir);
    const rewritten = before.replace(/"[^"]*\/one-dep-1\.0\.0\.tgz"/, JSON.stringify(foreignUrl));
    expect(rewritten).not.toBe(before);
    await write(join(dir, "bun.lock"), rewritten);
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "nested-overrides",
        dependencies: walkFallbackDeps,
        overrides: { "one-dep": { "no-deps": "2.0.0" } },
      }),
    );
    const { err } = await installOk(dir, "--lockfile-only");
    expect(err).toContain("Saved lockfile");
    const after = await lock(dir);
    expect(after).toContain(`${JSON.stringify(foreignUrl)}, {`);
    expect(after).toContain(', ""]');
    expect(after).toContain('"lockfileVersion": 1');
    const frozen = await install(dir, "--frozen-lockfile", "--lockfile-only");
    expect(diagnostics(frozen.err)).toEqual([]);
    expect(frozen.out).toBe(`bun install ${Bun.version_with_sha}\n`);
    expect(frozen.exitCode).toBe(0);
    expect(await lock(dir)).toBe(after);
  });

  test("ranged rules round-trip: stable, frozen-clean", async () => {
    const dir = await project(rangedProject);
    await installOk(dir);
    const first = await lock(dir);
    expect(overridesSection(first)).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps@1": {
          ".": "1.0.0",
        },
        "one-dep": {
          "no-deps@1": "2.0.0",
        },
      },"
    `);
    await installNoChanges(dir, "--frozen-lockfile");
    await installNoChanges(dir);
    expect(await lock(dir)).toBe(first);
    await expectVersionsSeenBy(dir, "no-deps", { "one-range-dep": "1.0.0", "one-dep": "2.0.0" });
  });

  async function expectFrozenOverridesFailure(dir: string, field: "overrides" | "resolutions" = "overrides") {
    const frozen = await install(dir, "--frozen-lockfile");
    expect(diagnostics(frozen.err)).toEqual([
      "error: lockfile had changes, but lockfile is frozen",
      `note: ${field} in package.json changed since bun.lock was saved`,
      "note: try re-running without --frozen-lockfile and commit the updated lockfile",
    ]);
    expect(frozen.exitCode).toBe(1);
  }

  test("a changed resolutions field is reported as resolutions", async () => {
    const deps = { "one-range-dep": "1.0.0" };
    const dir = await project({ dependencies: deps, resolutions: { "no-deps": "1.0.0" } });
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "nested-overrides", dependencies: deps, resolutions: { "no-deps": "1.0.1" } }),
    );
    await expectFrozenOverridesFailure(dir, "resolutions");
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.1");
  });

  test("removing a scoped rule re-resolves the edge it pinned", async () => {
    const dir = await project(npmObjectProject);
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "2.0.0", "one-range-dep": "1.1.0" });
    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "nested-overrides", dependencies: npmObjectProject.dependencies }),
    );
    await expectFrozenOverridesFailure(dir);
    const { err } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "1.0.1", "one-range-dep": "1.1.0" });
    const after = await lock(dir);
    expect(after).not.toContain('"overrides"');
    expect(after).not.toContain("no-deps@2.0.0");
    expect(after).toContain('"lockfileVersion": 2');
    await installNoChanges(dir, "--frozen-lockfile");
  });

  // An overrides change re-resolves every row naming a previously or newly overridden package. By then the root's
  // rows from bun.lock have been replaced by freshly parsed ones and belong to no package; they must not be
  // re-resolved as well: a range that is no longer in package.json would add a package the current row then dedupes
  // onto, and a file: path outside the project is only accepted on a row the root (or a workspace) owns. The
  // root's current rows also have to be resolved before everybody else's, as on a fresh install, since a row
  // resolved later dedupes onto a same-major package an earlier one added.
  describe.concurrent("removing a flat rule re-resolves only the root's current rows", () => {
    test("the root's row resolves before a dependency's row of the same name", async () => {
      const deps = { "no-deps": "^1.0.0", "one-dep": "1.0.0" }; // one-dep@1.0.0 depends on no-deps@1.0.1
      const [dir, fresh] = await Promise.all([
        project({ dependencies: deps, overrides: { "no-deps": "2.0.0" } }),
        project({ dependencies: deps }),
      ]);
      await Promise.all([installOk(dir), installOk(fresh)]);
      expect(await lock(dir)).toContain("no-deps@2.0.0");

      await write(join(dir, "package.json"), JSON.stringify({ name: "nested-overrides", dependencies: deps }));
      const { err } = await installOk(dir);
      expect(err).toContain("Saved lockfile");
      await expectVersionsSeenBy(dir, "no-deps", { ".": "1.1.0", "one-dep": "1.0.1" });
      // Same packages as installing this package.json from scratch.
      expect(await lock(dir)).toBe(await lock(fresh));
    });

    test("a range changed in the same edit resolves on its own", async () => {
      const dir = await project({ dependencies: { "no-deps": "~1.0.0" }, overrides: { "no-deps": "2.0.0" } });
      await installOk(dir);
      expect(await versionSeenBy(dir, undefined, "no-deps")).toBe("2.0.0");

      await write(
        join(dir, "package.json"),
        JSON.stringify({ name: "nested-overrides", dependencies: { "no-deps": "^1.0.0" } }),
      );
      const { err } = await installOk(dir);
      expect(err).toContain("Saved lockfile");
      // 1.0.1 is what the dropped ~1.0.0 range would pick.
      expect(await versionSeenBy(dir, undefined, "no-deps")).toBe("1.1.0");
      const after = await lock(dir);
      expect(after).not.toContain('"overrides"');
      expect(after).not.toContain("no-deps@1.0.1");
      expect(after).not.toContain("no-deps@2.0.0");
      await installNoChanges(dir, "--frozen-lockfile");
    });

    const outside = {
      "x/package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
      "x2/package.json": JSON.stringify({ name: "x", version: "2.0.0" }),
      "project/y/package.json": JSON.stringify({ name: "y", version: "1.0.0" }),
    };
    const rootPackageJson = (pkg: Record<string, unknown>) => JSON.stringify({ name: "nested-overrides", ...pkg });
    const before = rootPackageJson({
      dependencies: { x: "file:../x", y: "file:./y" },
      overrides: { x: "file:../x2" },
    });

    test("a file: dependency outside the project re-resolves to its own path", async () => {
      using root = tempDir("override-removed-file-dep", { ...outside, "project/package.json": before });
      const dir = join(String(root), "project");
      await installOk(dir);
      expect(await versionSeenBy(dir, undefined, "x")).toBe("2.0.0");

      await write(join(dir, "package.json"), rootPackageJson({ dependencies: { x: "file:../x", y: "file:./y" } }));
      const { err } = await installOk(dir);
      expect(err).toContain("Saved lockfile");
      expect(await versionSeenBy(dir, undefined, "x")).toBe("1.0.0");
      expect(normalizeBunSnapshot(await lock(dir), dir)).toMatchInlineSnapshot(`
        "{
          "lockfileVersion": 2,
          "configVersion": 1,
          "workspaces": {
            "": {
              "name": "nested-overrides",
              "dependencies": {
                "x": "file:../x",
                "y": "file:./y",
              },
            },
          },
          "packages": {
            "x": ["x@file:../x", {}],

            "y": ["y@file:y", {}],
          }
        }"
      `);
      await installOk(dir, "--frozen-lockfile");
    });

    test("a file: dependency outside the project removed together with its rule", async () => {
      using root = tempDir("override-and-file-dep-removed", { ...outside, "project/package.json": before });
      const dir = join(String(root), "project");
      await installOk(dir);
      expect(await versionSeenBy(dir, undefined, "x")).toBe("2.0.0");

      await write(join(dir, "package.json"), rootPackageJson({ dependencies: { y: "file:./y" } }));
      const { err } = await installOk(dir);
      expect(err).toContain("Saved lockfile");
      expect(normalizeBunSnapshot(await lock(dir), dir)).toMatchInlineSnapshot(`
        "{
          "lockfileVersion": 2,
          "configVersion": 1,
          "workspaces": {
            "": {
              "name": "nested-overrides",
              "dependencies": {
                "y": "file:./y",
              },
            },
          },
          "packages": {
            "y": ["y@file:y", {}],
          }
        }"
      `);
      await installOk(dir, "--frozen-lockfile");
    });
  });

  test("changing only the parent's range text is a frozen-lockfile change", async () => {
    const dir = await project({ dependencies: twoParents, overrides: { "one-fixed-dep@1": { "no-deps": "1.1.0" } } });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.1.0", ofd2: "2.0.0" });
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "nested-overrides",
        dependencies: twoParents,
        overrides: { "one-fixed-dep@2": { "no-deps": "1.1.0" } },
      }),
    );
    await expectFrozenOverridesFailure(dir);
    const { err } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.0.0", ofd2: "1.1.0" });
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "one-fixed-dep@2": {
          "no-deps": "1.1.0",
        },
      },"
    `);
    await installNoChanges(dir, "--frozen-lockfile");
  });

  describe.concurrent.each([
    { label: "flat", rule: (value: string) => ({ "no-deps": value }), from: "one-range-dep" },
    { label: "nested", rule: (value: string) => ({ "one-range-dep": { "no-deps": value } }), from: "one-range-dep" },
  ])("switching a $label rule from catalog:a to catalog:b", ({ rule, from }) => {
    const pkg = (value: string) =>
      JSON.stringify({
        name: "nested-overrides",
        workspaces: { packages: [], catalogs: { a: { "no-deps": "1.0.0" }, b: { "no-deps": "1.0.1" } } },
        dependencies: { "one-range-dep": "1.0.0" },
        overrides: rule(value),
      });

    test("is a frozen-lockfile change and re-resolves", async () => {
      const { packageDir: dir } = await registry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: { "package.json": pkg("catalog:a") },
      });
      await installOk(dir);
      expect(await versionSeenBy(dir, from, "no-deps")).toBe("1.0.0");
      await write(join(dir, "package.json"), pkg("catalog:b"));
      await expectFrozenOverridesFailure(dir);
      const { err } = await installOk(dir);
      expect(err).toContain("Saved lockfile");
      expect(await versionSeenBy(dir, from, "no-deps")).toBe("1.0.1");
      const after = await lock(dir);
      expect(overridesSection(after)).toContain('"no-deps": "catalog:b"');
      expect(after).not.toContain("no-deps@1.0.0");
      await installNoChanges(dir, "--frozen-lockfile");
    });
  });

  test("--lockfile-only writes the scoped rules and a following --frozen-lockfile install uses them", async () => {
    const dir = await project(precedenceProject);
    const { err, summary } = await installOk(dir, "--lockfile-only");
    expect(err).toContain("Saved lockfile");
    expect(summary).toBe("Saved bun.lock (7 packages)");
    expect(existsSync(join(dir, "node_modules"))).toBe(false);
    const text = await lock(dir);
    expect(text).toContain('"lockfileVersion": 3');
    expect(overridesSection(text)).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps": "1.0.0",
        "one-fixed-dep": {
          "no-deps": "1.0.1",
        },
        "one-fixed-dep@2": {
          "no-deps": "1.1.0",
        },
      },"
    `);
    const frozen = await installOk(dir, "--frozen-lockfile");
    expect(frozen.summary).toBe("6 packages installed");
    expect(await lock(dir)).toBe(text);
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.0.1", ofd2: "1.1.0", "one-range-dep": "1.0.0" });
  });

  // Every rewrite below resolves to the same packages as before, so only the overrides section of bun.lock differs.
  test("changing a flat rule's range text is a frozen-lockfile change", async () => {
    const deps = { "one-range-dep": "1.0.0" };
    const dir = await project({ dependencies: deps, overrides: { "no-deps": "1.1.0" } });
    await installOk(dir);
    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "nested-overrides", dependencies: deps, overrides: { "no-deps": "^1.1.0" } }),
    );
    await expectFrozenOverridesFailure(dir);
    const { err, summary } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    expect(summary).toEndWith("(no changes)");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps": "^1.1.0",
      },"
    `);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
    await installNoChanges(dir, "--frozen-lockfile");
  });

  test("changing a flat target range is a frozen-lockfile change", async () => {
    const dir = await project(rangedProject);
    await installOk(dir);
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "nested-overrides",
        dependencies: rangedProject.dependencies,
        overrides: { "no-deps@^1.0.1": "1.0.0", "one-dep": rangedProject.overrides["one-dep"] },
      }),
    );
    await expectFrozenOverridesFailure(dir);
    const { err, summary } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    expect(summary).toEndWith("(no changes)");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps@^1.0.1": {
          ".": "1.0.0",
        },
        "one-dep": {
          "no-deps@1": "2.0.0",
        },
      },"
    `);
    await expectVersionsSeenBy(dir, "no-deps", { "one-range-dep": "1.0.0", "one-dep": "2.0.0" });
    await installNoChanges(dir, "--frozen-lockfile");
  });

  test("changing a nested target range is a frozen-lockfile change", async () => {
    const dir = await project(rangedProject);
    await installOk(dir);
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "nested-overrides",
        dependencies: rangedProject.dependencies,
        overrides: { "no-deps@1": "1.0.0", "one-dep": { "no-deps@^1.0.1": "2.0.0" } },
      }),
    );
    await expectFrozenOverridesFailure(dir);
    const { err, summary } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    expect(summary).toEndWith("(no changes)");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps@1": {
          ".": "1.0.0",
        },
        "one-dep": {
          "no-deps@^1.0.1": "2.0.0",
        },
      },"
    `);
    await expectVersionsSeenBy(dir, "no-deps", { "one-range-dep": "1.0.0", "one-dep": "2.0.0" });
    await installNoChanges(dir, "--frozen-lockfile");
  });

  // Released Bun wrote a `name@range` key as a top-level string row that never applied; that row is not a ranged rule.
  test("a v2 lockfile carrying a legacy dead name@range string row is re-resolved", async () => {
    const dir = await project({ dependencies: { "one-range-dep": "1.0.0" } });
    await installOk(dir);
    const text = await lock(dir);
    expect(text).toContain('\n  "packages": {');
    await write(
      join(dir, "bun.lock"),
      text.replace('\n  "packages": {', '\n  "overrides": {\n    "no-deps@1": "1.0.0",\n  },\n  "packages": {'),
    );
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "nested-overrides",
        dependencies: { "one-range-dep": "1.0.0" },
        overrides: { "no-deps@1": "1.0.0" },
      }),
    );
    await expectFrozenOverridesFailure(dir);
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    const after = await lock(dir);
    expect(after).toContain('"lockfileVersion": 3');
    expect(overridesSection(after)).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps@1": {
          ".": "1.0.0",
        },
      },"
    `);
    await installNoChanges(dir, "--frozen-lockfile");
  });

  test("objects in the overrides section are read at any lockfileVersion", async () => {
    const dir = await project(npmObjectProject);
    await installOk(dir);
    const text = await lock(dir);
    expect(text).toContain('"lockfileVersion": 3');
    await write(join(dir, "bun.lock"), text.replace('"lockfileVersion": 3', '"lockfileVersion": 2'));
    await installNoChanges(dir, "--frozen-lockfile");
  });
});

describe.concurrent("migration", () => {
  test("yarn.lock resolutions paths become nested rules", async () => {
    const url = registry.registryUrl();
    const [oneDep, noDeps] = await Promise.all([integrityOf("one-dep", "1.0.0"), integrityOf("no-deps", "2.0.0")]);
    const dir = await project(
      { dependencies: { "one-dep": "1.0.0" }, resolutions: { "one-dep/no-deps": "2.0.0" } },
      "hoisted",
      {
        "yarn.lock": `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1


no-deps@1.0.1:
  version "2.0.0"
  resolved "${url}no-deps/-/no-deps-2.0.0.tgz"
  integrity ${noDeps}

one-dep@1.0.0:
  version "1.0.0"
  resolved "${url}one-dep/-/one-dep-1.0.0.tgz"
  integrity ${oneDep}
  dependencies:
    no-deps "1.0.1"
`,
      },
    );
    const migrated = await migrate(dir);
    expect(diagnostics(migrated.err)).toEqual(["migrated lockfile from yarn.lock"]);
    expect(migrated.exitCode).toBe(0);
    const text = await lock(dir);
    expect(text).toContain('"lockfileVersion": 3');
    expect(overridesSection(text)).toMatchInlineSnapshot(`
      ""overrides": {
        "one-dep": {
          "no-deps": "2.0.0",
        },
      },"
    `);
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });

  test("yarn.lock migration carries overrides, and keeps the pin of a name that only resolutions has", async () => {
    const url = registry.registryUrl();
    const [aDep, noDeps] = await Promise.all([integrityOf("a-dep", "1.0.2"), integrityOf("no-deps", "1.0.0")]);
    const dir = await project(
      {
        dependencies: { "a-dep": "^1.0.1", "no-deps": "^1.0.0" },
        overrides: { "no-deps": "1.0.0" },
        resolutions: { "a-dep": "1.0.2" },
      },
      "hoisted",
      {
        "yarn.lock": `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1


a-dep@^1.0.1:
  version "1.0.2"
  resolved "${url}a-dep/-/a-dep-1.0.2.tgz"
  integrity ${aDep}

no-deps@^1.0.0:
  version "1.0.0"
  resolved "${url}no-deps/-/no-deps-1.0.0.tgz"
  integrity ${noDeps}
`,
      },
    );
    const migrated = await migrate(dir);
    expect(diagnostics(migrated.err)).toEqual(["migrated lockfile from yarn.lock"]);
    expect(migrated.exitCode).toBe(0);
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps": "1.0.0",
      },"
    `);
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, undefined, "a-dep")).toBe("1.0.2");
    expect(await versionSeenBy(dir, undefined, "no-deps")).toBe("1.0.0");
  });

  // Neither file records the rules, so a rule that was added since is only visible in what the file pins.
  test.each(["yarn.lock", "package-lock.json"] as const)(
    "a rule that %s does not reflect yet is applied",
    async name => {
      const url = registry.registryUrl();
      const [dependent, noDeps] = await Promise.all([
        integrityOf("one-range-dep", "1.0.0"),
        integrityOf("no-deps", "1.1.0"),
      ]);
      const dependencies = { "one-range-dep": "1.0.0" };
      const locks = {
        "yarn.lock": `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1


no-deps@^1.0.0:
  version "1.1.0"
  resolved "${url}no-deps/-/no-deps-1.1.0.tgz"
  integrity ${noDeps}

one-range-dep@1.0.0:
  version "1.0.0"
  resolved "${url}one-range-dep/-/one-range-dep-1.0.0.tgz"
  integrity ${dependent}
  dependencies:
    no-deps "^1.0.0"
`,
        "package-lock.json": JSON.stringify({
          name: "nested-overrides",
          lockfileVersion: 3,
          requires: true,
          packages: {
            "": { name: "nested-overrides", dependencies },
            "node_modules/no-deps": {
              version: "1.1.0",
              resolved: `${url}no-deps/-/no-deps-1.1.0.tgz`,
              integrity: noDeps,
            },
            "node_modules/one-range-dep": {
              version: "1.0.0",
              resolved: `${url}one-range-dep/-/one-range-dep-1.0.0.tgz`,
              integrity: dependent,
              dependencies: { "no-deps": "^1.0.0" },
            },
          },
        }),
      };
      const dir = await project({ dependencies, overrides: { "no-deps": "1.0.0" } }, "hoisted", {
        [name]: locks[name],
      });

      const frozen = await install(dir, "--frozen-lockfile");
      expect(frozen.err).not.toContain("error:");
      expect(frozen.exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");

      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual([`migrated lockfile from ${name}`]);
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
      expect(await lock(dir)).not.toContain("no-deps@1.1.0");
      await installNoChanges(dir, "--frozen-lockfile");
    },
  );

  // one-dep@1.0.0 declares no-deps@1.0.1; a lockfile snapshot on 2.0.0 is only consistent with an override.
  async function pnpmLock({ overrides, noDepsVersion = "2.0.0" }: { overrides?: string[]; noDepsVersion?: string }) {
    const [oneDep, noDeps] = await Promise.all([
      integrityOf("one-dep", "1.0.0"),
      integrityOf("no-deps", noDepsVersion),
    ]);
    const overridesBlock = overrides ? `overrides:\n${overrides.map(line => `  ${line}\n`).join("")}\n` : "";
    return `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

${overridesBlock}importers:

  .:
    dependencies:
      one-dep:
        specifier: 1.0.0
        version: 1.0.0

packages:

  no-deps@${noDepsVersion}:
    resolution: {integrity: ${noDeps}}

  one-dep@1.0.0:
    resolution: {integrity: ${oneDep}}

snapshots:

  no-deps@${noDepsVersion}: {}

  one-dep@1.0.0:
    dependencies:
      no-deps: ${noDepsVersion}
`;
  }

  const migratedLine = /\[[\d.]+m?s\] migrated lockfile from pnpm-lock\.yaml\n/;
  const copiedOverridesLine = "copied pnpm.overrides to overrides in package.json";

  test("pnpm-lock.yaml parent>child overrides become nested rules that package.json agrees with", async () => {
    const dir = await project(
      { dependencies: { "one-dep": "1.0.0" }, pnpm: { overrides: { "one-dep>no-deps": "2.0.0" } } },
      "hoisted",
      { "pnpm-lock.yaml": await pnpmLock({ overrides: ["one-dep>no-deps: 2.0.0"] }) },
    );
    const migrated = await migrate(dir);
    expect(migrated.err).not.toContain("warn:");
    expect(migrated.err).not.toContain("error:");
    expect(migrated.err).toMatch(migratedLine);
    expect(occurrences(migrated.err, copiedOverridesLine)).toBe(1);
    expect(migrated.exitCode).toBe(0);
    const text = await lock(dir);
    expect(text).toContain('"one-dep": {');
    expect(text).toContain('"no-deps": "2.0.0"');
    const packageJson = await packageJsonText(dir);
    expect(packageJson).toContain('\n  "overrides": {\n    "one-dep>no-deps": "2.0.0"');
    expect(JSON.parse(packageJson)).toStrictEqual({
      name: "nested-overrides",
      dependencies: { "one-dep": "1.0.0" },
      pnpm: { overrides: { "one-dep>no-deps": "2.0.0" } },
      overrides: { "one-dep>no-deps": "2.0.0" },
    });
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });

  test("pnpm-lock.yaml parent>child@range override becomes a ranged nested rule", async () => {
    const pnpmOverrides = { "one-dep>no-deps@1": "2.0.0" };
    const dir = await project({ dependencies: { "one-dep": "1.0.0" }, pnpm: { overrides: pnpmOverrides } }, "hoisted", {
      "pnpm-lock.yaml": await pnpmLock({ overrides: ["one-dep>no-deps@1: 2.0.0"] }),
    });
    const migrated = await migrate(dir);
    expect(migrated.err).not.toContain("warn:");
    expect(migrated.err).not.toContain("error:");
    expect(occurrences(migrated.err, copiedOverridesLine)).toBe(1);
    expect(migrated.exitCode).toBe(0);
    const text = await lock(dir);
    expect(text).toContain('"one-dep": {');
    expect(text).toContain('"no-deps@1": "2.0.0"');
    expect((await file(join(dir, "package.json")).json()).overrides).toStrictEqual(pnpmOverrides);
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });

  test("pnpm-lock.yaml name@range override becomes a ranged flat rule", async () => {
    const pnpmOverrides = { "no-deps@1": "2.0.0" };
    const dir = await project({ dependencies: { "one-dep": "1.0.0" }, pnpm: { overrides: pnpmOverrides } }, "hoisted", {
      "pnpm-lock.yaml": await pnpmLock({ overrides: ["no-deps@1: 2.0.0"] }),
    });
    const migrated = await migrate(dir);
    expect(migrated.err).not.toContain("warn:");
    expect(migrated.err).not.toContain("error:");
    expect(occurrences(migrated.err, copiedOverridesLine)).toBe(1);
    expect(migrated.exitCode).toBe(0);
    const text = await lock(dir);
    expect(text).toContain('"lockfileVersion": 3');
    expect(text).toContain('"no-deps@1": {');
    expect(text).toContain('".": "2.0.0"');
    expect((await file(join(dir, "package.json")).json()).overrides).toStrictEqual(pnpmOverrides);
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });

  // pnpm expands a `catalog:` override to the catalog entry of the name in its key, and locks that version.
  test.each([
    ["only the alias has a catalog entry", { "my-alias": "npm:no-deps@1.0.0" }],
    ["the alias target has a catalog entry too", { "my-alias": "npm:no-deps@1.0.0", "no-deps": "1.0.1" }],
  ])(
    "pnpm-lock.yaml with a catalog: override for an npm: alias keeps the version pnpm locked: %s",
    async (_, catalog) => {
      const entries = Object.entries(catalog).map(([name, range]) => `  ${name}: ${range}\n`);
      const dir = await project({ dependencies: { "my-alias": "npm:no-deps@^1.0.0" } }, "hoisted", {
        "pnpm-workspace.yaml": `catalog:\n${entries.join("")}overrides:\n  "my-alias@npm:no-deps@^1.0.0": "catalog:"\n`,
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

overrides:
  my-alias@npm:no-deps@^1.0.0: npm:no-deps@1.0.0

importers:

  .:
    dependencies:
      my-alias:
        specifier: npm:no-deps@1.0.0
        version: no-deps@1.0.0

packages:

  no-deps@1.0.0:
    resolution: {integrity: ${await integrityOf("no-deps", "1.0.0")}}

snapshots:

  no-deps@1.0.0: {}
`,
      });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual([
        "migrated lockfile from pnpm-lock.yaml",
        "copied pnpm-workspace.yaml to workspaces, copied pnpm-workspace.yaml overrides to overrides in package.json",
      ]);
      expect(exitCode).toBe(0);
      expect(await packageSeenBy(dir, ".", "my-alias")).toBe("no-deps@1.0.0");
      expect(await file(join(dir, "package.json")).json()).toStrictEqual({
        name: "nested-overrides",
        dependencies: { "my-alias": "npm:no-deps@^1.0.0" },
        workspaces: { catalog },
        overrides: { "my-alias@npm:no-deps@^1.0.0": "catalog:" },
      });
      await installNoChanges(dir, "--frozen-lockfile");
    },
  );

  test("pnpm.overrides merged into an existing overrides object keeps the file's indentation", async () => {
    const dir = await registry
      .createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: {
          "package.json": JSON.stringify(
            {
              name: "nested-overrides",
              dependencies: { "one-dep": "1.0.0" },
              overrides: { "a-dep": "1.0.1" },
              pnpm: { overrides: { "one-dep>no-deps": "2.0.0" } },
            },
            null,
            4,
          ),
          "pnpm-lock.yaml": await pnpmLock({ overrides: ["one-dep>no-deps: 2.0.0"] }),
        },
      })
      .then(({ packageDir }) => packageDir);
    const migrated = await migrate(dir);
    expect(occurrences(migrated.err, copiedOverridesLine)).toBe(1);
    expect(migrated.err).not.toContain("error:");
    expect(migrated.exitCode).toBe(0);
    const packageJson = await packageJsonText(dir);
    expect(packageJson).toContain(
      '\n    "overrides": {\n        "a-dep": "1.0.1",\n        "one-dep>no-deps": "2.0.0"',
    );
    expect(JSON.parse(packageJson)).toStrictEqual({
      name: "nested-overrides",
      dependencies: { "one-dep": "1.0.0" },
      overrides: { "a-dep": "1.0.1", "one-dep>no-deps": "2.0.0" },
      pnpm: { overrides: { "one-dep>no-deps": "2.0.0" } },
    });
  });

  test("an empty pnpm.overrides is not copied and package.json is not announced as modified", async () => {
    const dir = await project({ dependencies: { "one-dep": "1.0.0" }, pnpm: { overrides: {} } }, "hoisted", {
      "pnpm-lock.yaml": await pnpmLock({ noDepsVersion: "1.0.1" }),
    });
    const before = await packageJsonText(dir);
    const migrated = await migrate(dir);
    expect(migrated.err).not.toContain("warn:");
    expect(migrated.err).not.toContain("error:");
    expect(migrated.err).not.toContain(copiedOverridesLine);
    expect(migrated.err).toMatch(migratedLine);
    expect(migrated.exitCode).toBe(0);
    expect(await packageJsonText(dir)).toBe(before);
    expect(await lock(dir)).not.toContain('"overrides"');
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
  });

  // Rejected rules are only warned about from package.json (with a caret); the lockfile side is silent so nothing prints twice.
  test("pnpm-lock.yaml rules bun rejects are dropped without lockfile-side warnings when package.json does not carry them", async () => {
    const dir = await project({ dependencies: { "one-dep": "1.0.0" } }, "hoisted", {
      "pnpm-lock.yaml": await pnpmLock({ overrides: ["left-pad: '-'", "a>b>c: 1.0.0"], noDepsVersion: "1.0.1" }),
    });
    const migrated = await migrate(dir);
    expect(migrated.err).not.toContain("warn:");
    expect(migrated.err).not.toContain("left-pad");
    expect(migrated.err).not.toContain("a>b>c");
    expect(migrated.err).not.toContain("\n\n");
    expect(migrated.err).not.toContain("error:");
    expect(migrated.err).toMatch(migratedLine);
    expect(migrated.exitCode).toBe(0);
    expect(await lock(dir)).not.toContain('"overrides"');
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
  });

  const rejectedRulesProject = () =>
    pnpmLock({ overrides: ["left-pad: '-'", "a>b>c: 1.0.0"], noDepsVersion: "1.0.1" }).then(pnpmLockText =>
      project(
        { dependencies: { "one-dep": "1.0.0" }, pnpm: { overrides: { "left-pad": "-", "a>b>c": "1.0.0" } } },
        "hoisted",
        { "pnpm-lock.yaml": pnpmLockText },
      ),
    );

  test("bun install warns once per rejected rule that the migration copied into package.json", async () => {
    const dir = await rejectedRulesProject();
    const { err, exitCode } = await install(dir);
    expect(occurrences(err, 'warn: Removing "left-pad" with "-" is not supported')).toBe(1);
    expect(occurrences(err, 'warn: Bun currently only supports one level of nested "overrides"')).toBe(1);
    expect(occurrences(err, "warn:")).toBe(2);
    expect(err).toMatch(migratedLine);
    expect(occurrences(err, copiedOverridesLine)).toBe(1);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect((await file(join(dir, "package.json")).json()).overrides).toStrictEqual({
      "left-pad": "-",
      "a>b>c": "1.0.0",
    });
    expect(await lock(dir)).not.toContain('"overrides"');
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
  });

  test("bun install --silent prints nothing while migrating a pnpm-lock.yaml with rejected rules", async () => {
    const dir = await rejectedRulesProject();
    const { out, err, exitCode } = await install(dir, "--silent");
    expect(out).toBe("");
    expect(err).toBe("");
    expect(exitCode).toBe(0);
    expect(existsSync(join(dir, "bun.lock"))).toBe(true);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
  });
});

describe.concurrent("flat override fixes", () => {
  // pnpm/pnpm#8223
  test("$ref to another package applies that spec under the overridden name", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0", "one-fixed-dep": "1.0.0" },
      overrides: { "no-deps": "$one-fixed-dep" },
    });
    await installOk(dir);
    // one-fixed-dep@1.0.0 installed into the no-deps slot would also report version 1.0.0, so the name is checked too.
    expect(await packageSeenBy(dir, "one-range-dep", "no-deps")).toBe("no-deps@1.0.0");
    const first = await lock(dir);
    expect(overridesSection(first)).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps": "1.0.0",
      },"
    `);
    await installNoChanges(dir, "--frozen-lockfile");
    await installNoChanges(dir);
    expect(await lock(dir)).toBe(first);
  });

  describe.concurrent.each([
    { group: "devDependencies", version: "1.0.0" },
    { group: "optionalDependencies", version: "1.0.1" },
    { group: "peerDependencies", version: "1.0.0" },
  ])("$ref names a $group entry", ({ group, version }) => {
    const resolvedSection = `"overrides": {\n  "no-deps": "${version}",\n  "one-range-dep": {\n    "no-deps": "${version}",\n  },\n},`;

    test("of the root", async () => {
      const dir = await project({
        dependencies: { "one-range-dep": "1.0.0" },
        [group]: { "no-deps": version },
        overrides: { "no-deps": "$no-deps", "one-range-dep": { "no-deps": "$no-deps" } },
      });
      await installOk(dir);
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe(version);
      expect(overridesSection(await lock(dir))).toBe(resolvedSection);
      await installNoChanges(dir, "--frozen-lockfile");
    });

    test("of a workspace member", async () => {
      const dir = await project(
        {
          workspaces: ["packages/*"],
          dependencies: { "one-range-dep": "1.0.0" },
          overrides: { "no-deps": "$no-deps", "one-range-dep": { "no-deps": "$no-deps" } },
        },
        "hoisted",
        { "packages/app/package.json": JSON.stringify({ name: "app", [group]: { "no-deps": version } }) },
      );
      await installOk(dir);
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe(version);
      expect(overridesSection(await lock(dir))).toBe(resolvedSection);
      await installNoChanges(dir, "--frozen-lockfile");
    });
  });

  // pnpm/pnpm#9295
  describe.concurrent("$ref resolves against workspace members", () => {
    const root = (overrides: Record<string, string>, rootDeps: Record<string, string> = {}) => ({
      workspaces: ["packages/*"],
      dependencies: { "one-range-dep": "1.0.0", ...rootDeps },
      overrides,
    });
    const member = (name: string, version: string) => JSON.stringify({ name, dependencies: { "no-deps": version } });

    test("one member declares it", async () => {
      const dir = await project(root({ "no-deps": "$no-deps" }), "hoisted", {
        "packages/app/package.json": member("app", "1.0.0"),
      });
      await installOk(dir);
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
      expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
        ""overrides": {
          "no-deps": "1.0.0",
        },"
      `);
      await installNoChanges(dir, "--frozen-lockfile");
    });

    // one-dep pins no-deps@1.0.1, so its view is unaffected by whichever member's version happens to be resolved first.
    test("members disagree", async () => {
      const dir = await project(root({ "no-deps": "$no-deps" }, { "one-dep": "1.0.0" }), "hoisted", {
        "packages/app/package.json": member("app", "1.0.0"),
        "packages/b/package.json": member("b", "1.1.0"),
      });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual([
        'warn: Could not resolve "$no-deps": workspaces declare different versions of "no-deps"',
      ]);
      expect(exitCode).toBe(0);
      expect(await lock(dir)).not.toContain('"overrides"');
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
    });

    // Precedence guard for the member lookup above; this case also passes without it.
    test("the root's own declaration wins over members", async () => {
      const dir = await project(root({ "no-deps": "$no-deps" }, { "no-deps": "1.0.1" }), "hoisted", {
        "packages/app/package.json": member("app", "1.0.0"),
      });
      await installOk(dir);
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.1");
    });
  });

  // pnpm/pnpm#12159
  describe.concurrent("catalog-valued rules follow catalog edits", () => {
    const withCatalog = (version: string, deps: Record<string, string>, overrides: Record<string, unknown>) =>
      JSON.stringify({
        name: "nested-overrides",
        workspaces: { packages: [], catalog: { "no-deps": version } },
        dependencies: deps,
        overrides,
      });

    test("flat rule", async () => {
      const deps = { "one-range-dep": "1.0.0" };
      const overrides = { "no-deps": "catalog:" };
      const { packageDir: dir } = await registry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: { "package.json": withCatalog("1.0.0", deps, overrides) },
      });
      await installOk(dir);
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");

      await write(join(dir, "package.json"), withCatalog("1.0.1", deps, overrides));
      await installOk(dir);
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.1");
      expect(await lock(dir)).not.toContain("no-deps@1.0.0");
    });

    // ofd2 declares no-deps@2.0.0 exactly; a `^1.0.0` dependent could legitimately dedupe onto the catalog's 1.0.x depending on manifest arrival order.
    test("nested rule", async () => {
      const deps = { "one-dep": "1.0.0", ofd2: twoParents.ofd2 };
      const overrides = { "one-dep": { "no-deps": "catalog:" } };
      const { packageDir: dir } = await registry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: { "package.json": withCatalog("1.0.0", deps, overrides) },
      });
      await installOk(dir);
      await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "1.0.0", ofd2: "2.0.0" });

      await write(join(dir, "package.json"), withCatalog("1.0.1", deps, overrides));
      await installOk(dir);
      await expectVersionsSeenBy(dir, "no-deps", { "one-dep": "1.0.1", ofd2: "2.0.0" });
    });

    // The rule follows the entry of the alias. The entry of the package that the alias points at does not change.
    test("rule for an npm: alias", async () => {
      const packageJson = (entry: string) =>
        JSON.stringify({
          name: "nested-overrides",
          workspaces: { packages: [], catalog: { "my-alias": entry, "no-deps": "2.0.0" } },
          dependencies: { "my-alias": "npm:no-deps@^1.0.0" },
          overrides: { "my-alias@npm:no-deps@^1.0.0": "catalog:" },
        });
      const { packageDir: dir } = await registry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: { "package.json": packageJson("npm:no-deps@1.0.0") },
      });
      await installOk(dir);
      expect(await packageSeenBy(dir, ".", "my-alias")).toBe("no-deps@1.0.0");

      await write(join(dir, "package.json"), packageJson("npm:no-deps@1.0.1"));
      await installOk(dir);
      expect(await packageSeenBy(dir, ".", "my-alias")).toBe("no-deps@1.0.1");
      expect(await lock(dir)).not.toContain("no-deps@1.0.0");
      await installNoChanges(dir, "--frozen-lockfile");
    });
  });

  describe.concurrent("a catalog: rule without an entry is pointed out where it is in package.json", () => {
    const needsWorkspaces = ': catalogs require a "workspaces" field in the root package.json';
    test.each([
      ["no workspaces field", { catalog: { "no-deps": "1.0.0" } }, "catalog:", needsWorkspaces],
      ["no entry", { workspaces: [], catalog: { "a-dep": "1.0.1" } }, "catalog:", ""],
      ["no such catalog", { workspaces: [], catalog: { "no-deps": "1.0.0" } }, "catalog:x", ""],
    ])("%s", async (_, catalogs, rule, why) => {
      const dir = await project({ dependencies: { "one-dep": "1.0.0" }, ...catalogs, overrides: { "no-deps": rule } });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual([
        `warn: no-deps@${rule} not in catalog${why}`,
        "error: no-deps@1.0.1 failed to resolve",
      ]);
      expect(err).toMatch(/package\.json:\d+:\d+/);
      expect(exitCode).toBe(1);
    });

    test("a package that only a peer asks for", async () => {
      const dir = await project({
        dependencies: { "peer-deps": "1.0.0" },
        catalog: { "no-deps": "1.0.0" },
        overrides: { "no-deps": "catalog:" },
      });
      const { err, exitCode } = await install(dir);
      expect(diagnostics(err)).toEqual([`warn: no-deps@catalog: not in catalog${needsWorkspaces}`]);
      expect(exitCode).toBe(0);
    });
  });
});

describe.concurrent("per-edge effective range", () => {
  test("bun dedupe does not collapse edges whose scoped rules pin different versions", async () => {
    const dir = await project({
      dependencies: twoParents,
      overrides: { "one-fixed-dep@1": { "no-deps": "1.1.0" }, "one-fixed-dep@2": { "no-deps": "1.0.0" } },
    });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.1.0", ofd2: "1.0.0" });
    const { out, err, exitCode } = await run(dir, "dedupe", "--check");
    expect(out).toContain("No duplicates");
    expect(diagnostics(err)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("an edge whose scoped rule is a range shares the version its sibling's rule pins", async () => {
    const dir = await project({
      dependencies: twoParents,
      overrides: { "one-fixed-dep@1": { "no-deps": "^1.0.0" }, "one-fixed-dep@2": { "no-deps": "1.0.0" } },
    });
    await installOk(dir);
    await expectVersionsSeenBy(dir, "no-deps", { ofd1: "1.0.0", ofd2: "1.0.0" });
    const { out, err, exitCode } = await run(dir, "dedupe", "--check");
    expect(out).toContain("No duplicates");
    expect(diagnostics(err)).toEqual([]);
    expect(exitCode).toBe(0);
  });
});
