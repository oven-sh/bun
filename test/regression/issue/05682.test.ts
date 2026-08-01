// https://github.com/oven-sh/bun/issues/5682
//
// `bun install -g .` from a package directory failed with
//   error: refusing to install dependency with unsafe name
// and left `{"": "."}` in the global package.json. Relative folder
// specifiers (`.`, `./pkg`, `../pkg`, `file:.`) were written verbatim into the
// global manifest and then resolved against the global dir after `init()`
// chdir'd there, instead of the directory the user ran the command from.

import { file, spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

function makePkg(withBin: boolean) {
  return tempDir("issue-5682", {
    "pkg/package.json": JSON.stringify({
      name: "mypkg-5682",
      version: "1.0.0",
      ...(withBin ? { bin: { "mypkg-5682": "./cli.js" } } : {}),
    }),
    "pkg/cli.js": "#!/usr/bin/env node\nprocess.stdout.write('hello from mypkg');\n",
    "sibling/.keep": "",
  });
}

function globalDir(root: string) {
  return join(root, "bun-install", "install", "global");
}

// The install pipeline stores folder paths with forward slashes even on
// Windows (see `platform_to_posix_in_place` in UpdateRequest parsing).
function posix(p: string) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

async function runInstall(root: string, cwd: string, args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: {
      ...bunEnv,
      BUN_INSTALL: join(root, "bun-install"),
      BUN_INSTALL_CACHE_DIR: join(root, "cache"),
      XDG_CACHE_HOME: join(root, "xdg-cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("bun install -g with a relative folder (#5682)", () => {
  test.concurrent("`.` installs the local package and links its bin", async () => {
    using dir = makePkg(true);
    const root = String(dir);
    const pkg = join(root, "pkg");

    const { stdout, stderr, exitCode } = await runInstall(root, pkg, ["install", "-g", "."]);

    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("unsafe name");
    expect(stdout).toContain("mypkg-5682");
    expect(exitCode).toBe(0);

    const globalManifest = await file(join(globalDir(root), "package.json")).json();
    expect(Object.keys(globalManifest.dependencies)).toEqual(["mypkg-5682"]);
    expect(posix(globalManifest.dependencies["mypkg-5682"])).toBe(posix(pkg));

    const binDir = join(root, "bun-install", "bin");
    const binName = isWindows ? "mypkg-5682.bunx" : "mypkg-5682";
    expect(await file(join(binDir, binName)).exists()).toBe(true);

    expect(await file(join(globalDir(root), "node_modules", "mypkg-5682", "cli.js")).text()).toContain(
      "hello from mypkg",
    );
  });

  test.concurrent.each([
    ["install", "-g", "./"],
    ["install", "-g", "file:."],
    ["add", "-g", "."],
  ])("`%s %s %s` resolves against the invocation cwd", async (...args) => {
    using dir = makePkg(false);
    const root = String(dir);
    const pkg = join(root, "pkg");

    const { stderr, exitCode } = await runInstall(root, pkg, args);

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const globalManifest = await file(join(globalDir(root), "package.json")).json();
    expect(Object.keys(globalManifest.dependencies)).toEqual(["mypkg-5682"]);
    expect(posix(globalManifest.dependencies["mypkg-5682"])).toBe(posix(pkg));
  });

  test.concurrent("`../pkg` from a sibling directory resolves against the invocation cwd", async () => {
    using dir = makePkg(false);
    const root = String(dir);
    const sibling = join(root, "sibling");
    const pkg = join(root, "pkg");

    const { stderr, exitCode } = await runInstall(root, sibling, ["install", "-g", `..${isWindows ? "\\" : "/"}pkg`]);

    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("failed to resolve");
    expect(exitCode).toBe(0);

    const globalManifest = await file(join(globalDir(root), "package.json")).json();
    expect(Object.keys(globalManifest.dependencies)).toEqual(["mypkg-5682"]);
    expect(posix(globalManifest.dependencies["mypkg-5682"])).toBe(posix(pkg));
  });

  test.concurrent("`file:pkg` (relative path without a leading dot) resolves against the invocation cwd", async () => {
    using dir = makePkg(false);
    const root = String(dir);

    const { stderr, exitCode } = await runInstall(root, root, ["install", "-g", "file:pkg"]);

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const globalManifest = await file(join(globalDir(root), "package.json")).json();
    expect(Object.keys(globalManifest.dependencies)).toEqual(["mypkg-5682"]);
    expect(posix(globalManifest.dependencies["mypkg-5682"])).toBe(posix(join(root, "pkg")));
  });
});
