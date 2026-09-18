import { spawn, spawnSync } from "bun";
import { install_test_helpers } from "bun:internal-for-testing";
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { dirname, join } from "path";

let cwd: string;

setDefaultTimeout(1000 * 60 * 5);

beforeEach(() => {
  cwd = tmpdirSync();
});

test("bad workspace path", () => {
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "hey",
        workspaces: ["i-dont-exist"],
      },
      null,
      2,
    ),
  );
  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = stderr!.toString();

  expect(text).toContain('Workspace not found "i-dont-exist"');

  expect(exitCode).toBe(1);
});

// The glob walker opens the literal prefix of an absolute pattern before it walks it. When
// that directory is missing, the error names the errno by its node spelling on every
// platform (Windows used to print the bare variant name, "NOENT").
test("glob entry under a missing directory reports the errno name", async () => {
  using dir = tempDir("bad-workspace-glob-missing-root", {});
  const entry = `${String(dir).replaceAll("\\", "/")}/missing/*`;
  writeFileSync(join(String(dir), "package.json"), rootPackageJson([entry]));

  const { stderr, exitCode } = await runInstall(String(dir));

  expect(stderr).toContain(`error: Failed to run workspace pattern ${entry} due to error ENOENT`);
  expect(exitCode).toBe(1);
});

test("non-string workspaces entry prints the error without literal markup", async () => {
  using dir = tempDir("bad-workspace-non-string", {
    "package.json": JSON.stringify({ name: "hey", workspaces: [123] }),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(
    'Workspaces expects an array of strings, like:\n  "workspaces": [\n    "path/to/package"\n  ]',
  );
  // Pretty-markup tags ("<r>", "<green>") must not leak into the message.
  expect(stdout + stderr).not.toContain("<r>");
  expect(exitCode).toBe(1);
});

test("workspace with ./ should not crash", () => {
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "my-app",
        version: "1.0.0",
        workspaces: ["./", "some-workspace"],
        devDependencies: {
          "@eslint/js": "^9.28.0",
        },
      },
      null,
      2,
    ),
  );
  mkdirSync(`${cwd}/some-workspace`);
  writeFileSync(
    `${cwd}/some-workspace/package.json`,
    JSON.stringify(
      {
        name: "some-workspace",
        version: "1.0.0",
      },
      null,
      2,
    ),
  );
  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = stderr!.toString();

  // Should not crash, should succeed
  expect(exitCode).toBe(0);
  expect(text).not.toContain("panic");
  expect(text).not.toContain("Internal assertion failure");
});

test("workspace with .\\ should not crash", () => {
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "my-app",
        version: "1.0.0",
        workspaces: [".\\", "some-workspace"],
        devDependencies: {
          "@eslint/js": "^9.28.0",
        },
      },
      null,
      2,
    ),
  );
  mkdirSync(`${cwd}/some-workspace`);
  writeFileSync(
    `${cwd}/some-workspace/package.json`,
    JSON.stringify(
      {
        name: "some-workspace",
        version: "1.0.0",
      },
      null,
      2,
    ),
  );
  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = stderr!.toString();

  // Should not crash, should succeed
  expect(exitCode).toBe(0);
  expect(text).not.toContain("panic");
  expect(text).not.toContain("Internal assertion failure");
});

// Each `workspaces` entry is joined onto the project directory in a path buffer of
// MAX_PATH_BYTES: 4096 bytes on Linux, 1024 on macOS (on Windows 32767 * 3 + 1, more than
// any path the OS accepts, so the tests around the buffer size are POSIX only). Glob
// entries are first joined onto "package.json" in a 4096 byte buffer on every platform.
const POSIX_PATH_BUFFER_BYTES = isLinux ? 4096 : 1024;
// Longer than either buffer on every platform.
const LONG_ENTRY_BYTES = 100_000;

const PKG1 = { "pkgs/pkg1/package.json": JSON.stringify({ name: "pkg1" }) };

function rootPackageJson(workspaces: string[]) {
  return JSON.stringify({ name: "root", workspaces });
}

async function runInstall(cwd: string, args: string[] = []) {
  await using proc = spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Installs and asserts that pkgs/pkg1 is the only workspace package that was found.
async function expectOnlyPkg1Found(dir: string) {
  const { stderr, exitCode } = await runInstall(dir);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(Object.values(install_test_helpers.parseLockfile(dir).workspace_paths)).toEqual(["pkgs/pkg1"]);
}

// `bun install` creates `<dir>/node_modules` for every package it resolves as
// `workspace:<dir>`, so a `<dir>` outside the root is a write into a directory the project
// does not own. A cloned repository could name the user's own project next to it this way:
// that project then loads the clone's code, with no lifecycle script involved.
describe.concurrent("workspace packages outside the workspace root", () => {
  // A clone in `clone/` next to the user's own project in `victim/`. `inner@1.99.0` in the
  // clone satisfies the range the victim depends on, so a link written into
  // `victim/node_modules` makes the victim load the clone's copy.
  const SIBLING_PROJECTS = {
    "victim/package.json": JSON.stringify({ name: "victim", dependencies: { inner: "^1.0.0" } }),
    "clone/packages/inner/package.json": JSON.stringify({ name: "inner", version: "1.99.0" }),
  };

  function cloneRoot(fields: object) {
    return JSON.stringify({ name: "root", workspaces: ["packages/*"], ...fields });
  }

  function readIfExists(path: string) {
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  }

  // The install fails, names the workspace, and writes nothing.
  async function expectRejected(dir: string, workspacePath: string, args: string[] = []) {
    const clone = join(dir, "clone");
    const lockfileBefore = readIfExists(join(clone, "bun.lock"));

    const { stderr, exitCode } = await runInstall(clone, args);

    expect(stderr).toContain(
      `error: workspace "victim" (${workspacePath}) is outside the workspace root: it resolves to "${join(dir, "victim")}"\n`,
    );
    expect(existsSync(join(dir, "victim", "node_modules"))).toBe(false);
    expect(existsSync(join(clone, "node_modules"))).toBe(false);
    expect(readIfExists(join(clone, "bun.lock"))).toBe(lockfileBefore);
    expect(exitCode).toBe(1);
  }

  // The name of the dependency does not have to be the name of the sibling.
  test.each(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])(
    "a workspace: path in %s that leaves the root is rejected",
    async group => {
      using dir = tempDir("bad-workspace-dependency-sibling", {
        ...SIBLING_PROJECTS,
        "clone/package.json": cloneRoot({ [group]: { anything: "workspace:../victim" } }),
      });

      await expectRejected(String(dir), "../victim");
    },
  );

  test("it is rejected with the hoisted linker too", async () => {
    using dir = tempDir("bad-workspace-dependency-hoisted", {
      ...SIBLING_PROJECTS,
      "clone/package.json": cloneRoot({ dependencies: { anything: "workspace:../victim" } }),
    });

    await expectRejected(String(dir), "../victim", ["--linker", "hoisted"]);
  });

  test("an absolute workspace: path outside the root is rejected", async () => {
    using dir = tempDir("bad-workspace-dependency-absolute", {
      ...SIBLING_PROJECTS,
      "clone/package.json": ({ root }) =>
        cloneRoot({ dependencies: { anything: `workspace:${join(root, "victim")}` } }),
    });

    await expectRejected(String(dir), "../victim");
  });

  test("a workspace: path in a member that leaves the root is rejected", async () => {
    using dir = tempDir("bad-workspace-dependency-in-member", {
      ...SIBLING_PROJECTS,
      "clone/package.json": cloneRoot({}),
      "clone/packages/other/package.json": JSON.stringify({
        name: "other",
        dependencies: { anything: "workspace:../../../victim" },
      }),
    });

    await expectRejected(String(dir), "../victim");
  });

  // git stores symlinks, so the clone can ship one. The path is inside the root, and the
  // directory that receives `node_modules` is not. A junction on Windows.
  test("a workspace: path under a symlink that leaves the root is rejected", async () => {
    using dir = tempDir("bad-workspace-dependency-symlink", {
      ...SIBLING_PROJECTS,
      "clone/package.json": cloneRoot({ dependencies: { anything: "workspace:up/victim" } }),
    });
    symlinkSync(String(dir), join(String(dir), "clone", "up"), "junction");

    await expectRejected(String(dir), "up/victim");
  });

  test("an overrides value that leaves the root is rejected", async () => {
    using dir = tempDir("bad-workspace-override-sibling", {
      ...SIBLING_PROJECTS,
      "clone/package.json": cloneRoot({
        dependencies: { anything: "1.0.0" },
        overrides: { anything: "workspace:../victim" },
      }),
    });

    await expectRejected(String(dir), "../victim");
  });

  test("a catalog value that leaves the root is rejected", async () => {
    using dir = tempDir("bad-workspace-catalog-sibling", {
      ...SIBLING_PROJECTS,
      "clone/package.json": cloneRoot({
        catalog: { anything: "workspace:../victim" },
        dependencies: { anything: "catalog:" },
      }),
    });

    await expectRejected(String(dir), "../victim");
  });

  // No package.json names the sibling here. `tools/tool` is a workspace only through the
  // root's `workspace:tools/tool`, and its package.json is not read again when a lockfile
  // exists, so the dependency that `bun.lock` gives it is what the install uses.
  test("a workspace outside the root that only bun.lock names is rejected", async () => {
    using dir = tempDir("bad-workspace-lockfile-sibling", {
      ...SIBLING_PROJECTS,
      "clone/package.json": cloneRoot({ dependencies: { tool: "workspace:tools/tool" } }),
      "clone/tools/tool/package.json": JSON.stringify({ name: "tool" }),
      "clone/bun.lock": JSON.stringify({
        lockfileVersion: 2,
        configVersion: 1,
        workspaces: {
          "": { name: "root", dependencies: { tool: "workspace:tools/tool" } },
          "../victim": { name: "victim", dependencies: { inner: "^1.0.0" } },
          "packages/inner": { name: "inner", version: "1.99.0" },
          "tools/tool": { name: "tool", dependencies: { anything: "workspace:../../../victim" } },
        },
        packages: {
          anything: ["victim@workspace:../victim"],
          inner: ["inner@workspace:packages/inner"],
          tool: ["tool@workspace:tools/tool"],
        },
      }),
    });

    await expectRejected(String(dir), "../victim");
  });

  async function expectInstalled(dir: string, workspacePaths: string[]) {
    const clone = join(dir, "clone");

    const { stderr, exitCode } = await runInstall(clone);

    expect(stderr).not.toContain("error:");
    expect(Object.values(install_test_helpers.parseLockfile(clone).workspace_paths).sort()).toEqual(workspacePaths);
    expect(exitCode).toBe(0);
  }

  test("a workspace: path inside the root is still a workspace", async () => {
    using dir = tempDir("bad-workspace-dependency-inside", {
      ...SIBLING_PROJECTS,
      "clone/package.json": JSON.stringify({ name: "root", dependencies: { anything: "workspace:packages/inner" } }),
    });

    await expectInstalled(String(dir), ["packages/inner"]);
  });

  test("a workspace: path from one member to another is still a workspace", async () => {
    using dir = tempDir("bad-workspace-dependency-between-members", {
      ...SIBLING_PROJECTS,
      "clone/package.json": cloneRoot({}),
      "clone/packages/other/package.json": JSON.stringify({
        name: "other",
        dependencies: { inner: "workspace:../inner" },
      }),
    });

    await expectInstalled(String(dir), ["packages/inner", "packages/other"]);
  });

  test("a workspace: path under a symlink that stays inside the root is still a workspace", async () => {
    using dir = tempDir("bad-workspace-dependency-symlink-inside", {
      ...SIBLING_PROJECTS,
      "clone/package.json": JSON.stringify({ name: "root", dependencies: { anything: "workspace:link/inner" } }),
    });
    symlinkSync(join(String(dir), "clone", "packages"), join(String(dir), "clone", "link"), "junction");

    await expectInstalled(String(dir), ["link/inner"]);
  });
});

describe.concurrent("workspaces entries longer than the path buffer", () => {
  test("path entry fails with ENAMETOOLONG", async () => {
    const entry = Buffer.alloc(LONG_ENTRY_BYTES, "a").toString();
    using dir = tempDir("bad-workspace-long-path", { "package.json": rootPackageJson([entry]) });

    const { stderr, exitCode } = await runInstall(String(dir));

    expect(stderr).toContain(`error: ENAMETOOLONG reading package.json for workspace package "${entry}"`);
    expect(exitCode).toBe(1);
  });

  // A relative path of exactly `bytes` bytes made of one letter directory names, so that a
  // path which fits the buffer is looked up by the OS (ENOENT) instead of exceeding its
  // limit on the length of a single name.
  function pathOfLength(bytes: number) {
    const tail = bytes % 2 === 0 ? "dd" : "d";
    return Buffer.alloc(bytes - tail.length, "d/").toString() + tail;
  }

  // The entry is read from `${dir}/${entry}/package.json`. One byte below the buffer size
  // that path still reaches the OS; from the buffer size on it is rejected before that.
  test.skipIf(isWindows).each([
    ["one byte below", -1, "Workspace not found"],
    ["exactly", 0, "ENAMETOOLONG reading package.json for workspace package"],
    ["one byte above", 1, "ENAMETOOLONG reading package.json for workspace package"],
  ])("path entry whose package.json path is %s the path buffer size", async (_, offset, message) => {
    using dir = tempDir("bad-workspace-path-buffer-edge", {});
    const prefixBytes = Buffer.byteLength(String(dir)) + "/".length;
    const entry = pathOfLength(POSIX_PATH_BUFFER_BYTES + offset - prefixBytes - "/package.json".length);
    writeFileSync(join(String(dir), "package.json"), rootPackageJson([entry]));

    const { stderr, exitCode } = await runInstall(String(dir));

    expect(stderr).toContain(`error: ${message} "${entry}"`);
    expect(exitCode).toBe(1);
  });

  test("glob entry is still matched", async () => {
    // A brace group padded far past the buffer size; its first alternative matches `pkgs`.
    const entry = "{pkgs," + Buffer.alloc(LONG_ENTRY_BYTES, "x,").toString() + "x}/*";
    using dir = tempDir("bad-workspace-long-glob", { "package.json": rootPackageJson([entry]), ...PKG1 });

    await expectOnlyPkg1Found(String(dir));
  });

  test("glob entry matching nothing is skipped like any other glob", async () => {
    const entry = Buffer.alloc(LONG_ENTRY_BYTES, "a").toString() + "/*";
    using dir = tempDir("bad-workspace-long-glob-no-match", {
      "package.json": rootPackageJson(["pkgs/*", entry]),
      ...PKG1,
    });

    await expectOnlyPkg1Found(String(dir));
  });

  // What has to fit the buffer is the normalized path, not the entry as written.
  test.each([
    ["path", "pkgs/pkg1"],
    ["glob", "pkgs/*"],
  ])("%s entry that only fits the path buffer once normalized resolves", async (_, suffix) => {
    const entry = Buffer.alloc(LONG_ENTRY_BYTES, "x/../").toString() + suffix;
    using dir = tempDir("bad-workspace-long-normalized", { "package.json": rootPackageJson([entry]), ...PKG1 });

    await expectOnlyPkg1Found(String(dir));
  });

  // Directory names for a relative path of exactly `bytes` bytes: "deep" followed by names
  // of at most NAME_MAX (255) bytes. The last name is at least 128 bytes long so that its
  // parent directory, used as a cwd below, stays well within PATH_MAX.
  function deepDirectoryNames(bytes: number) {
    const names = ["deep"];
    let remaining = bytes - names[0].length;
    while (remaining > 256) {
      const length = remaining - 256 >= 129 ? 255 : remaining - 130;
      names.push(Buffer.alloc(length, "a").toString());
      remaining -= "/".length + length;
    }
    names.push(Buffer.alloc(remaining - "/".length, "b").toString());
    return names;
  }

  // Globs are walked relative to the project directory, so a match can lie deeper than the
  // buffer holds once the project directory is put in front of it. Windows has no such
  // depth: the buffer there holds more than the longest path the OS accepts.
  test.skipIf(isWindows)(
    "glob match whose absolute package.json path does not fit fails with ENAMETOOLONG",
    async () => {
      using dir = tempDir("bad-workspace-deep-glob-match", { "package.json": rootPackageJson(["deep/**"]) });
      // The directory itself fits PATH_MAX (so it can be created), `<dir>/package.json`
      // does not fit the buffer.
      const absoluteDirBytes = POSIX_PATH_BUFFER_BYTES - 6;
      const names = deepDirectoryNames(absoluteDirBytes - Buffer.byteLength(String(dir)) - "/".length);
      const workspaceDir = join(String(dir), ...names);
      expect(Buffer.byteLength(workspaceDir)).toBe(absoluteDirBytes);
      mkdirSync(workspaceDir, { recursive: true });
      // Too long to be written by its absolute path: write it relative to the parent directory.
      await using writer = spawn({
        cmd: [
          bunExe(),
          "-e",
          `require("fs").writeFileSync(process.argv.at(-1) + "/package.json", JSON.stringify({ name: "deep" }))`,
          names.at(-1)!,
        ],
        cwd: dirname(workspaceDir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await writer.stderr.text()).toBe("");
      expect(await writer.exited).toBe(0);

      const { stderr, exitCode } = await runInstall(String(dir));

      expect(stderr).toContain(`error: ENAMETOOLONG reading package.json for workspace package "${names.join("/")}"`);
      expect(exitCode).toBe(1);
    },
  );
});
