import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, symlink, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, tmpdirSync } from "harness";
import { join, relative } from "path";
import { dummyAfterAll, dummyAfterEach, dummyBeforeAll, dummyBeforeEach, package_dir } from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

let remove_dir: string;

beforeEach(async () => {
  remove_dir = tmpdirSync();
  await dummyBeforeEach();
});

afterEach(async () => {
  await dummyAfterEach();
});

it("should remove existing package", async () => {
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
});

it("should not reject missing package", async () => {
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
});

it("should not affect if package is not installed", async () => {
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
});

it("should retain a new line in the end of package.json", async () => {
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
});

describe("bun remove -g with a package that isn't installed", () => {
  // Sets up a throwaway $BUN_INSTALL with one global dependency (a local file: package) so that
  // the global package.json has a non-empty "dependencies" section.
  async function setupGlobalDir() {
    const root = tmpdirSync();
    const bunInstall = join(root, "bun-install");
    const globalDir = join(bunInstall, "install", "global");
    const globalBin = join(bunInstall, "bin");
    const depDir = join(root, "existing-dep");
    const extraBin = join(root, "extra-bin");

    await mkdir(globalDir, { recursive: true });
    await mkdir(globalBin, { recursive: true });
    await mkdir(depDir, { recursive: true });
    await mkdir(extraBin, { recursive: true });

    await writeFile(join(depDir, "package.json"), JSON.stringify({ name: "existing-dep", version: "1.0.0" }));
    await writeFile(
      join(globalDir, "package.json"),
      JSON.stringify({
        dependencies: {
          "existing-dep": `file:${depDir.replace(/\\/g, "/")}`,
        },
      }),
    );

    return { root, bunInstall, globalDir, globalBin, extraBin };
  }

  function globalEnv(bunInstall: string, extraPath: string) {
    const sep = isWindows ? ";" : ":";
    return {
      ...env,
      BUN_INSTALL: bunInstall,
      BUN_INSTALL_BIN: join(bunInstall, "bin"),
      PATH: `${extraPath}${sep}${join(bunInstall, "bin")}${sep}${env.PATH ?? ""}`,
    };
  }

  it("warns when the package is not installed globally", async () => {
    const { bunInstall, globalDir, extraBin } = await setupGlobalDir();

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "remove", "-g", "definitely-not-installed"],
      cwd: globalDir,
      stdout: "pipe",
      stderr: "pipe",
      env: globalEnv(bunInstall, extraBin),
    });

    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);

    expect(err).toContain("warn:");
    expect(err).toContain("definitely-not-installed is not in global package.json");
    expect(err).not.toContain("error:");
    expect(out).toContain("bun remove");
    expect(code).toBe(0);

    // existing dep is still there
    expect(await file(join(globalDir, "package.json")).json()).toMatchObject({
      dependencies: { "existing-dep": expect.any(String) },
    });
  });

  it("mentions the $PATH location when the name is a binary on $PATH", async () => {
    const { bunInstall, globalDir, extraBin } = await setupGlobalDir();

    // a binary on $PATH that is not managed by bun and doesn't point at node_modules/
    const target = join(extraBin, "somebin-target");
    await writeFile(target, "#!/bin/sh\necho hi\n");
    if (!isWindows) await chmod(target, 0o755);

    if (isWindows) {
      await writeFile(join(extraBin, "somebin.cmd"), "@echo hi\r\n");
    } else {
      await symlink(target, join(extraBin, "somebin"));
    }

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "remove", "-g", "somebin"],
      cwd: globalDir,
      stdout: "pipe",
      stderr: "pipe",
      env: globalEnv(bunInstall, extraBin),
    });

    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);

    expect(err).toContain("warn:");
    expect(err).toContain("somebin is not in global package.json");
    expect(err).toContain("$PATH");
    expect(err).not.toContain("error:");
    expect(out).toContain("bun remove");
    expect(code).toBe(0);
  });

  it.skipIf(isWindows)(
    "suggests the package name when the binary on $PATH points into node_modules/",
    async () => {
      const { root, bunInstall, globalDir, extraBin } = await setupGlobalDir();

      // simulate e.g. `tsc` -> `.../node_modules/typescript/bin/tsc`
      const nmBin = join(root, "some-other-tool", "node_modules", "some-real-package", "bin");
      await mkdir(nmBin, { recursive: true });
      const target = join(nmBin, "mybin");
      await writeFile(target, "#!/bin/sh\necho hi\n");
      await chmod(target, 0o755);
      await symlink(target, join(extraBin, "mybin"));

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "remove", "-g", "mybin"],
        cwd: globalDir,
        stdout: "pipe",
        stderr: "pipe",
        env: globalEnv(bunInstall, extraBin),
      });

      const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);

      expect(err).toContain("warn:");
      expect(err).toContain("mybin is not in global package.json");
      expect(err).toContain("bun remove -g some-real-package");
      expect(err).not.toContain("error:");
      expect(out).toContain("bun remove");
      expect(code).toBe(0);
    },
  );

  it.skipIf(isWindows)(
    "suggests scoped package names when the binary on $PATH points into node_modules/@scope/name/",
    async () => {
      const { root, bunInstall, globalDir, extraBin } = await setupGlobalDir();

      const nmBin = join(root, "other", "node_modules", "@my-scope", "the-pkg", "bin");
      await mkdir(nmBin, { recursive: true });
      const target = join(nmBin, "scopedbin");
      await writeFile(target, "#!/bin/sh\necho hi\n");
      await chmod(target, 0o755);
      await symlink(target, join(extraBin, "scopedbin"));

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "remove", "-g", "scopedbin"],
        cwd: globalDir,
        stdout: "pipe",
        stderr: "pipe",
        env: globalEnv(bunInstall, extraBin),
      });

      const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);

      expect(err).toContain("warn:");
      expect(err).toContain("bun remove -g @my-scope/the-pkg");
      expect(err).not.toContain("error:");
      expect(out).toContain("bun remove");
      expect(code).toBe(0);
    },
  );

  it("does not warn when the package is installed globally", async () => {
    const { bunInstall, globalDir, extraBin } = await setupGlobalDir();

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "remove", "-g", "existing-dep"],
      cwd: globalDir,
      stdout: "pipe",
      stderr: "pipe",
      env: globalEnv(bunInstall, extraBin),
    });

    const [out, err, code] = await Promise.all([stdout.text(), stderr.text(), exited]);

    expect(err).not.toContain("is not in global package.json");
    expect(err).not.toContain("error:");
    expect(out).toContain("bun remove");
    expect(code).toBe(0);
    expect(await file(join(globalDir, "package.json")).json()).toEqual({});
  });
});

it("should remove peerDependencies", async () => {
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
});
