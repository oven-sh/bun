import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmod, mkdir, symlink, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, mergeWindowEnvs, tempDir, tmpdirSync } from "harness";
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

describe.concurrent("bun remove -g with a package that isn't installed", () => {
  // Sets up a throwaway $BUN_INSTALL under `root`. When `withExistingDep` is true the global
  // package.json gets one local file: dependency so its "dependencies" section is non-empty.
  async function setupGlobalDir(root: string, { withExistingDep = true } = {}) {
    const bunInstall = join(root, "bun-install");
    const globalDir = join(bunInstall, "install", "global");
    const extraBin = join(root, "extra-bin");

    await mkdir(globalDir, { recursive: true });
    await mkdir(join(bunInstall, "bin"), { recursive: true });
    await mkdir(extraBin, { recursive: true });

    const pkg: Record<string, unknown> = { name: "global" };
    if (withExistingDep) {
      const depDir = join(root, "existing-dep");
      await mkdir(depDir, { recursive: true });
      await writeFile(join(depDir, "package.json"), JSON.stringify({ name: "existing-dep", version: "1.0.0" }));
      pkg.dependencies = { "existing-dep": `file:${depDir.replace(/\\/g, "/")}` };
    }
    await writeFile(join(globalDir, "package.json"), JSON.stringify(pkg));

    return { root, bunInstall, globalDir, extraBin };
  }

  async function run(ctx: Awaited<ReturnType<typeof setupGlobalDir>>, name: string) {
    const sep = isWindows ? ";" : ":";
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "remove", "-g", name],
      cwd: ctx.globalDir,
      stdout: "pipe",
      stderr: "pipe",
      env: mergeWindowEnvs([
        env,
        {
          BUN_INSTALL: ctx.bunInstall,
          BUN_INSTALL_BIN: join(ctx.bunInstall, "bin"),
          PATH: `${ctx.extraBin}${sep}${join(ctx.bunInstall, "bin")}${sep}${process.env.PATH ?? ""}`,
        },
      ]),
    });
    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);
    return { out, err, code };
  }

  it("warns when the package is not installed globally", async () => {
    using dir = tempDir("remove-g", {});
    const ctx = await setupGlobalDir(String(dir));

    const { out, err, code } = await run(ctx, "definitely-not-installed");

    expect(err).toContain("warn:");
    expect(err).toContain("definitely-not-installed is not in global package.json");
    expect(err).not.toContain("error:");
    expect(out).toContain("bun remove");
    expect(code).toBe(0);

    // existing dep is still there
    expect(await file(join(ctx.globalDir, "package.json")).json()).toMatchObject({
      dependencies: { "existing-dep": expect.any(String) },
    });
  });

  it("warns even when the global package.json has no dependency sections", async () => {
    using dir = tempDir("remove-g", {});
    const ctx = await setupGlobalDir(String(dir), { withExistingDep: false });

    const { out, err, code } = await run(ctx, "definitely-not-installed");

    expect(err).toContain("warn:");
    expect(err).toContain("definitely-not-installed is not in global package.json");
    expect(err).toContain("package.json doesn't have dependencies");
    expect(out).toContain("bun remove");
    expect(code).toBe(0);
  });

  it("mentions the $PATH location when the name is a binary on $PATH", async () => {
    using dir = tempDir("remove-g", {});
    const ctx = await setupGlobalDir(String(dir));

    // a binary on $PATH that is not managed by bun and doesn't point at node_modules/
    if (isWindows) {
      await writeFile(join(ctx.extraBin, "somebin.cmd"), "@echo hi\r\n");
    } else {
      const target = join(ctx.extraBin, "somebin-target");
      await writeFile(target, "#!/bin/sh\necho hi\n");
      await chmod(target, 0o755);
      await symlink(target, join(ctx.extraBin, "somebin"));
    }

    const { out, err, code } = await run(ctx, "somebin");

    expect(err).toContain("warn:");
    expect(err).toContain("somebin is not in global package.json");
    expect(err).toContain("$PATH");
    expect(err).not.toContain("error:");
    expect(out).toContain("bun remove");
    expect(code).toBe(0);
  });

  it.skipIf(isWindows)("suggests the package name when the binary on $PATH points into node_modules/", async () => {
    using dir = tempDir("remove-g", {});
    const ctx = await setupGlobalDir(String(dir));

    // simulate e.g. `tsc` -> `.../node_modules/typescript/bin/tsc`
    const nmBin = join(ctx.root, "some-other-tool", "node_modules", "some-real-package", "bin");
    await mkdir(nmBin, { recursive: true });
    const target = join(nmBin, "mybin");
    await writeFile(target, "#!/bin/sh\necho hi\n");
    await chmod(target, 0o755);
    await symlink(target, join(ctx.extraBin, "mybin"));

    const { out, err, code } = await run(ctx, "mybin");

    expect(err).toContain("warn:");
    expect(err).toContain("mybin is not in global package.json");
    expect(err).toContain("bun remove -g some-real-package");
    expect(err).not.toContain("error:");
    expect(out).toContain("bun remove");
    expect(code).toBe(0);
  });

  it.skipIf(isWindows)(
    "suggests scoped package names when the binary on $PATH points into node_modules/@scope/name/",
    async () => {
      using dir = tempDir("remove-g", {});
      const ctx = await setupGlobalDir(String(dir));

      const nmBin = join(ctx.root, "other", "node_modules", "@my-scope", "the-pkg", "bin");
      await mkdir(nmBin, { recursive: true });
      const target = join(nmBin, "scopedbin");
      await writeFile(target, "#!/bin/sh\necho hi\n");
      await chmod(target, 0o755);
      await symlink(target, join(ctx.extraBin, "scopedbin"));

      const { out, err, code } = await run(ctx, "scopedbin");

      expect(err).toContain("warn:");
      expect(err).toContain("bun remove -g @my-scope/the-pkg");
      expect(err).not.toContain("error:");
      expect(out).toContain("bun remove");
      expect(code).toBe(0);
    },
  );

  it("does not warn when the package is installed globally", async () => {
    using dir = tempDir("remove-g", {});
    const ctx = await setupGlobalDir(String(dir));

    const { out, err, code } = await run(ctx, "existing-dep");

    expect(err).not.toContain("is not in global package.json");
    expect(err).not.toContain("error:");
    expect(out).toContain("bun remove");
    expect(code).toBe(0);
    expect(await file(join(ctx.globalDir, "package.json")).json()).toEqual({ name: "global" });
  });
});
