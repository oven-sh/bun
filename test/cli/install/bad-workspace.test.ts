import { spawn, spawnSync } from "bun";
import { install_test_helpers } from "bun:internal-for-testing";
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, chownSync, existsSync, lchownSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from "fs";
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

async function runInstall(cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env,
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

// `bun install` walks up from the directory it runs in twice: once for the project's own
// package.json, and once for a package.json above it whose `workspaces` match the project.
// Whichever it finds becomes the root of the install, and the root manifest decides which
// lifecycle scripts are trusted, where the dependencies come from and which registry
// serves them. A directory that other local users can write to, `/tmp` above a
// `mktemp -d` build directory for example, lets one of them plant such a manifest above a
// project that is not theirs. So bun uses an ancestor manifest only when it is not in a
// shared directory, and the current user owns it, or its owner also owns the directory the
// command ran in.
//
// Most cases need a second uid, so they run as root only.
describe("untrusted ancestor package.json", () => {
  // "nobody" on Linux and macOS.
  const OTHER_UID = 65534;
  const notRoot = isWindows || process.getuid?.() !== 0;

  // A dependency that is a folder with a postinstall script. The script runs only if the
  // root manifest trusts the dependency by name.
  const DEP = {
    "dep/package.json": JSON.stringify({
      name: "dep",
      version: "1.0.0",
      scripts: { postinstall: `echo ran > "$POSTINSTALL_MARKER"` },
    }),
  };

  // A planted root whose `workspaces` match `proj`, above a project of its own.
  const workspaceFiles = {
    "package.json": JSON.stringify({ name: "planted-root", workspaces: ["proj"], trustedDependencies: ["dep"] }),
    "proj/package.json": JSON.stringify({ name: "proj", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
    "proj/dep/package.json": DEP["dep/package.json"],
  };

  // A planted project with no `workspaces` field at all, above a directory that has no
  // package.json of its own. The walk goes on up past a manifest it ignores, so an empty
  // project this user owns sits above the planted one and catches it inside the fixture.
  const noWorkspacesFiles = {
    "package.json": JSON.stringify({ name: "fence", version: "0.0.0" }),
    "planted/package.json": JSON.stringify({
      name: "planted-project",
      version: "1.0.0",
      dependencies: { dep: "file:./dep" },
      trustedDependencies: ["dep"],
    }),
    "planted/dep/package.json": DEP["dep/package.json"],
    "planted/sub/.keep": "",
  };

  function marker(root: string) {
    return join(root, "postinstall-ran");
  }

  function installIn(root: string, subdirectory: string) {
    return runInstall(join(root, subdirectory), { ...bunEnv, POSTINSTALL_MARKER: marker(root) });
  }

  function chownToOtherUser(path: string) {
    chownSync(path, OTHER_UID, OTHER_UID);
  }

  // Installs in `planted/sub` and asserts that the walk passed over `planted/package.json`
  // and installed the empty project above it instead: no error, and nothing in `planted`.
  async function expectPlantedProjectIgnored(root: string) {
    const { stdout, stderr, exitCode } = await installIn(root, "planted/sub");

    expect(stderr).toContain(`another user owns ${join(root, "planted")}/package.json`);
    expect(stderr).not.toContain("error");
    expect(stdout).not.toContain("+ dep");
    expect(existsSync(marker(root))).toBe(false);
    expect(existsSync(join(root, "planted", "bun.lock"))).toBe(false);
    expect(existsSync(join(root, "planted", "node_modules"))).toBe(false);
    expect(exitCode).toBe(0);
  }

  test.skipIf(notRoot)("is not the workspace root, and its trustedDependencies do not run a script", async () => {
    using dir = tempDir("bad-workspace-root-other-user", workspaceFiles);
    const root = String(dir);
    chownToOtherUser(join(root, "package.json"));

    const { stdout, stderr, exitCode } = await installIn(root, "proj");

    expect(stderr).toContain(`another user owns ${root}/package.json`);
    expect(stdout).toContain("Blocked 1 postinstall");
    expect(existsSync(marker(root))).toBe(false);
    // The project is installed on its own, so nothing is written to the planted root.
    expect(existsSync(join(root, "proj", "bun.lock"))).toBe(true);
    expect(existsSync(join(root, "bun.lock"))).toBe(false);
    expect(existsSync(join(root, "node_modules"))).toBe(false);
    expect(exitCode).toBe(0);
  });

  // The same kind of manifest without a `workspaces` field, found by the walk for the
  // project's own package.json.
  test.skipIf(notRoot)("is not the project either, when the directory has no package.json", async () => {
    using dir = tempDir("bad-workspace-project-other-user", noWorkspacesFiles);
    const root = String(dir);
    chownToOtherUser(join(root, "planted", "package.json"));

    await expectPlantedProjectIgnored(root);
  });

  // `fstat` on the descriptor the walk holds reports the owner of a symlink's target, so
  // the entry that names the file is checked too. Here it is a link the other user owns to
  // a manifest this one owns.
  test.skipIf(notRoot)("is not the project when a link another user owns names it", async () => {
    using dir = tempDir("bad-workspace-project-other-user-link", noWorkspacesFiles);
    const root = String(dir);
    renameSync(join(root, "planted", "package.json"), join(root, "planted", "real.json"));
    symlinkSync("real.json", join(root, "planted", "package.json"));
    lchownSync(join(root, "planted", "package.json"), OTHER_UID, OTHER_UID);

    await expectPlantedProjectIgnored(root);
  });

  // Owning the manifest is not enough in a directory with the mode `/tmp` has: another
  // user may add a name there, including a hard link to a file this user owns. No second
  // uid is needed for these, so they run on every platform.
  test.skipIf(isWindows).each([
    ["every user", 0o1777],
    ["the group", 0o1770],
  ])("in a sticky directory %s may write to is not the workspace root", async (_, mode) => {
    using dir = tempDir("bad-workspace-root-shared-dir", workspaceFiles);
    const root = String(dir);
    chmodSync(root, mode);

    const { stdout, stderr, exitCode } = await installIn(root, "proj");

    expect(stderr).toContain(`other local users can add files to ${root}`);
    expect(stdout).toContain("Blocked 1 postinstall");
    expect(existsSync(marker(root))).toBe(false);
    expect(existsSync(join(root, "proj", "bun.lock"))).toBe(true);
    expect(existsSync(join(root, "bun.lock"))).toBe(false);
    expect(exitCode).toBe(0);
  });

  // An untrusted manifest is refused before it is read, so one that cannot be parsed is
  // ignored like any other instead of failing the install.
  test.skipIf(isWindows)("is not read at all, so invalid JSON in it installs the project", async () => {
    using dir = tempDir("bad-workspace-root-shared-dir-invalid", {
      ...workspaceFiles,
      "package.json": "{{{",
    });
    const root = String(dir);
    chmodSync(root, 0o1777);

    const { stderr, exitCode } = await installIn(root, "proj");

    expect(stderr).toContain(`other local users can add files to ${root}`);
    expect(stderr).not.toContain("ParserError");
    expect(stderr).not.toContain("Expected string");
    expect(existsSync(join(root, "proj", "bun.lock"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test.skipIf(notRoot)("is adopted when the current user owns it", async () => {
    using dir = tempDir("bad-workspace-root-same-user", workspaceFiles);
    const root = String(dir);

    const { stdout, stderr, exitCode } = await installIn(root, "proj");

    expect(stderr).not.toContain("another user owns");
    expect(stdout).not.toContain("Blocked");
    expect(existsSync(marker(root))).toBe(true);
    expect(existsSync(join(root, "bun.lock"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  // `sudo bun install`, and container images where one other user owns the whole checkout:
  // that user owns the root manifest and the directory the command ran in.
  test.skipIf(notRoot)("is adopted when its owner also owns the directory the command ran in", async () => {
    using dir = tempDir("bad-workspace-root-one-other-user", workspaceFiles);
    const root = String(dir);
    for (const path of ["package.json", "proj", "proj/package.json", "proj/dep", "proj/dep/package.json"]) {
      chownToOtherUser(join(root, path));
    }

    const { stdout, stderr, exitCode } = await installIn(root, "proj");

    expect(stderr).not.toContain("another user owns");
    expect(stdout).not.toContain("Blocked");
    expect(existsSync(marker(root))).toBe(true);
    expect(existsSync(join(root, "bun.lock"))).toBe(true);
    expect(exitCode).toBe(0);
  });
});
