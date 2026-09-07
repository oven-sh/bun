import { file, spawn, write } from "bun";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { bunExe, bunEnv as env, VerdaccioRegistry } from "harness";
import { delimiter, join } from "path";

var registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

const bunInstall = async (cwd: string, args: string[]) => {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, code };
};

const folderDependencySteps = (packageDir: string) => {
  const lock = () => file(join(packageDir, "bun.lock")).text();
  return {
    lock,
    async expectFrozenLockfileToFail(args = ["install", "--frozen-lockfile"]) {
      const { out, err, code } = await bunInstall(packageDir, args);
      expect({ out, err, code }).toMatchObject({ code: 1 });
      expect(err).toContain("lockfile had changes, but lockfile is frozen");
    },
    async expectInstallToSaveLockfile() {
      const { out, err, code } = await bunInstall(packageDir, ["install"]);
      expect({ out, err, code }).toMatchObject({ code: 0 });
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
    },
    async expectInstallToBeANoop() {
      const before = await lock();
      let res = await bunInstall(packageDir, ["install", "--frozen-lockfile"]);
      expect(res).toMatchObject({ code: 0 });
      expect(res.err).not.toContain("error:");
      res = await bunInstall(packageDir, ["install"]);
      expect(res).toMatchObject({ code: 0 });
      expect(res.err).not.toContain("Saved lockfile");
      expect(res.err).not.toContain("error:");
      expect(await lock()).toBe(before);
    },
    // the version of each package that `node_modules/vdir` resolves, as reported by its index.js
    async versionsResolvedByVdir() {
      await using proc = spawn({
        cmd: [bunExe(), "-p", `JSON.stringify(require("vdir"))`],
        cwd: packageDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).toBe("");
      expect(code).toBe(0);
      return JSON.parse(out);
    },
  };
};

const vdirIndexJs = /* js */ `module.exports = Object.fromEntries(["no-deps", "a-dep", "no-deps-bins", "basic-1"].map(name => {
  try {
    return [name, require(name + "/package.json").version];
  } catch {
    return [name, null];
  }
}));`;

for (const linker of ["hoisted", "isolated"] as const) {
  it.concurrent(`edits to the package.json of a file: directory dependency are installed (${linker} linker)`, async () => {
    const { packageDir, packageJson } = await registry.createTestDir({
      bunfigOpts: { saveTextLockfile: true, linker },
      files: {
        "vendor/vdir/package.json": JSON.stringify({
          name: "vdir",
          version: "1.0.0",
          dependencies: { "no-deps": "1.0.0" },
        }),
        "vendor/vdir/index.js": vdirIndexJs,
      },
    });
    await write(packageJson, JSON.stringify({ name: "app", dependencies: { vdir: "file:./vendor/vdir" } }));
    const vdirPackageJson = join(packageDir, "vendor", "vdir", "package.json");
    const {
      lock,
      expectFrozenLockfileToFail,
      expectInstallToSaveLockfile,
      expectInstallToBeANoop,
      versionsResolvedByVdir,
    } = folderDependencySteps(packageDir);

    await expectInstallToSaveLockfile();
    expect(await lock()).toContain(`"vdir@file:vendor/vdir", { "dependencies": { "no-deps": "1.0.0" } }`);
    expect(await versionsResolvedByVdir()).toEqual({
      "no-deps": "1.0.0",
      "a-dep": null,
      "no-deps-bins": null,
      "basic-1": null,
    });

    // a dependency is added
    await write(
      vdirPackageJson,
      JSON.stringify({ name: "vdir", version: "1.0.1", dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.2" } }),
    );
    await expectFrozenLockfileToFail();
    await expectFrozenLockfileToFail(["ci"]);
    await expectInstallToSaveLockfile();
    expect(await lock()).toContain(
      `"vdir@file:vendor/vdir", { "dependencies": { "a-dep": "1.0.2", "no-deps": "1.0.0" } }`,
    );
    expect(await versionsResolvedByVdir()).toEqual({
      "no-deps": "1.0.0",
      "a-dep": "1.0.2",
      "no-deps-bins": null,
      "basic-1": null,
    });
    await expectInstallToBeANoop();

    // a dependency is removed, a range no longer matches the locked version, and
    // optional and peer dependencies are added
    await write(
      vdirPackageJson,
      JSON.stringify({
        name: "vdir",
        version: "1.0.2",
        dependencies: { "a-dep": "^1.0.3" },
        optionalDependencies: { "no-deps-bins": "1.0.0" },
        peerDependencies: { "basic-1": "^1.0.0" },
      }),
    );
    await expectFrozenLockfileToFail();
    await expectInstallToSaveLockfile();
    expect(await lock()).toContain(
      `"vdir@file:vendor/vdir", { "dependencies": { "a-dep": "^1.0.3" }, "optionalDependencies": { "no-deps-bins": "1.0.0" }, "peerDependencies": { "basic-1": "^1.0.0" } }`,
    );
    expect(await lock()).not.toContain(`"no-deps@`);
    expect(await lock()).not.toContain(`"a-dep@1.0.2"`);
    expect(await versionsResolvedByVdir()).toMatchObject({
      "a-dep": "1.0.10",
      "no-deps-bins": "1.0.0",
      "basic-1": "1.0.0",
    });
    await expectInstallToBeANoop();

    // a bin is added
    await write(
      vdirPackageJson,
      JSON.stringify({
        name: "vdir",
        version: "1.0.3",
        bin: { "vdir-cli": "index.js" },
        dependencies: { "a-dep": "^1.0.3" },
        optionalDependencies: { "no-deps-bins": "1.0.0" },
        peerDependencies: { "basic-1": "^1.0.0" },
      }),
    );
    await expectFrozenLockfileToFail();
    await expectInstallToSaveLockfile();
    expect(await lock()).toContain(
      `"vdir@file:vendor/vdir", { "dependencies": { "a-dep": "^1.0.3" }, "optionalDependencies": { "no-deps-bins": "1.0.0" }, "peerDependencies": { "basic-1": "^1.0.0" }, "bin": { "vdir-cli": "index.js" } }`,
    );
    expect(Bun.which("vdir-cli", { PATH: join(packageDir, "node_modules", ".bin") })).not.toBeNull();
    await expectInstallToBeANoop();
  });

  it.concurrent(
    `edits to the package.json of a file: directory dependency of a workspace are installed (${linker} linker)`,
    async () => {
      const { packageDir, packageJson } = await registry.createTestDir({
        bunfigOpts: { saveTextLockfile: true, linker },
        files: {
          "vendor/vdir/package.json": JSON.stringify({
            name: "vdir",
            version: "1.0.0",
            dependencies: { "no-deps": "1.0.0" },
          }),
          "vendor/vdir/index.js": vdirIndexJs,
          "packages/app/package.json": JSON.stringify({
            name: "app",
            dependencies: { vdir: "file:../../vendor/vdir" },
          }),
        },
      });
      await write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
      const { lock, expectFrozenLockfileToFail, expectInstallToSaveLockfile, expectInstallToBeANoop } =
        folderDependencySteps(packageDir);

      await expectInstallToSaveLockfile();
      expect(await lock()).toContain(`"vdir@file:vendor/vdir", { "dependencies": { "no-deps": "1.0.0" } }`);

      await write(
        join(packageDir, "vendor", "vdir", "package.json"),
        JSON.stringify({
          name: "vdir",
          version: "1.0.1",
          bin: "index.js",
          dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.2" },
        }),
      );
      await expectFrozenLockfileToFail();
      await expectInstallToSaveLockfile();
      expect(await lock()).toContain(
        `"vdir@file:vendor/vdir", { "dependencies": { "a-dep": "1.0.2", "no-deps": "1.0.0" }, "bin": "index.js" }`,
      );
      expect(await lock()).toContain(`"a-dep@1.0.2"`);
      // the hoisted linker hoists vdir and its bin to the root, the isolated linker keeps them in the workspace
      const binDirs = [join(packageDir, "node_modules", ".bin"), join(packageDir, "packages", "app", "node_modules", ".bin")];
      expect(Bun.which("vdir", { PATH: binDirs.join(delimiter) })).not.toBeNull();
      await expectInstallToBeANoop();
    },
  );
}
