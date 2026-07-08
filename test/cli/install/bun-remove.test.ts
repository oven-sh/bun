import { file, spawn, write } from "bun";
import { expect, it } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { NpmRegistry, bunExe, bunEnv as env, tmpdirSync } from "harness";
import { join, relative } from "path";

interface TestContext {
  registry: NpmRegistry;
  package_dir: string;
  registry_url: string;
  readonly requested: number;
}

// None of these tests resolve anything from a registry (they only add file:
// dependencies); each gets an empty one so that an install that unexpectedly
// tried to would fail loudly instead of reaching a real registry.
async function createTestContext(): Promise<TestContext> {
  const registry = await new NpmRegistry().start();
  const package_dir = tmpdirSync();
  await write(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "${registry.url}"
saveTextLockfile = false
`,
  );
  return {
    registry,
    package_dir,
    registry_url: registry.url,
    get requested() {
      return registry.requestCount;
    },
  };
}

function destroyTestContext(ctx: TestContext): void {
  ctx.registry.stop();
}

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
