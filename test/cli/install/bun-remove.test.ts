import { file, spawn } from "bun";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, normalizeBunSnapshot, tempDir, tmpdirSync } from "harness";
import { join, relative } from "path";
import { createTestContext, destroyTestContext, dummyAfterAll, dummyBeforeAll } from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

it.concurrent("should remove existing package", async () => {
  const ctx = await createTestContext();
  try {
    const package_dir = ctx.package_dir;
    const remove_dir = tmpdirSync();
    const pkg1_dir = join(remove_dir, "pkg1");
    const pkg1_path = relative(package_dir, pkg1_dir);
    await mkdir(pkg1_dir);
    const pkg2_dir = join(remove_dir, "pkg2");
    const pkg2_path = relative(package_dir, pkg2_dir);
    await mkdir(pkg2_dir);

    await writeFile(
      join(pkg1_dir, "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "0.0.1",
      }),
    );
    await writeFile(
      join(pkg2_dir, "package.json"),
      JSON.stringify({
        name: "pkg2",
        version: "0.0.1",
      }),
    );
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.2",
      }),
    );
    const { exited: exited1 } = spawn({
      cmd: [bunExe(), "add", `file:${pkg1_path}`.replace(/\\/g, "\\\\")],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await exited1).toBe(0);
    const { exited: exited2 } = spawn({
      cmd: [bunExe(), "add", `file:${pkg2_path}`.replace(/\\/g, "\\\\")],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await exited2).toBe(0);
    expect(await file(join(package_dir, "package.json")).text()).toEqual(
      JSON.stringify(
        {
          name: "foo",
          version: "0.0.2",
          dependencies: {
            pkg1: `file:${pkg1_path.replace(/\\/g, "/")}`,
            pkg2: `file:${pkg2_path.replace(/\\/g, "/")}`,
          },
        },
        null,
        2,
      ),
    );

    const {
      exited: removeExited1,
      stdout: stdout1,
      stderr: stderr1,
    } = spawn({
      cmd: [bunExe(), "remove", "pkg1"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await removeExited1).toBe(0);
    const out1 = await new Response(stdout1).text();
    const err1 = await new Response(stderr1).text();

    expect(out1.replace(/\s*\[[0-9\.]+m?s\]/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun remove v1."),
      "",
      `+ pkg2@${pkg2_path.replace(/\\/g, "/")}`,
      "",
      "1 package installed",
      "Removed: 1",
      "",
    ]);
    expect(err1.split(/\r?\n/)).toEqual(["Saved lockfile", ""]);
    expect(await file(join(package_dir, "package.json")).text()).toEqual(
      JSON.stringify(
        {
          name: "foo",
          version: "0.0.2",
          dependencies: {
            pkg2: `file:${pkg2_path.replace(/\\/g, "/")}`,
          },
        },
        null,
        2,
      ),
    );

    const {
      exited: removeExited2,
      stdout: stdout2,
      stderr: stderr2,
    } = spawn({
      cmd: [bunExe(), "remove", "pkg2"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await removeExited2).toBe(0);
    const out2 = await new Response(stdout2).text();
    const err2 = await new Response(stderr2).text();

    expect(out2.replace(/ \[[0-9\.]+m?s\]/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun remove v1."),
      "",
      "- pkg2",
      "1 package removed",
      "",
    ]);
    expect(err2.split(/\r?\n/)).toEqual(["", "package.json has no dependencies! Deleted empty lockfile", ""]);
    expect(await file(join(package_dir, "package.json")).text()).toEqual(
      JSON.stringify(
        {
          name: "foo",
          version: "0.0.2",
        },
        null,
        2,
      ),
    );
  } finally {
    destroyTestContext(ctx);
  }
});

it.concurrent("should not reject missing package", async () => {
  const ctx = await createTestContext();
  try {
    const package_dir = ctx.package_dir;
    const remove_dir = tmpdirSync();
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
      }),
    );
    await writeFile(
      join(remove_dir, "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "0.0.2",
      }),
    );
    const pkg_path = relative(package_dir, remove_dir);
    const { exited: addExited } = spawn({
      cmd: [bunExe(), "add", `file:${pkg_path}`.replace(/\\/g, "\\\\")],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await addExited).toBe(0);

    const { exited: rmExited } = spawn({
      cmd: [bunExe(), "remove", "pkg2"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await rmExited).toBe(0);
  } finally {
    destroyTestContext(ctx);
  }
});

it.concurrent("should not affect if package is not installed", async () => {
  const ctx = await createTestContext();
  try {
    const package_dir = ctx.package_dir;
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "remove", "pkg"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await exited).toBe(0);
    const out = await stdout.text();
    expect(out.split("\n")).toEqual([expect.stringContaining("bun remove v1."), ""]);
    const err = await stderr.text();
    expect(err.replace(/ \[[0-9\.]+m?s\]/, "").split(/\r?\n/)).toEqual([
      "package.json doesn't have dependencies, there's nothing to remove!",
      "",
    ]);
  } finally {
    destroyTestContext(ctx);
  }
});

it.concurrent("should retain a new line in the end of package.json", async () => {
  const ctx = await createTestContext();
  try {
    const package_dir = ctx.package_dir;
    const remove_dir = tmpdirSync();
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
      }),
    );
    await writeFile(
      join(remove_dir, "package.json"),
      JSON.stringify({
        name: "pkg",
        version: "0.0.2",
      }),
    );
    const pkg_path = relative(package_dir, remove_dir);
    const { exited: addExited } = spawn({
      cmd: [bunExe(), "add", `file:${pkg_path}`.replace(/\\/g, "\\\\")],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await addExited).toBe(0);
    const content_before_remove = await file(join(package_dir, "package.json")).text();
    expect(content_before_remove.endsWith("}")).toBe(true);
    expect(content_before_remove).toEqual(
      JSON.stringify(
        {
          name: "foo",
          version: "0.0.1",
          dependencies: {
            pkg: `file:${pkg_path.replace(/\\/g, "/")}`,
          },
        },
        null,
        2,
      ),
    );
    await writeFile(join(package_dir, "package.json"), content_before_remove + "\n");

    const { exited } = spawn({
      cmd: [bunExe(), "remove", "pkg"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    expect(await exited).toBe(0);
    const content_after_remove = await file(join(package_dir, "package.json")).text();
    expect(content_after_remove.endsWith("}\n")).toBe(true);
    expect(content_after_remove).toEqual(
      JSON.stringify(
        {
          name: "foo",
          version: "0.0.1",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    destroyTestContext(ctx);
  }
});

it.concurrent("should remove peerDependencies", async () => {
  const ctx = await createTestContext();
  try {
    const package_dir = ctx.package_dir;
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        peerDependencies: {
          bar: "~0.0.1",
        },
      }),
    );
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "remove", "bar"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    const out = await stdout.text();
    expect(out.replace(/\[[0-9\.]+m?s\]/, "").split(/\r?\n/)).toEqual([
      expect.stringContaining("bun remove v1."),
      "",
      " done",
      "",
    ]);
    expect(await exited).toBe(0);
    expect(await file(join(package_dir, "package.json")).json()).toEqual({
      name: "foo",
    });
  } finally {
    destroyTestContext(ctx);
  }
});

const local = (name: string) => ({ [`${name}/package.json`]: JSON.stringify({ name, version: "1.0.0" }) });

const localBin = (name: string) => ({
  [`${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", bin: { [name]: "cli.js" } }),
  [`${name}/cli.js`]: "#!/usr/bin/env node\n",
});

async function run(dir: string, ...args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    env: { ...env, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const remove = (dir: string, ...names: string[]) => run(dir, "remove", ...names);

const binEntries = (dir: string) => readdirSync(join(dir, "node_modules", ".bin")).sort();

it.concurrent("bun remove drops every duplicate key of the removed package", async () => {
  using dir = tempDir("bun-remove-dup", {
    ...local("foo"),
    ...local("bar"),
    "package.json": `{
  "name": "dup",
  "dependencies": {
    "foo": "file:./foo",
    "bar": "file:./bar",
    "foo": "file:./foo"
  }
}
`,
  });

  const { stderr, exitCode } = await remove(String(dir), "foo");

  expect(stderr).not.toContain("error:");
  expect(await file(join(String(dir), "package.json")).json()).toStrictEqual({
    name: "dup",
    dependencies: { bar: "file:./bar" },
  });
  expect(existsSync(join(String(dir), "node_modules", "foo"))).toBe(false);
  expect(existsSync(join(String(dir), "node_modules", "bar", "package.json"))).toBe(true);
  expect(exitCode).toBe(0);
});

it.concurrent("bun remove drops the list when the removed package is its only (duplicated) entry", async () => {
  using dir = tempDir("bun-remove-dup-only", {
    ...local("foo"),
    ...local("bar"),
    "package.json": `{
  "name": "dup",
  "dependencies": { "bar": "file:./bar" },
  "devDependencies": {
    "foo": "file:./foo",
    "foo": "file:./foo"
  }
}
`,
  });

  const { stderr, exitCode } = await remove(String(dir), "foo");

  expect(stderr).not.toContain("error:");
  expect(await file(join(String(dir), "package.json")).json()).toStrictEqual({
    name: "dup",
    dependencies: { bar: "file:./bar" },
  });
  expect(exitCode).toBe(0);
});

it.concurrent(
  "bun remove rejects a dependency list that is not an object and leaves package.json untouched",
  async () => {
    const pkg = JSON.stringify({ name: "x", dependencies: ["foo"], devDependencies: { bar: "file:./bar" } });
    using dir = tempDir("bun-remove-malformed", { ...local("bar"), "package.json": pkg });

    const { stderr, exitCode } = await remove(String(dir), "bar");

    expect(stderr).toContain("dependencies expects a map of specifiers");
    expect(await file(join(String(dir), "package.json")).text()).toBe(pkg);
    expect(exitCode).toBe(1);
  },
);

for (const linker of ["hoisted", "isolated"] as const) {
  it.concurrent.skipIf(isWindows)(`bun remove unlinks only the removed package's .bin entry (${linker})`, async () => {
    using dir = tempDir(`bun-remove-bin-${linker}`, {
      ...localBin("what-bin"),
      ...localBin("other-bin"),
      "package.json": JSON.stringify({
        name: "root",
        dependencies: { "what-bin": "file:./what-bin", "other-bin": "file:./other-bin" },
      }),
    });

    {
      const { stderr, exitCode } = await run(String(dir), "install", "--linker", linker);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    expect(binEntries(String(dir))).toStrictEqual(["other-bin", "what-bin"]);

    const { stderr, exitCode } = await remove(String(dir), "what-bin", "--linker", linker);
    expect(stderr).not.toContain("error:");
    expect(binEntries(String(dir))).toStrictEqual(["other-bin"]);
    expect(existsSync(join(String(dir), "node_modules", ".bin", "other-bin"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules", "what-bin"))).toBe(false);
    expect(await file(join(String(dir), "package.json")).json()).toStrictEqual({
      name: "root",
      dependencies: { "other-bin": "file:./other-bin" },
    });
    expect(exitCode).toBe(0);
  });
}

it.concurrent("bun r is an alias of bun remove", async () => {
  using dir = tempDir("bun-r-alias", {
    ...local("foo"),
    ...local("bar"),
    "package.json": JSON.stringify({ name: "root", dependencies: { foo: "file:./foo", bar: "file:./bar" } }),
  });

  {
    const { stderr, exitCode } = await run(String(dir), "install");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  const { stdout, stderr, exitCode } = await run(String(dir), "r", "foo");
  expect(stderr).not.toContain("error:");
  expect(normalizeBunSnapshot(stdout, String(dir))).toMatchInlineSnapshot(`
    "bun remove <version> (<revision>)

    + bar@bar

    1 package installed
    Removed: 1"
  `);
  expect(await file(join(String(dir), "package.json")).json()).toStrictEqual({
    name: "root",
    dependencies: { bar: "file:./bar" },
  });
  expect(existsSync(join(String(dir), "node_modules", "foo"))).toBe(false);
  expect(existsSync(join(String(dir), "node_modules", "bar", "package.json"))).toBe(true);
  expect(exitCode).toBe(0);
});

it.concurrent("bun remove -r is rejected and leaves package.json untouched", async () => {
  const pkg = JSON.stringify({ name: "root", dependencies: { foo: "file:./foo" } });
  using dir = tempDir("bun-remove-dash-r", { ...local("foo"), "package.json": pkg });

  const { stderr, exitCode } = await remove(String(dir), "foo", "-r");
  expect(stderr).toContain("error: Invalid Argument '-r'");
  expect(await file(join(String(dir), "package.json")).text()).toBe(pkg);
  expect(exitCode).toBe(1);
});

const MONOREPO_ROOT = `{
  "name": "root",
  "workspaces": ["packages/*"],
  "dependencies": { "dep": "file:./dep" }
}
`;
const WORKSPACE = (name: string) => `{
  "name": "${name}",
  "dependencies": { "dep": "file:../../dep" }
}
`;

function monorepo(prefix: string) {
  return tempDir(prefix, {
    ...local("dep"),
    "package.json": MONOREPO_ROOT,
    "packages/api/package.json": WORKSPACE("api"),
    "packages/web/package.json": WORKSPACE("web"),
  });
}

it.concurrent("bun remove -F edits only the selected workspace", async () => {
  using dir = monorepo("bun-remove-F");

  const { stderr, exitCode } = await remove(String(dir), "dep", "-F", "api");
  expect(stderr).not.toContain("error:");
  expect(await file(join(String(dir), "packages", "api", "package.json")).json()).toStrictEqual({ name: "api" });
  expect(await file(join(String(dir), "packages", "web", "package.json")).text()).toBe(WORKSPACE("web"));
  expect(await file(join(String(dir), "package.json")).text()).toBe(MONOREPO_ROOT);
  expect(exitCode).toBe(0);
});

it.concurrent("bun remove --recursive is not a workspace-wide remove: only the current package is edited", async () => {
  using dir = monorepo("bun-remove-recursive");

  const { stderr, exitCode } = await remove(String(dir), "dep", "--recursive");
  expect(stderr).not.toContain("error:");
  expect(await file(join(String(dir), "package.json")).json()).toStrictEqual({
    name: "root",
    workspaces: ["packages/*"],
  });
  expect(await file(join(String(dir), "packages", "api", "package.json")).text()).toBe(WORKSPACE("api"));
  expect(await file(join(String(dir), "packages", "web", "package.json")).text()).toBe(WORKSPACE("web"));
  expect(exitCode).toBe(0);
});
