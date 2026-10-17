import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, readdirSorted, tempDir } from "harness";
import { lstatSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { androidSeccompWrap } from "./android-seccomp";

test.skipIf(!androidSeccompWrap)("bun install survives Android-style seccomp (openat2/fchmodat2 SIGSYS)", async () => {
  using dir = tempDir("install-android-seccomp", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { dep: "file:./dep" },
    }),
    "dep/package.json": JSON.stringify({
      name: "dep",
      version: "1.0.0",
      bin: { dep: "bin/dep.js" },
    }),
    // bin in a subdirectory so bin linking validates the parent dir with
    // openat2(RESOLVE_BENEATH), then chmods the target (fchmodat2).
    "dep/bin/dep.js": "#!/usr/bin/env node\nconsole.log('ok');\n",
    // What makes bun recognize Android here: the test host's kernel release string isn't Android's.
    "system/bin/linker64": "",
  });

  await using proc = Bun.spawn({
    cmd: [androidSeccompWrap!, bunExe(), "install"],
    cwd: String(dir),
    env: { ...bunEnv, ANDROID_ROOT: join(String(dir), "system"), ANDROID_DATA: "/data" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Without the runtime Android detection the install dies with SIGSYS
  // (exit 159) in bin linking.
  expect({ stdout, stderr, signalCode: proc.signalCode ?? null, exitCode }).toMatchObject({
    signalCode: null,
    exitCode: 0,
  });

  // The bin link was created and the target was made executable — proving
  // the lchmod fallback actually chmod'd instead of silently skipping.
  const binLink = join(String(dir), "node_modules", ".bin", "dep");
  expect(lstatSync(binLink).isSymbolicLink()).toBe(true);
  const targetMode = statSync(join(String(dir), "node_modules", "dep", "bin", "dep.js")).mode;
  expect(targetMode & 0o111).not.toBe(0);
});

// A hoisted `file:` package with a directory that has entries. Installed again, its previous copy is deleted.
const hoistedFiles = {
  "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
  "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
  "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", bin: { dep: "bin/dep.js" } }),
  "dep/bin/dep.js": "#!/usr/bin/env node\nconsole.log('ok');\n",
  "system/bin/linker64": "",
};
async function underAndroidSeccomp(dir: string, ...cmd: string[]) {
  await using proc = Bun.spawn({
    cmd,
    cwd: dir,
    env: {
      ...bunEnv,
      ANDROID_ROOT: join(dir, "system"),
      ANDROID_DATA: "/data",
      BUN_INSTALL_CACHE_DIR: join(dir, ".cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, signalCode: proc.signalCode ?? null, exitCode }).toMatchObject({
    signalCode: null,
    exitCode: 0,
  });
}

// Where bun calls no openat2 it asks `rmdir` before it opens a directory that it is to delete.
test.skipIf(!androidSeccompWrap)("the previous copy of a package is deleted under Android-style seccomp", async () => {
  using dir = tempDir("install-android-seccomp-force", hoistedFiles);
  const modules = join(String(dir), "node_modules");
  const bun = [androidSeccompWrap!, bunExe()];

  await underAndroidSeccomp(String(dir), ...bun, "install");
  mkdirSync(join(modules, "dep", "empty"));
  await underAndroidSeccomp(String(dir), ...bun, "install", "--force");
  expect({ node_modules: await readdirSorted(modules), dep: await readdirSorted(join(modules, "dep")) }).toEqual({
    node_modules: [".bin", "dep"],
    dep: ["bin", "package.json"],
  });

  await underAndroidSeccomp(String(dir), ...bun, "remove", "dep");
  expect(await readdirSorted(modules)).toEqual([".bin"]);
});

// Mounting needs a private user and mount namespace. Skipped where those are turned off, as in most containers.
const canMount =
  isLinux &&
  Bun.which("unshare") !== null &&
  Bun.spawnSync({ cmd: ["unshare", "-Urm", "true"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

// `rmdir` says EBUSY for a mount point, and bun does not open it.
test.skipIf(!androidSeccompWrap || !canMount)(
  "no delete goes into a volume that is mounted in a package under Android-style seccomp",
  async () => {
    using dir = tempDir("install-android-seccomp-volume", { ...hoistedFiles, "volume/host.js": "" });
    const bun = [androidSeccompWrap!, bunExe()];

    await underAndroidSeccomp(String(dir), ...bun, "install");
    await underAndroidSeccomp(
      String(dir),
      "unshare",
      "-Urm",
      "/bin/sh",
      "-c",
      'mkdir node_modules/dep/vol && mount -o bind volume node_modules/dep/vol || exit 125; "$@"',
      "sh",
      ...bun,
      "install",
      "--force",
    );
    expect(await readdirSorted(join(String(dir), "volume"))).toEqual(["host.js"]);
  },
);
