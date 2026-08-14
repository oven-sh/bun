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
    expect(err).toContain('Could not resolve override "$nope" (you need "nope" in your dependencies)');
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

  describe.concurrent("rejected keys warn and are ignored", () => {
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

    test("unparsable parent range", async () => {
      const dir = await project({
        dependencies: { "one-dep": "1.0.0" },
        overrides: { "one-dep@banana": { "no-deps": "2.0.0" } },
      });
      const { err, exitCode } = await install(dir);
      expect(err).toContain('Invalid version range "banana" for "one-dep"');
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await lock(dir)).not.toContain('"lockfileVersion": 3');
    });
  });

  // pnpm's `-` deletes the dependency; Bun warns and installs as if the rule were absent (both dependents pin no-deps exactly, so nothing can dedupe onto the other's version).
  describe.concurrent.each([
    { rules: { overrides: { "no-deps": "-" } }, label: "override" },
    { rules: { overrides: { "one-dep": { "no-deps": "-" } } }, label: "override" },
    { rules: { resolutions: { "no-deps": "-" } }, label: "resolution" },
    { rules: { resolutions: { "one-dep/no-deps": "-" } }, label: "resolution" },
  ])('a "-" value warns and is ignored %j', ({ rules, label }) => {
    test("install still succeeds", async () => {
      const dir = await project({ dependencies: { "one-dep": "1.0.0", ofd2: twoParents.ofd2 }, ...rules });
      const { err, exitCode } = await install(dir);
      expect(err).toContain(`${label} "no-deps" removes the dependency ('-'), which bun does not support`);
      expect(err).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("1.0.1");
      expect(await versionSeenBy(dir, "ofd2", "no-deps")).toBe("2.0.0");
      expect(await lock(dir)).not.toContain('"overrides"');
    });
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
    expect(err).toContain("does not support an empty version selector");
    expect(err).toContain('override "no-deps@" will not apply');
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

  describe.concurrent.each([1, 2] as const)("an existing v%i lockfile with a walk-fallback row", loaded => {
    test("gains a nested rule: re-saved lockfile is stamped 3", async () => {
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
      expect(after).toContain('"lockfileVersion": 3');
      expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
      await installOk(dir, "--frozen-lockfile");
    });
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

  async function expectFrozenOverridesFailure(dir: string) {
    const frozen = await install(dir, "--frozen-lockfile");
    expect(frozen.err).toContain("overrides");
    expect(frozen.err).toContain("frozen");
    expect(frozen.exitCode).toBe(1);
  }

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

  test("bun.lockb round-trips nested rules", async () => {
    const { packageDir: dir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted", saveTextLockfile: false },
      files: { "package.json": JSON.stringify({ name: "nested-overrides", ...npmObjectProject }) },
    });
    await installOk(dir);
    expect(existsSync(join(dir, "bun.lockb"))).toBe(true);
    expect(existsSync(join(dir, "bun.lock"))).toBe(false);
    await rm(join(dir, "node_modules"), { recursive: true, force: true });
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });

  test("bun.lockb round-trips ranged rules", async () => {
    const { packageDir: dir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted", saveTextLockfile: false },
      files: { "package.json": JSON.stringify({ name: "nested-overrides", ...rangedProject }) },
    });
    await installOk(dir);
    expect(existsSync(join(dir, "bun.lockb"))).toBe(true);
    expect(existsSync(join(dir, "bun.lock"))).toBe(false);
    await rm(join(dir, "node_modules"), { recursive: true, force: true });
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-range-dep", "no-deps")).toBe("1.0.0");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
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

  function pnpmLock(overrides: string, oneDep: string, noDeps: string) {
    return `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

overrides:
  ${overrides}

importers:

  .:
    dependencies:
      one-dep:
        specifier: 1.0.0
        version: 1.0.0

packages:

  no-deps@2.0.0:
    resolution: {integrity: ${noDeps}}

  one-dep@1.0.0:
    resolution: {integrity: ${oneDep}}

snapshots:

  no-deps@2.0.0: {}

  one-dep@1.0.0:
    dependencies:
      no-deps: 2.0.0
`;
  }

  test("pnpm-lock.yaml parent>child overrides become nested rules that package.json agrees with", async () => {
    const [oneDep, noDeps] = await Promise.all([integrityOf("one-dep", "1.0.0"), integrityOf("no-deps", "2.0.0")]);
    const dir = await project(
      { dependencies: { "one-dep": "1.0.0" }, pnpm: { overrides: { "one-dep>no-deps": "2.0.0" } } },
      "hoisted",
      { "pnpm-lock.yaml": pnpmLock("one-dep>no-deps: 2.0.0", oneDep, noDeps) },
    );
    const migrated = await migrate(dir);
    expect(migrated.err).not.toContain("does not support");
    expect(migrated.err).not.toContain("error:");
    expect(migrated.exitCode).toBe(0);
    const text = await lock(dir);
    expect(text).toContain('"one-dep": {');
    expect(text).toContain('"no-deps": "2.0.0"');
    expect((await file(join(dir, "package.json")).json()).overrides).toStrictEqual({ "one-dep>no-deps": "2.0.0" });
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });

  test("pnpm-lock.yaml parent>child@range override becomes a ranged nested rule", async () => {
    const [oneDep, noDeps] = await Promise.all([integrityOf("one-dep", "1.0.0"), integrityOf("no-deps", "2.0.0")]);
    const pnpmOverrides = { "one-dep>no-deps@1": "2.0.0" };
    const dir = await project({ dependencies: { "one-dep": "1.0.0" }, pnpm: { overrides: pnpmOverrides } }, "hoisted", {
      "pnpm-lock.yaml": pnpmLock("one-dep>no-deps@1: 2.0.0", oneDep, noDeps),
    });
    const migrated = await migrate(dir);
    expect(migrated.err).not.toContain("does not support");
    expect(migrated.err).not.toContain("error:");
    expect(migrated.exitCode).toBe(0);
    const text = await lock(dir);
    expect(text).toContain('"one-dep": {');
    expect(text).toContain('"no-deps@1": "2.0.0"');
    expect((await file(join(dir, "package.json")).json()).overrides).toStrictEqual(pnpmOverrides);
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
  });

  test("pnpm-lock.yaml name@range override becomes a ranged flat rule", async () => {
    const [oneDep, noDeps] = await Promise.all([integrityOf("one-dep", "1.0.0"), integrityOf("no-deps", "2.0.0")]);
    const pnpmOverrides = { "no-deps@1": "2.0.0" };
    const dir = await project({ dependencies: { "one-dep": "1.0.0" }, pnpm: { overrides: pnpmOverrides } }, "hoisted", {
      "pnpm-lock.yaml": pnpmLock("no-deps@1: 2.0.0", oneDep, noDeps),
    });
    const migrated = await migrate(dir);
    expect(migrated.err).not.toContain("does not support");
    expect(migrated.err).not.toContain("error:");
    expect(migrated.exitCode).toBe(0);
    const text = await lock(dir);
    expect(text).toContain('"lockfileVersion": 3');
    expect(text).toContain('"no-deps@1": {');
    expect(text).toContain('".": "2.0.0"');
    expect((await file(join(dir, "package.json")).json()).overrides).toStrictEqual(pnpmOverrides);
    await installOk(dir, "--frozen-lockfile");
    expect(await versionSeenBy(dir, "one-dep", "no-deps")).toBe("2.0.0");
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
      expect(err).toContain(
        'Could not resolve override "$no-deps": workspaces declare different versions of "no-deps"',
      );
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
    expect(out).toContain("- no-deps@1.1.0");
    expect(out).toContain("1 duplicate version can be removed");
    expect(exitCode).toBe(1);
  });
});
