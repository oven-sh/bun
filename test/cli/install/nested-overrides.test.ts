import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "fs";
import { rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe } from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type Linker = "hoisted" | "isolated";

// CI exports BUN_INSTALL_CACHE_DIR, which overrides the harness bunfig's per-test `cache`; concurrent cases sharing one cache race on Windows.
const installEnv = (dir: string) => ({ ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") });

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

async function installOk(dir: string, ...args: string[]) {
  const result = await install(dir, ...args);
  expect(result.err).not.toContain("error:");
  expect(result.exitCode).toBe(0);
  return result;
}

// `from` is a dependency name (resolved through node_modules) or a workspace path; returns what that package sees as `name@version`.
async function packageSeenBy(packageDir: string, from: string | undefined, name: string): Promise<string> {
  const cwd =
    from === undefined
      ? packageDir
      : from.includes("/")
        ? join(packageDir, from)
        : realpathSync(join(packageDir, "node_modules", from));
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const p = require(${JSON.stringify(name + "/package.json")}); console.log(p.name + "@" + p.version)`,
    ],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toBe("");
  expect(exitCode).toBe(0);
  return out.trim();
}

async function versionSeenBy(packageDir: string, from: string | undefined, name: string): Promise<string> {
  const seen = await packageSeenBy(packageDir, from, name);
  return seen.slice(seen.lastIndexOf("@") + 1);
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
    const { err } = await installOk(dir);
    expect(err).not.toContain("does not support");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
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
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("2.0.0");
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
    expect(occurrences(err, 'warn: Could not resolve "$nope": "nope" is not in dependencies')).toBe(1);
    expect(err).not.toContain("Could not resolve override");
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
      const { err } = await installOk(dir);
      expect(err).not.toContain("warn:");
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
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
    const { err } = await installOk(dir);
    expect(err).not.toContain("warn:");
    expect(await versionSeenBy(dir, "packages/app", "@types/no-deps")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "packages/other", "@types/no-deps")).toBe("2.0.0");
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
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("1.0.1");
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
      const [pnpm] = await Promise.all([installOk(pnpmDir), installOk(objectDir)]);
      expect(pnpm.err).not.toContain("only supports one level");
      expect(pnpm.err).not.toContain("warn:");
      expect(await versionSeenBy(pnpmDir, "one-dep", "no-deps")).toBe("2.0.0");
      expect(await versionSeenBy(pnpmDir, "one-range-dep", "no-deps")).toBe("1.1.0");
      const [pnpmLock, objectLock] = await Promise.all([lock(pnpmDir), lock(objectDir)]);
      expect(pnpmLock).toContain('"lockfileVersion": 3');
      expect(pnpmLock).toBe(objectLock);
      const [parent, child] = Object.entries(object)[0];
      expect(overridesSection(pnpmLock)).toBe(
        `"overrides": {\n  ${JSON.stringify(parent)}: {\n    ${JSON.stringify(Object.keys(child)[0])}: "2.0.0",\n  },\n},`,
      );
      await installOk(pnpmDir, "--frozen-lockfile");
    });
  });

  test("precedence: ranged parent > unranged parent > flat", async () => {
    const dir = await project(precedenceProject);
    await installOk(dir);
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.0.1");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
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
    const { err } = await installOk(dir);
    expect(err).not.toContain("Saved lockfile");
    expect(await lock(dir)).toBe(first);
  });

  test("the same rule spelled in two syntaxes: last one wins and one row is written", async () => {
    const dir = await project({
      dependencies: { "one-dep": "1.0.0" },
      overrides: { "one-dep>no-deps": "1.0.0", "one-dep": { "no-deps": "2.0.0" } },
    });
    const { err } = await installOk(dir);
    expect(err).not.toContain("warn:");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "one-dep": {
          "no-deps": "2.0.0",
        },
      },"
    `);
    await installOk(dir, "--frozen-lockfile");
  });

  describe.concurrent.each(["overrides", "resolutions"] as const)('a "//" comment key in %s', field => {
    test("is ignored without a warning and never reaches bun.lock", async () => {
      const dir = await project({
        dependencies: { "one-dep": "1.0.0" },
        [field]: { "//": "pins no-deps until upstream updates", "no-deps": "1.0.0" },
      });
      const { err } = await installOk(dir);
      expect(err).not.toContain("warn:");
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.0");
      const text = await lock(dir);
      expect(text).not.toContain('"//"');
      expect(overridesSection(text)).toMatchInlineSnapshot(`
        ""overrides": {
          "no-deps": "1.0.0",
        },"
      `);
      await installOk(dir, "--frozen-lockfile");
    });
  });

  describe.concurrent("rejected keys warn and are ignored", () => {
    test("pnpm a>b>c", async () => {
      const dir = await project({
        dependencies: { "one-one-dep": "1.0.0" },
        overrides: { "one-one-dep>one-dep>no-deps": "2.0.0" },
      });
      const { err, exitCode } = await install(dir);
      expect(err).toContain('Bun currently only supports one level of nested "overrides"');
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
      { rules: { resolutions: { "one-dep/@scope": "2.0.0" } }, warning: 'Invalid package name "one-dep/@scope"' },
      { rules: { overrides: { "@types": "2.0.0" } }, warning: 'Invalid package name "@types"' },
      { rules: { overrides: { "@types": { "no-deps": "2.0.0" } } }, warning: 'Invalid package name "@types"' },
      { rules: { overrides: { "one-dep": { "@types": "2.0.0" } } }, warning: 'Invalid package name "@types"' },
      { rules: { resolutions: { "@types": "2.0.0" } }, warning: 'Invalid package name "@types"' },
    ])("selector %j", async ({ rules, warning }) => {
      const dir = await project({ dependencies: { "one-dep": "1.0.0" }, ...rules });
      const { err, exitCode } = await install(dir);
      expect(err).toContain(warning);
      expect(err).not.toContain("error:");
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
        warning: 'warn: Invalid resolution value for "one-dep"',
      },
      { rules: { resolutions: { "no-deps": 2 } }, warning: 'warn: Invalid resolution value for "no-deps"' },
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
      expect(occurrences(err, warning)).toBe(1);
      expect(err).not.toContain("Expected string value");
      expect(err).not.toContain("error:");
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
      expect(err).toContain('Bun currently only supports one level of nested "overrides"');
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
      expect(err).toContain('Bun currently only supports one level of nested "resolutions"');
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
      expect(occurrences(err, 'warn: Invalid version range "banana" for "one-dep"')).toBe(1);
      expect(err).not.toContain('Could not resolve "$zzz"');
      const column = (await packageJsonText(dir)).indexOf('"one-dep@banana"') + 1;
      expect(column).toBeGreaterThan(0);
      expect(err).toContain(`package.json:1:${column}`);
      expect(err).not.toContain("error:");
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
      expect(occurrences(err, 'warn: Missing version range after "one-dep@"')).toBe(1);
      expect(err).not.toContain("empty version selector");
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await lock(dir)).not.toContain('"overrides"');
    });

    describe.concurrent.each([
      { rules: { overrides: "nope" }, warning: 'warn: "overrides" must be an object' },
      { rules: { resolutions: ["x"] }, warning: 'warn: "resolutions" must be an object with string values' },
    ])("a non-object field %j", ({ rules, warning }) => {
      test("warns and installs without rules", async () => {
        const dir = await project({ dependencies: { "one-dep": "1.0.0" }, ...rules });
        const { err, exitCode } = await install(dir);
        expect(occurrences(err, warning)).toBe(1);
        expect(err).not.toContain("error");
        expect(exitCode).toBe(0);
        expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
        expect(await lock(dir)).not.toContain('"overrides"');
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
      expect(occurrences(err, 'warn: Removing "no-deps" with "-" is not supported')).toBe(1);
      expect(err).not.toContain("removes the dependency");
      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("2.0.0");
      expect(await lock(dir)).not.toContain('"overrides"');
    });
  });
});

// two-range-deps declares no-deps ^1.0.0 (1.1.0 without a rule) and @types/is-number >=1.0.0 (2.0.0 without a rule).
describe.concurrent("overrides and resolutions in the same package.json", () => {
  test("rules from both fields apply", async () => {
    const dir = await project({
      dependencies: { "two-range-deps": "1.0.0" },
      overrides: { "no-deps": "1.0.0" },
      resolutions: { "@types/is-number": "1.0.0" },
    });
    const { err } = await installOk(dir);
    expect(err).not.toContain("warn:");
    expect(await versionSeenBy(dir, "two-range-deps", "no-deps")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "two-range-deps", "@types/is-number")).toBe("1.0.0");
    const first = await lock(dir);
    expect(overridesSection(first)).toMatchInlineSnapshot(`
      ""overrides": {
        "@types/is-number": "1.0.0",
        "no-deps": "1.0.0",
      },"
    `);
    await installOk(dir, "--frozen-lockfile");
    const again = await installOk(dir);
    expect(again.err).not.toContain("Saved lockfile");
    expect(await lock(dir)).toBe(first);
  });

  test("a scoped rule in resolutions applies next to a flat rule in overrides", async () => {
    const dir = await project({
      dependencies: { "two-range-deps": "1.0.0", "one-range-dep": "1.0.0" },
      overrides: { "@types/is-number": "1.0.0" },
      resolutions: { "one-range-dep/no-deps": "2.0.0" },
    });
    const { err } = await installOk(dir);
    expect(err).not.toContain("warn:");
    expect(await versionSeenBy(dir, "two-range-deps", "@types/is-number")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("2.0.0");
    expect(await versionSeenBy(dir, "two-range-deps", "no-deps")).toBe("1.1.0");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "@types/is-number": "1.0.0",
        "one-range-dep": {
          "no-deps": "2.0.0",
        },
      },"
    `);
    await installOk(dir, "--frozen-lockfile");
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

  // A flat `npm:` rule also registers an alias that redirects matching edges before overrides are consulted,
  // so a resolutions rule that loses to overrides must not be parsed at all.
  test("a losing resolutions rule with an npm: value does not redirect the edge", async () => {
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

  test("within resolutions the last spelling of a rule still wins", async () => {
    const dir = await project({
      dependencies: { "two-range-deps": "1.0.0" },
      overrides: { "@types/is-number": "1.0.0" },
      resolutions: { "**/no-deps": "1.0.0", "no-deps": "1.0.1" },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, "two-range-deps", "no-deps")).toBe("1.0.1");
    expect(await versionSeenBy(dir, "two-range-deps", "@types/is-number")).toBe("1.0.0");
  });

  test("editing resolutions is a frozen-lockfile change that names both fields", async () => {
    const pkg = {
      dependencies: { "two-range-deps": "1.0.0" },
      overrides: { "no-deps": "1.0.0" },
      resolutions: { "@types/is-number": "1.0.0" },
    };
    const dir = await project(pkg);
    await installOk(dir);
    pkg.resolutions["@types/is-number"] = "2.0.0";
    await write(join(dir, "package.json"), JSON.stringify({ name: "nested-overrides", ...pkg }));
    const frozen = await install(dir, "--frozen-lockfile");
    expect(frozen.err).toContain("error: lockfile had changes, but lockfile is frozen");
    expect(frozen.err).toContain("note: overrides or resolutions in package.json changed since bun.lock was saved");
    expect(frozen.exitCode).toBe(1);
    await installOk(dir);
    expect(await versionSeenBy(dir, "two-range-deps", "@types/is-number")).toBe("2.0.0");
  });
});

// The selector range is matched against the range the dependent declares; a rule applies when the two intersect.
describe.concurrent("version-scoped targets", () => {
  test("a flat name@range rule applies to edges whose declared range intersects it", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0", ...twoParents },
      overrides: { "no-deps@1": "1.0.0" },
    });
    const { err } = await installOk(dir);
    expect(err).not.toContain("does not support");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("2.0.0");
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.0.0");
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
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("2.0.0");
    expect(overridesSection(await lock(dir))).toContain('"no-deps@>=1.0.0 <1.1.0": {');
  });

  test("|| alternatives are matched independently", async () => {
    const dir = await project({
      dependencies: { "one-dep": "1.0.0", ...twoParents },
      overrides: { "no-deps@1.0.0 || 2.0.0": "1.1.0" },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
  });

  test("a declared || range matches when either alternative intersects the selector", async () => {
    const dir = await project({
      dependencies: { "no-deps": "1.0.0 || 2.0.0" },
      overrides: { "no-deps@2": "1.1.0" },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, undefined, "no-deps")).toBe("1.1.0");
    await installOk(dir, "--frozen-lockfile");
  });

  describe.concurrent.each([
    { declared: "*", rule: { "no-deps@1": "1.0.0" }, expected: "1.0.0" },
    { declared: "*", rule: { "no-deps@>2.0.0": "1.0.1" }, expected: "1.0.1" },
    { declared: ">=1.0.0", rule: { "no-deps@1": "1.0.0" }, expected: "1.0.0" },
    { declared: ">=1.0.0", rule: { "no-deps@>2.0.0": "1.0.1" }, expected: "1.0.1" },
  ])("an unbounded declared range %j", ({ declared, rule, expected }) => {
    test("intersects the selector", async () => {
      const dir = await project({ dependencies: { "no-deps": declared }, overrides: rule });
      const { err } = await installOk(dir);
      expect(err).not.toContain("warn:");
      expect(await versionSeenBy(dir, undefined, "no-deps")).toBe(expected);
      await installOk(dir, "--frozen-lockfile");
    });
  });

  test("pnpm key whose range contains > after ||", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0", ofd2: twoParents.ofd2 },
      overrides: { "no-deps@1 || >=2": "1.1.0" },
    });
    const { err } = await installOk(dir);
    expect(err).not.toContain("warn:");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("1.1.0");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps@1 || >=2": {
          ".": "1.1.0",
        },
      },"
    `);
    await installOk(dir, "--frozen-lockfile");
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
    const { err } = await installOk(dir);
    expect(err).not.toContain("warn:");
    expect(await versionSeenBy(dir, "packages/app", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    await installOk(dir, "--frozen-lockfile");
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
    const { err } = await installOk(dir);
    expect(err).not.toContain("warn:");
    expect(await versionSeenBy(dir, "packages/app", "no-deps")).toBe("9.0.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    await installOk(dir, "--frozen-lockfile");
  });

  test("a prerelease selector keeps applying after the lockfile is cloned for a dependency change", async () => {
    const overrides = { "no-deps@>=1.0.0-0 <2": "1.1.0" };
    const dir = await project({ dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0" }, overrides });
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
    await write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "nested-overrides",
        dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0", "a-dep": "1.0.1" },
        overrides,
      }),
    );
    const { err } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, undefined, "a-dep")).toBe("1.0.1");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps@>=1.0.0-0 <2": {
          ".": "1.1.0",
        },
      },"
    `);
    await installOk(dir, "--frozen-lockfile");
  });

  test("a non-intersecting range leaves the edge alone and is still recorded", async () => {
    const dir = await project({
      dependencies: { "one-range-dep": "1.0.0", "one-dep": "1.0.0" },
      overrides: { "no-deps@2": "1.0.0", "no-deps@<1.0.1": "2.0.0" },
    });
    const { err } = await installOk(dir);
    expect(err).not.toContain("warn");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("2.0.0");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
    const section = overridesSection(await lock(dir));
    expect(section).toContain('"no-deps@2": {');
    expect(section).toContain('"no-deps@<1.0.1": {');
    await installOk(dir, "--frozen-lockfile");
  });

  test("edges declared with a dist-tag never match", async () => {
    const dir = await project({
      dependencies: { "no-deps": "latest", "one-range-dep": "1.0.0" },
      overrides: { "no-deps@>=1": "1.0.0" },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, undefined, "no-deps")).toBe("2.0.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
  });

  describe.concurrent.each([
    { overrides: { "one-dep>no-deps@1": "2.0.0" } },
    { overrides: { "one-dep": { "no-deps@1": "2.0.0" } } },
    { resolutions: { "one-dep/no-deps@1": "2.0.0" } },
  ])("nested rules accept a target range in every spelling %j", rules => {
    test("applies to one-dep's edge only", async () => {
      const dir = await project({ dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0" }, ...rules });
      const { err } = await installOk(dir);
      expect(err).not.toContain("does not support");
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
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
    const { err } = await installOk(dir);
    expect(err).not.toContain("warn:");
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
    const { err } = await installOk(dir);
    expect(err).not.toContain("Saved lockfile");
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
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("2.0.0");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("1.0.0");
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
    expect(occurrences(err, 'warn: Missing version range after "no-deps@"')).toBe(1);
    expect(err).not.toContain("empty version selector");
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
    expect(err).toContain('Invalid version range "banana" for "no-deps"');
    expect(exitCode).toBe(0);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
    expect(await lock(dir)).not.toContain('"lockfileVersion": 3');
  });
});

describe.concurrent.each(["hoisted", "isolated"] as const)("linker=%s", linker => {
  test("two dependents of one name see different versions", async () => {
    const dir = await project(npmObjectProject, linker);
    await installOk(dir, "--linker", linker);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
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
    expect(await versionSeenBy(dir, "packages/app-a", "no-deps")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "packages/app-b", "no-deps")).toBe("2.0.0");
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
    const { err } = await installOk(dir, "--linker", linker);
    expect(err).not.toContain("warn:");
    expect(await versionSeenBy(dir, "packages/app-a", "no-deps")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "packages/app-b", "no-deps")).toBe("1.1.0");
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
    await installOk(dir, "--linker", linker, "--frozen-lockfile");
  });

  // peer-deps declares no-deps@*, which resolves to 2.0.0 without the rule.
  test("a scoped rule applies to the parent's peer dependency edge", async () => {
    const dir = await project(
      { dependencies: { "peer-deps": "1.0.0" }, overrides: { "peer-deps": { "no-deps": "1.0.0" } } },
      linker,
    );
    const installed = await installOk(dir, "--linker", linker);
    expect(installed.err).not.toContain("incorrect peer dependency");
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
    await installOk(dir, "--linker", linker, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "peer-deps", "no-deps")).toBe("1.0.0");
    const { err } = await installOk(dir, "--linker", linker);
    expect(err).not.toContain("Saved lockfile");
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
    const { err } = await installOk(dir, "--linker", linker);
    expect(err).toContain('incorrect peer dependency "no-deps@1.1.0"');
    expect(await versionSeenBy(dir, "peer-deps", "no-deps")).toBe("1.1.0");
    const first = await lock(dir);
    await installOk(dir, "--linker", linker, "--frozen-lockfile");
    expect(await lock(dir)).toBe(first);
    expect(await versionSeenBy(dir, "peer-deps", "no-deps")).toBe("1.1.0");
  });

  test("a nested rule with an npm: alias value", async () => {
    const dir = await project(
      {
        dependencies: { "one-dep": "1.0.0", "one-range-dep": "1.0.0" },
        overrides: { "one-dep": { "no-deps": "npm:a-dep@1.0.1" } },
      },
      linker,
    );
    const { err } = await installOk(dir, "--linker", linker);
    expect(err).not.toContain("warn:");
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
    await installOk(dir, "--linker", linker, "--frozen-lockfile");
    const second = await installOk(dir, "--linker", linker);
    expect(second.err).not.toContain("Saved lockfile");
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
    const { err } = await installOk(dir, "--linker", linker);
    expect(err).not.toContain("warn:");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("9.0.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
    const first = await lock(dir);
    expect(overridesSection(first)).toMatchInlineSnapshot(`
      ""overrides": {
        "one-dep": {
          "no-deps": "workspace:*",
        },
      },"
    `);
    await installOk(dir, "--linker", linker, "--frozen-lockfile");
    const second = await installOk(dir, "--linker", linker);
    expect(second.err).not.toContain("Saved lockfile");
    expect(await lock(dir)).toBe(first);
  });

  test("ranged flat and nested targets", async () => {
    const dir = await project(rangedProject, linker);
    await installOk(dir, "--linker", linker);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
    await installOk(dir, "--linker", linker, "--frozen-lockfile");
  });

  test("ranged parent precedence", async () => {
    const dir = await project(precedenceProject, linker);
    await installOk(dir, "--linker", linker);
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.0.1");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    await installOk(dir, "--linker", linker, "--frozen-lockfile");
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
    await installOk(dir, "--linker", linker, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.0.1");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
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
    await installOk(dir, "--linker", linker, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });
});

describe.concurrent("lockfile", () => {
  test("round trip: stable across installs, value changes are frozen-lockfile changes", async () => {
    const dir = await project(precedenceProject);
    await installOk(dir);
    const first = await lock(dir);
    await installOk(dir, "--frozen-lockfile");
    const { err } = await installOk(dir);
    expect(err).not.toContain("Saved lockfile");
    expect(await lock(dir)).toBe(first);

    // 2.0.0 keeps ofd2's edge nested; the hoisted installer leaves a nested folder behind when an edge moves up to the root's copy.
    const pkg = structuredClone(precedenceProject);
    pkg.overrides["one-fixed-dep@2"]["no-deps"] = "2.0.0";
    await write(join(dir, "package.json"), JSON.stringify({ name: "nested-overrides", ...pkg }));
    const frozen = await install(dir, "--frozen-lockfile");
    expect(frozen.err).toContain("lockfile had changes, but lockfile is frozen");
    expect(frozen.exitCode).toBe(1);
    await installOk(dir);
    const second = await lock(dir);
    expect(overridesSection(second)).toContain('"no-deps": "2.0.0"');
    expect(second).not.toContain("no-deps@1.1.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("2.0.0");
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
    const frozen = await install(dir, "--frozen-lockfile");
    expect(frozen.err).toContain("lockfile had changes, but lockfile is frozen");
    expect(frozen.exitCode).toBe(1);
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
      await installOk(dir, "--frozen-lockfile");
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
    expect(frozen.err).not.toContain("Missing integrity hash");
    expect(frozen.err).not.toContain("Ignoring lockfile");
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
    await installOk(dir, "--frozen-lockfile");
    const { err } = await installOk(dir);
    expect(err).not.toContain("Saved lockfile");
    expect(await lock(dir)).toBe(first);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });

  async function expectFrozenOverridesFailure(dir: string, field: "overrides" | "resolutions" = "overrides") {
    const frozen = await install(dir, "--frozen-lockfile");
    expect(frozen.err).toContain("error: lockfile had changes, but lockfile is frozen");
    expect(occurrences(frozen.err, `note: ${field} in package.json changed since bun.lock was saved`)).toBe(1);
    expect(frozen.err).not.toContain('"overrides"');
    expect(frozen.err).not.toContain("since the lockfile was saved");
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
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
    await write(
      join(dir, "package.json"),
      JSON.stringify({ name: "nested-overrides", dependencies: npmObjectProject.dependencies }),
    );
    await expectFrozenOverridesFailure(dir);
    const { err } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
    const after = await lock(dir);
    expect(after).not.toContain('"overrides"');
    expect(after).not.toContain("no-deps@2.0.0");
    expect(after).toContain('"lockfileVersion": 2');
    await installOk(dir, "--frozen-lockfile");
  });

  test("changing only the parent's range text is a frozen-lockfile change", async () => {
    const dir = await project({ dependencies: twoParents, overrides: { "one-fixed-dep@1": { "no-deps": "1.1.0" } } });
    await installOk(dir);
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("2.0.0");
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
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("1.1.0");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "one-fixed-dep@2": {
          "no-deps": "1.1.0",
        },
      },"
    `);
    await installOk(dir, "--frozen-lockfile");
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
      await installOk(dir, "--frozen-lockfile");
    });
  });

  test("--lockfile-only writes the scoped rules and a following --frozen-lockfile install uses them", async () => {
    const dir = await project(precedenceProject);
    const { err } = await installOk(dir, "--lockfile-only");
    expect(err).toContain("Saved lockfile");
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
    await installOk(dir, "--frozen-lockfile");
    expect(await lock(dir)).toBe(text);
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.0.1");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
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
    const { err } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "no-deps": "^1.1.0",
      },"
    `);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.1.0");
    await installOk(dir, "--frozen-lockfile");
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
    const { err } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    const section = overridesSection(await lock(dir));
    expect(section).toContain('"no-deps@^1.0.1": {');
    expect(section).not.toContain('"no-deps@1": {');
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    await installOk(dir, "--frozen-lockfile");
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
    const { err } = await installOk(dir);
    expect(err).toContain("Saved lockfile");
    const section = overridesSection(await lock(dir));
    expect(section).toContain('"no-deps@^1.0.1": "2.0.0"');
    expect(section).not.toContain('"no-deps@1": "2.0.0"');
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
    await installOk(dir, "--frozen-lockfile");
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
    const frozen = await install(dir, "--frozen-lockfile");
    expect(frozen.err).toContain("lockfile had changes, but lockfile is frozen");
    expect(frozen.exitCode).toBe(1);
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    const after = await lock(dir);
    expect(after).toContain('"lockfileVersion": 3');
    expect(after).toContain('"no-deps@1": {');
    await installOk(dir, "--frozen-lockfile");
  });

  test("objects in the overrides section are read at any lockfileVersion", async () => {
    const dir = await project(npmObjectProject);
    await installOk(dir);
    const text = await lock(dir);
    expect(text).toContain('"lockfileVersion": 3');
    await write(join(dir, "bun.lock"), text.replace('"lockfileVersion": 3', '"lockfileVersion": 2'));
    await installOk(dir, "--frozen-lockfile");
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
    expect(migrated.err).not.toContain("error:");
    expect(migrated.exitCode).toBe(0);
    const text = await lock(dir);
    expect(text).toContain('"lockfileVersion": 3');
    expect(text).toContain('"one-dep": {');
    expect(text).toContain('"no-deps": "2.0.0"');
    await installOk(dir);
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });

  test("yarn.lock migration carries both overrides and resolutions", async () => {
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
    expect(migrated.err).not.toContain("error:");
    expect(migrated.exitCode).toBe(0);
    expect(overridesSection(await lock(dir))).toMatchInlineSnapshot(`
      ""overrides": {
        "a-dep": "1.0.2",
        "no-deps": "1.0.0",
      },"
    `);
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, undefined, "a-dep")).toBe("1.0.2");
    expect(await versionSeenBy(dir, undefined, "no-deps")).toBe("1.0.0");
  });

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
  const movedOverridesLine = "moved pnpm.overrides to overrides in package.json";

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
    expect(occurrences(migrated.err, movedOverridesLine)).toBe(1);
    expect(migrated.exitCode).toBe(0);
    const text = await lock(dir);
    expect(text).toContain('"one-dep": {');
    expect(text).toContain('"no-deps": "2.0.0"');
    const packageJson = await packageJsonText(dir);
    expect(packageJson).toContain('\n  "overrides": {\n    "one-dep>no-deps": "2.0.0"');
    expect(JSON.parse(packageJson)).toStrictEqual({
      name: "nested-overrides",
      dependencies: { "one-dep": "1.0.0" },
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
    expect(occurrences(migrated.err, movedOverridesLine)).toBe(1);
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
    expect(occurrences(migrated.err, movedOverridesLine)).toBe(1);
    expect(migrated.exitCode).toBe(0);
    const text = await lock(dir);
    expect(text).toContain('"lockfileVersion": 3');
    expect(text).toContain('"no-deps@1": {');
    expect(text).toContain('".": "2.0.0"');
    expect((await file(join(dir, "package.json")).json()).overrides).toStrictEqual(pnpmOverrides);
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });

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
    expect(occurrences(migrated.err, movedOverridesLine)).toBe(1);
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
    });
  });

  test("an empty pnpm.overrides is not moved and package.json is not announced as modified", async () => {
    const dir = await project({ dependencies: { "one-dep": "1.0.0" }, pnpm: { overrides: {} } }, "hoisted", {
      "pnpm-lock.yaml": await pnpmLock({ noDepsVersion: "1.0.1" }),
    });
    const before = await packageJsonText(dir);
    const migrated = await migrate(dir);
    expect(migrated.err).not.toContain("warn:");
    expect(migrated.err).not.toContain("error:");
    expect(migrated.err).not.toContain(movedOverridesLine);
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

  test("bun install warns once per rejected rule that the migration moved into package.json", async () => {
    const dir = await rejectedRulesProject();
    const { err, exitCode } = await install(dir);
    expect(occurrences(err, 'warn: Removing "left-pad" with "-" is not supported')).toBe(1);
    expect(occurrences(err, 'warn: Bun currently only supports one level of nested "overrides"')).toBe(1);
    expect(occurrences(err, "warn:")).toBe(2);
    expect(err).toMatch(migratedLine);
    expect(occurrences(err, movedOverridesLine)).toBe(1);
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
    const section = overridesSection(first);
    expect(section).toContain('"no-deps": "1.0.0"');
    expect(section).not.toContain('"one-fixed-dep"');
    await installOk(dir, "--frozen-lockfile");
    const { err } = await installOk(dir);
    expect(err).not.toContain("Saved lockfile");
    expect(await lock(dir)).toBe(first);
  });

  describe.concurrent.each([
    { group: "devDependencies", version: "1.0.0" },
    { group: "optionalDependencies", version: "1.0.1" },
    { group: "peerDependencies", version: "1.0.0" },
  ])("$ref names a $group entry", ({ group, version }) => {
    test("of the root", async () => {
      const dir = await project({
        dependencies: { "one-range-dep": "1.0.0" },
        [group]: { "no-deps": version },
        overrides: { "no-deps": "$no-deps", "one-range-dep": { "no-deps": "$no-deps" } },
      });
      const { err } = await installOk(dir);
      expect(err).not.toContain("Could not resolve");
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe(version);
      expect(overridesSection(await lock(dir))).toBe(
        `"overrides": {\n  "no-deps": "${version}",\n  "one-range-dep": {\n    "no-deps": "${version}",\n  },\n},`,
      );
      await installOk(dir, "--frozen-lockfile");
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
      const { err } = await installOk(dir);
      expect(err).not.toContain("Could not resolve");
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe(version);
      expect(overridesSection(await lock(dir))).toContain(`"no-deps": "${version}"`);
      await installOk(dir, "--frozen-lockfile");
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
      const { err } = await installOk(dir);
      expect(err).not.toContain("Could not resolve");
      expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
      expect(overridesSection(await lock(dir))).toContain('"no-deps": "1.0.0"');
      await installOk(dir, "--frozen-lockfile");
    });

    // one-dep pins no-deps@1.0.1, so its view is unaffected by whichever member's version happens to be resolved first.
    test("members disagree", async () => {
      const dir = await project(root({ "no-deps": "$no-deps" }, { "one-dep": "1.0.0" }), "hoisted", {
        "packages/app/package.json": member("app", "1.0.0"),
        "packages/b/package.json": member("b", "1.1.0"),
      });
      const { err, exitCode } = await install(dir);
      expect(
        occurrences(err, 'warn: Could not resolve "$no-deps": workspaces declare different versions of "no-deps"'),
      ).toBe(1);
      expect(err).not.toContain("Could not resolve override");
      expect(exitCode).toBe(0);
      expect(await lock(dir)).not.toContain('"overrides"');
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
    });

    // Precedence guard for the member lookup above; this case also passes without it.
    test("the root's own declaration wins over members", async () => {
      const dir = await project(root({ "no-deps": "$no-deps" }, { "no-deps": "1.0.1" }), "hoisted", {
        "packages/app/package.json": member("app", "1.0.0"),
      });
      const { err } = await installOk(dir);
      expect(err).not.toContain("Could not resolve");
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
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.0");
      expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("2.0.0");

      await write(join(dir, "package.json"), withCatalog("1.0.1", deps, overrides));
      await installOk(dir);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("2.0.0");
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
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("1.0.0");
    const { out, err, exitCode } = await run(dir, "dedupe", "--check");
    expect(out).toContain("No duplicates");
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("bun dedupe moves an edge whose scoped rule is a range onto the version its sibling's rule pins", async () => {
    const dir = await project({
      dependencies: twoParents,
      overrides: { "one-fixed-dep@1": { "no-deps": "^1.0.0" }, "one-fixed-dep@2": { "no-deps": "1.0.0" } },
    });
    await installOk(dir);
    expect(await versionSeenBy(dir, "ofd1", "no-deps")).toBe("1.1.0");
    expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("1.0.0");
    const { out, exitCode } = await run(dir, "dedupe", "--check");
    expect(out).toContain("~ no-deps 1.1.0 -> 1.0.0");
    expect(out).toContain("1 duplicate version can be removed");
    expect(exitCode).toBe(1);
  });
});
