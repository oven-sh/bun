import { spawn, spawnSync } from "bun";
import { install_test_helpers } from "bun:internal-for-testing";
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isRoot, isWindows, tempDir, tmpdirSync, unprivilegedSpawnOptions } from "harness";
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
// platform (Windows used to print the bare variant name, "NOENT") and the directory. No
// other error line follows it.
test.concurrent("glob entry under a missing directory reports the errno name and the directory", async () => {
  using dir = tempDir("bad-workspace-glob-missing-root", {});
  const entry = `${String(dir).replaceAll("\\", "/")}/missing/*`;
  writeFileSync(join(String(dir), "package.json"), rootPackageJson([entry]));

  const { stderr, exitCode } = await runInstall(String(dir));

  expect(errorLines(stderr)).toEqual([
    `error: Failed to run workspace pattern ${entry} due to error ENOENT (open "${join(String(dir), "missing")}")`,
  ]);
  expect(exitCode).toBe(1);
});

// npm, pnpm and yarn 1 fail here too. Root ignores the mode bits, and chmod on Windows
// cannot make a directory unreadable or unsearchable.
test.concurrent.skipIf(isWindows || isRoot).each([
  ["unreadable", 0o000, "open", "secret"],
  ["unsearchable", 0o444, "fstatat", join("secret", "package.json")],
])("glob entry that reaches an %s directory names what it failed on", async (_, mode, syscall, failedOn) => {
  using dir = tempDir("bad-workspace-glob-eacces", {
    "package.json": rootPackageJson(["pkgs/*"]),
    ...PKG1,
    "pkgs/secret/package.json": JSON.stringify({ name: "secret" }),
  });
  const secret = join(String(dir), "pkgs", "secret");
  chmodSync(secret, mode);
  try {
    const { stderr, exitCode } = await runInstall(String(dir));

    expect(errorLines(stderr)).toEqual([
      `error: Failed to run workspace pattern pkgs/* due to error EACCES (${syscall} "${join(String(dir), "pkgs", failedOn)}")`,
    ]);
    expect(exitCode).toBe(1);
  } finally {
    chmodSync(secret, 0o755);
  }
});

// `bun add` walks the glob again when it writes package.json back. The registry removes the
// directory between the two walks.
test.concurrent("glob entry that fails when bun add writes package.json back is reported", async () => {
  using dir = tempDir("bad-workspace-glob-write-back", { "extra/.keep": "" });
  const extra = join(String(dir), "extra");
  const entry = `${String(dir).replaceAll("\\", "/")}/extra/*`;
  let tarballRequested = false;
  await using registry = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.url.endsWith(".tgz")) {
        tarballRequested = true;
        return new Response(Bun.file(join(import.meta.dir, "baz-0.0.3.tgz")));
      }
      rmSync(extra, { recursive: true, force: true });
      return Response.json({
        name: "baz",
        versions: { "0.0.3": { name: "baz", version: "0.0.3", dist: { tarball: `${registry.url}baz-0.0.3.tgz` } } },
        "dist-tags": { latest: "0.0.3" },
      });
    },
  });
  writeFileSync(join(String(dir), "package.json"), rootPackageJson([entry]));
  writeFileSync(join(String(dir), "bunfig.toml"), `[install]\ncache = false\nregistry = "${registry.url}"\n`);

  await using proc = spawn({
    cmd: [bunExe(), "add", "baz"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // bun asked for the tarball, so the first walk passed.
  expect(tarballRequested).toBe(true);
  expect(errorLines(stderr)).toEqual([
    `error: Failed to run workspace pattern ${entry} due to error ENOENT (open "${extra}")`,
  ]);
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

// https://github.com/oven-sh/bun/issues/36386
// Wyhash11 of these two names agrees in the low 32 bits.
const collidingA = "@demo/app-03511";
const collidingB = "@demo/app-13215";

async function installWorkspaceNames(names: string[]) {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "r", private: true, workspaces: ["packages/*"] }),
  };
  names.forEach((name, i) => {
    files[`packages/p${i}/package.json`] = JSON.stringify({ name, version: "0.0.0" });
  });
  using dir = tempDir("workspace-name-hash-collision", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stderr, exitCode };
}

test.concurrent("distinct workspace names with colliding truncated name hashes are not duplicates", async () => {
  const { stderr, exitCode } = await installWorkspaceNames([collidingA, collidingB]);
  expect(stderr).not.toContain("already exists");
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  [collidingA, collidingB],
  [collidingB, collidingA],
])("a true duplicate of %s is still reported when %s shares its truncated hash", async (duplicated, other) => {
  const { stderr, exitCode } = await installWorkspaceNames([collidingA, collidingB, duplicated]);
  expect(stderr).toContain(`Workspace name "${duplicated}" already exists`);
  expect(stderr).not.toContain(`Workspace name "${other}" already exists`);
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

async function runInstall(cwd: string) {
  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function errorLines(stderr: string) {
  return stderr.split(/\r?\n/).filter(line => line.startsWith("error:"));
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

async function runBun(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = bunEnv,
  user: { uid?: number; gid?: number } = {},
) {
  await using proc = spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe", ...user });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// A `workspace:` spec with no path used to resolve to the declaring package and link it under
// the dependency's name.
describe.concurrent("workspace: spec that names no workspace", () => {
  test("empty spec in the root fails to resolve", async () => {
    using dir = tempDir("bad-workspace-empty-spec", {
      "package.json": JSON.stringify({ name: "p", version: "1.0.0", dependencies: { a: "workspace:" } }),
      "index.js": `module.exports = "root";`,
    });

    const { stderr, exitCode } = await runInstall(String(dir));

    expect(stderr).toContain("error: a@workspace: failed to resolve");
    expect(existsSync(join(String(dir), "node_modules", "a"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  test("empty spec in a workspace member fails to resolve", async () => {
    using dir = tempDir("bad-workspace-member-empty-spec", {
      "package.json": JSON.stringify({ name: "p", version: "1.0.0", workspaces: ["packages/*"] }),
      "packages/foo/package.json": JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: { bar: "workspace:" },
      }),
    });

    const { stderr, exitCode } = await runInstall(String(dir));

    expect(stderr).toContain("error: bar@workspace: failed to resolve");
    expect(existsSync(join(String(dir), "node_modules", "bar"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  // `workspace:.` is a path. In the root it names the root package, like it names the member
  // in a member (see "workspace self dependencies create symlinks" in isolated-install.test.ts).
  test("workspace:. in the root links the root package under the dependency's name", async () => {
    using dir = tempDir("bad-workspace-root-self-spec", {
      "package.json": JSON.stringify({ name: "p", version: "1.0.0", dependencies: { a: "workspace:." } }),
      "index.js": `module.exports = "root";`,
    });

    for (let i = 0; i < 2; i++) {
      const { stderr, exitCode } = await runInstall(String(dir));
      expect(stderr).not.toContain("error:");
      expect(JSON.parse(readFileSync(join(String(dir), "node_modules", "a", "package.json"), "utf8")).name).toBe("p");
      expect(exitCode).toBe(0);
    }
  });

  test("workspace: links the workspace with the dependency's name", async () => {
    using dir = tempDir("bad-workspace-empty-spec-found", {
      "package.json": JSON.stringify({
        name: "p",
        version: "1.0.0",
        workspaces: ["packages/*"],
        dependencies: { a: "workspace:" },
      }),
      "packages/a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
    });

    const { stderr, exitCode } = await runInstall(String(dir));

    expect(stderr).not.toContain("error:");
    expect(readFileSync(join(String(dir), "node_modules", "a", "package.json"), "utf8")).toContain('"name":"a"');
    expect(exitCode).toBe(0);
  });
});

// A pattern that leaves the root can name the root again. The root is not its own member.
test.concurrent.each([
  ["glob", ["../*"]],
  ["path", ["../root", "../proj-a"]],
])("a workspaces %s that also names the root does not add the root as a member", async (_, workspaces) => {
  using dir = tempDir("bad-workspace-names-root", {
    "root/package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces }),
    "proj-a/package.json": JSON.stringify({ name: "proj-a", version: "1.0.0" }),
  });
  const root = join(String(dir), "root");

  const { stderr, exitCode } = await runInstall(root);

  expect(stderr).not.toContain("error:");
  expect(install_test_helpers.parseLockfile(root).packages.map(pkg => pkg.name)).toEqual(["root", "proj-a"]);
  expect(exitCode).toBe(0);
});

// To learn whether the cwd is a member, bun reads the members of the package.json above it.
describe.concurrent.each([
  ["glob", ["packages/*"]],
  ["paths", ["packages/pkg1", "packages/pkg2", "packages/pkg3"]],
])("in a member next to one whose package.json does not parse (%s)", (_, workspaces) => {
  async function installThenBreakSibling() {
    const dir = tempDir("bad-workspace-broken-sibling", {
      "package.json": rootPackageJson(workspaces),
      "packages/pkg1/package.json": JSON.stringify({ name: "pkg1", version: "1.0.0" }),
      "packages/pkg2/package.json": JSON.stringify({ name: "pkg2", version: "1.0.0" }),
      "packages/pkg3/package.json": JSON.stringify({
        name: "pkg3",
        version: "1.0.0",
        dependencies: { pkg1: "workspace:*" },
      }),
    });
    expect((await runInstall(String(dir))).exitCode).toBe(0);
    return {
      member: join(String(dir), "packages", "pkg3"),
      breakSibling: () =>
        writeFileSync(join(String(dir), "packages", "pkg2", "package.json"), '{ "name": "pkg2", oops'),
      [Symbol.dispose]: () => dir[Symbol.dispose](),
    };
  }

  test.each(["outdated", "pm ls", "why pkg1"])("bun %s still finds the workspace root", async command => {
    using project = await installThenBreakSibling();
    const before = await runBun(command.split(" "), project.member);
    expect(before.exitCode).toBe(0);
    project.breakSibling();

    expect(await runBun(command.split(" "), project.member)).toEqual(before);
  });

  test("bun install reports that package.json, and doesn't install the workspace as a separate project", async () => {
    using project = await installThenBreakSibling();
    project.breakSibling();

    const { stderr, exitCode } = await runInstall(project.member);

    expect(stderr.replaceAll("\\", "/")).toContain(
      'error: ParserError reading package.json for workspace package "packages/pkg2"',
    );
    expect(stderr).not.toContain('Workspace dependency "pkg1" not found');
    expect(existsSync(join(project.member, "bun.lock"))).toBe(false);
    expect(exitCode).toBe(1);
  });
});

// A package manager command that's run in a workspace uses the workspace root. If the folder ran
// as its own project instead, it would read its own .npmrc and bunfig.toml and get its own
// bun.lock. So when a package.json above the folder might list it as a workspace but can't tell,
// the command stops.
describe("a package.json above the folder can't tell whether the folder is its workspace", () => {
  // On its own, `bun install` in this folder exits 0 and writes a bun.lock.
  const MEMBER = JSON.stringify({ name: "pkg1", version: "1.0.0", dependencies: { local: "file:./vendor/local" } });
  const LOCAL = JSON.stringify({ name: "local", version: "1.0.0" });
  // `bun install` in the root refuses a `workspaces` that is a string.
  const INVALID_ROOT = `{ "name": "root", "workspaces": "packages/*" }`;
  const TYPE_ERROR = `error: "workspaces" expects an array of strings, e.g.`;

  function workspace(root: string = rootPackageJson(["packages/*"]), files: Record<string, string> = {}) {
    const dir = tempDir("workspace-root-not-asked", {
      "package.json": root,
      "packages/pkg1/package.json": MEMBER,
      "packages/pkg1/vendor/local/package.json": LOCAL,
      "packages/pkg2/package.json": JSON.stringify({ name: "pkg2", version: "1.0.0" }),
      ...files,
    });
    return {
      root: String(dir),
      packageJson: join(String(dir), "package.json"),
      member: join(String(dir), "packages", "pkg1"),
      [Symbol.dispose]: () => dir[Symbol.dispose](),
    };
  }
  type Workspace = ReturnType<typeof workspace>;
  type User = { uid?: number; gid?: number };

  // bun joins package.json to a directory with "/" on every platform.
  const slashes = (text: string) => text.replaceAll("\\", "/");
  const cannotTell = (folder: string, root: string) => `note: cannot tell if "${folder}" is a workspace of "${root}"\n`;
  const binOf = (dir: string) => join(dir, "node_modules", ".bin") + "\n";
  const lockfileOf = (dir: string) =>
    existsSync(join(dir, "bun.lock")) ? readFileSync(join(dir, "bun.lock"), "utf8") : null;

  // `bun pm bin` prints where the project is. On its own, `bun install` would write a bun.lock.
  async function expectStopped(project: Workspace, stderr: string, user: User = {}, folder = project.member) {
    const lockfile = lockfileOf(folder);
    for (const args of [["pm", "bin"], ["install"]]) {
      const result = await runBun(args, folder, bunEnv, user);
      expect({ ...result, stderr: slashes(result.stderr), lockfile: lockfileOf(folder) }).toEqual({
        stdout: "",
        stderr: slashes(stderr),
        exitCode: 1,
        lockfile,
      });
    }
  }

  async function expectRootFound(project: Workspace, user: User = {}) {
    expect(await runBun(["pm", "bin"], project.member, bunEnv, user)).toEqual({
      stdout: binOf(project.root),
      stderr: "",
      exitCode: 0,
    });
  }

  async function expectOwnProject(folder: string, user: User = {}) {
    expect(await runBun(["pm", "bin"], folder, bunEnv, user)).toEqual({
      stdout: binOf(folder),
      stderr: "",
      exitCode: 0,
    });
  }

  describe.concurrent("the package.json above the folder", () => {
    // `bun install` in the root refuses this file too. A writer that truncates the file before it
    // writes leaves it empty for a moment.
    test("is empty next to a lockfile", async () => {
      using project = workspace();
      expect((await runInstall(project.root)).exitCode).toBe(0);
      writeFileSync(project.packageJson, "");

      await expectStopped(
        project,
        `error: failed to parse '${project.packageJson}': file is empty\n` + cannotTell(project.member, project.root),
      );
    });

    // Every lockfile that `bun install` reads or migrates counts.
    test.each(["bun.lockb", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"])(
      "is empty next to a %s",
      async lockfile => {
        using project = workspace("", { [lockfile]: "" });

        const result = await runBun(["pm", "bin"], project.member);
        expect({ ...result, stderr: slashes(result.stderr) }).toEqual({
          stdout: "",
          stderr: slashes(
            `error: failed to parse '${project.packageJson}': file is empty\n` +
              cannotTell(project.member, project.root),
          ),
          exitCode: 1,
        });
      },
    );

    test("is a directory", async () => {
      using project = workspace();
      rmSync(project.packageJson);
      mkdirSync(project.packageJson);

      await expectStopped(
        project,
        `EISDIR: cannot read "${project.packageJson}"\n` + cannotTell(project.member, project.root),
      );
    });

    test("does not parse", async () => {
      using project = workspace(`{ "name": "root", oops`);

      await expectStopped(
        project,
        `1 | { "name": "root", oops\n` +
          `                      ^\n` +
          `error: Expected string but found "oops"\n` +
          `    at ${project.packageJson}:1:19\n` +
          cannotTell(project.member, project.root),
      );
    });

    test.each([
      ["a string", `"packages/*"`, TYPE_ERROR],
      [
        "an object whose packages is a string",
        `{ "packages": "packages/*" }`,
        `error: "workspaces.packages" expects an array of strings, e.g.`,
      ],
      [
        "an array with a number after the pattern",
        `["packages/*", 1]`,
        "error: Workspaces expects an array of strings, like:",
      ],
      // The listing already has pkg2 when it stops at the number, and it never got to pkg1.
      [
        "an array with a number after the path of another folder",
        `["packages/pkg2", 1]`,
        "error: Workspaces expects an array of strings, like:",
      ],
    ])("has a workspaces field that is %s", async (_, workspaces, error) => {
      using project = workspace(`{ "name": "root", "workspaces": ${workspaces} }`);

      for (const args of [["pm", "bin"], ["install"]]) {
        const { stdout, stderr, exitCode } = await runBun(args, project.member);
        expect({ stdout, errors: errorLines(stderr), exitCode, lockfile: lockfileOf(project.member) }).toEqual({
          stdout: "",
          errors: [error],
          exitCode: 1,
          lockfile: null,
        });
        expect(slashes(stderr)).toContain(slashes(`\n    at ${project.packageJson}:1:`));
        expect(slashes(stderr)).toEndWith(slashes(cannotTell(project.member, project.root)));
      }
    });

    // Run in the folder as its own project, each of these would change it or contact a registry.
    test.each(["add no-deps", "remove local", "update", "publish --dry-run", "ci"])(
      "has an invalid workspaces field, and bun %s changes nothing",
      async command => {
        const seen: string[] = [];
        await using registry = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch(req) {
            seen.push(`${req.method} ${new URL(req.url).pathname}`);
            return new Response("{}", { status: 404 });
          },
        });
        using project = workspace(INVALID_ROOT);

        const env = { ...bunEnv, BUN_CONFIG_REGISTRY: registry.url.href };
        const result = await runBun(command.split(" "), project.member, env);

        expect({
          errors: errorLines(result.stderr),
          exitCode: result.exitCode,
          seen,
          packageJson: readFileSync(join(project.member, "package.json"), "utf8"),
          lockfile: lockfileOf(project.member),
        }).toEqual({ errors: [TYPE_ERROR], exitCode: 1, seen: [], packageJson: MEMBER, lockfile: null });
        expect(slashes(result.stderr)).toEndWith(slashes(cannotTell(project.member, project.root)));
      },
    );

    // A workspace takes its settings from the root. On its own, the folder would use the user's.
    test("has an invalid workspaces field, and no registry is contacted", async () => {
      const seen: string[] = [];
      const serve = (name: string) =>
        Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch(req) {
            const path = decodeURIComponent(new URL(req.url).pathname);
            seen.push(`${name} registry, ${req.headers.get("authorization")}: ${path}`);
            return new Response("{}", { status: 404 });
          },
        });
      await using ofRoot = serve("the root's");
      await using ofUser = serve("the user's");
      using project = workspace(undefined, {
        ".npmrc": `@corp:registry=${ofRoot.url.href}\n//${ofRoot.url.host}/:_authToken=root-token\n`,
        "packages/pkg1/package.json": JSON.stringify({ name: "pkg1", dependencies: { "@corp/thing": "1.0.0" } }),
      });
      using home = tempDir("workspace-root-not-asked-home", {});
      const env = {
        ...bunEnv,
        // bunEnv spreads process.env, and CI runners export some of these.
        XDG_CONFIG_HOME: undefined,
        NPM_CONFIG_USERCONFIG: undefined,
        npm_config_userconfig: undefined,
        NPM_CONFIG_REGISTRY: undefined,
        npm_config_registry: undefined,
        HOME: String(home),
        USERPROFILE: String(home),
        BUN_INSTALL_CACHE_DIR: join(String(home), "cache"),
        BUN_CONFIG_REGISTRY: ofUser.url.href,
      };

      await runBun(["install"], project.member, env);
      expect(seen).toEqual(["the root's registry, Bearer root-token: /@corp/thing"]);

      seen.length = 0;
      writeFileSync(project.packageJson, INVALID_ROOT);
      const { exitCode } = await runBun(["install"], project.member, env);
      expect({ seen, exitCode }).toEqual({ seen: [], exitCode: 1 });
    });

    // Run on its own, the folder would write this file, so it says nothing about the root.
    test("has an invalid workspaces field, and the folder has its own bun.lock", async () => {
      using project = workspace(INVALID_ROOT, { "packages/pkg1/bun.lock": "{}" });

      for (const args of [["pm", "bin"], ["install"]]) {
        const { stdout, stderr, exitCode } = await runBun(args, project.member);
        expect({ stdout, errors: errorLines(stderr), exitCode, lockfile: lockfileOf(project.member) }).toEqual({
          stdout: "",
          errors: [TYPE_ERROR],
          exitCode: 1,
          lockfile: "{}",
        });
      }
    });

    test("lists the folder by path before an entry that isn't a string: the root is found", async () => {
      using project = workspace(`{ "name": "root", "workspaces": ["packages/pkg1", 1] }`);

      await expectRootFound(project);
    });

    // A package.json above the empty one lists the folder, and that settles it.
    test.each([
      ["with no lockfile next to it", {}],
      ["next to a lockfile", { "packages/bun.lock": "" }],
    ])("is empty %s, between the folder and a root that lists it: the root is found", async (_, lockfile) => {
      using project = workspace(undefined, { "packages/package.json": "", ...lockfile });

      await expectRootFound(project);
    });

    test("is empty next to a lockfile, and the package.json above that one doesn't list the folder", async () => {
      using project = workspace(rootPackageJson(["apps/*"]), { "packages/package.json": "", "packages/bun.lock": "" });
      const between = join(project.root, "packages");

      await expectStopped(
        project,
        `error: failed to parse '${join(between, "package.json")}': file is empty\n` +
          cannotTell(project.member, between),
      );
    });

    // A folder without a `name` is never a workspace, so the file above it doesn't matter.
    test("has an invalid workspaces field, and the folder has no name: it's its own project", async () => {
      using project = workspace(INVALID_ROOT, { "packages/pkg1/package.json": JSON.stringify({ version: "1.0.0" }) });

      await expectOwnProject(project.member);
    });

    // A package.json that doesn't parse stops every folder below it, and so does a directory with
    // that name. The note would be wrong for a folder without a `name`.
    test.each([
      [
        "does not parse",
        `{ "name": "root", oops`,
        (packageJson: string) =>
          `1 | { "name": "root", oops\n` +
          `                      ^\n` +
          `error: Expected string but found "oops"\n` +
          `    at ${packageJson}:1:19\n`,
      ],
      ["is a directory", null, (packageJson: string) => `EISDIR: cannot read "${packageJson}"\n`],
    ] as [string, string | null, (packageJson: string) => string][])(
      "%s, and the folder has no name: the command stops without the note",
      async (_, root, stderr) => {
        using project = workspace(root ?? "", {
          "packages/pkg1/package.json": JSON.stringify({ version: "1.0.0" }),
        });
        if (root === null) {
          rmSync(project.packageJson);
          mkdirSync(project.packageJson);
        }

        const result = await runBun(["pm", "bin"], project.member);
        expect({ ...result, stderr: slashes(result.stderr) }).toEqual({
          stdout: "",
          stderr: slashes(stderr(project.packageJson)),
          exitCode: 1,
        });
      },
    );

    test("has an invalid workspaces field, and the folder's own package.json is empty", async () => {
      using project = workspace(INVALID_ROOT, { "packages/pkg1/package.json": "" });

      const { stdout, stderr, exitCode } = await runBun(["pm", "bin"], project.member);
      expect({ stdout, errors: errorLines(stderr), exitCode }).toEqual({
        stdout: "",
        errors: [TYPE_ERROR],
        exitCode: 1,
      });
    });

    // The listing got to every folder but couldn't read this one, so it may be a workspace.
    test("lists the folder, and the folder's own package.json does not parse", async () => {
      using project = workspace(undefined, { "packages/pkg1/package.json": `{ "name": "pkg1", oops` });

      const { stdout, stderr, exitCode } = await runBun(["pm", "bin"], project.member);
      expect({ stdout, errors: errorLines(slashes(stderr)), exitCode }).toEqual({
        stdout: "",
        errors: [
          `error: Expected string but found "oops"`,
          `error: ParserError reading package.json for workspace package "packages/pkg1" from "package.json"`,
        ],
        exitCode: 1,
      });
      expect(slashes(stderr)).toEndWith(slashes(cannotTell(project.member, project.root)));
    });

    // These two register the folder for `bun link <name>` and remove it again. They need no project.
    test("has an invalid workspaces field, and a bare bun link and bun unlink still work", async () => {
      using project = workspace(INVALID_ROOT);
      using home = tempDir("workspace-root-not-asked-home", {});
      const env = { ...bunEnv, BUN_INSTALL: join(String(home), ".bun"), BUN_INSTALL_GLOBAL_DIR: undefined };
      const link = join(String(home), ".bun", "install", "global", "node_modules", "pkg1");

      const linked = await runBun(["link"], project.member, env);
      expect({ errors: errorLines(linked.stderr), exitCode: linked.exitCode, link: existsSync(link) }).toEqual({
        errors: [],
        exitCode: 0,
        link: true,
      });
      const unlinked = await runBun(["unlink"], project.member, env);
      expect({ errors: errorLines(unlinked.stderr), exitCode: unlinked.exitCode, link: existsSync(link) }).toEqual({
        errors: [],
        exitCode: 0,
        link: false,
      });
    });
  });

  // The rule applies to every folder below such a file, so a folder that no pattern matches stops too.
  describe("a folder that no workspaces pattern matches", () => {
    const TOOL = {
      "tools/x/package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
      "tools/x/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    };
    async function install(project: Workspace, ownLockfile: boolean) {
      const folder = join(project.root, "tools", "x");
      expect((await runInstall(project.root)).exitCode).toBe(0);
      if (ownLockfile) expect((await runInstall(folder)).exitCode).toBe(0);
      expect(lockfileOf(folder) !== null).toBe(ownLockfile);
      return folder;
    }
    const lockfiles: [string, boolean][] = [
      ["without its own lockfile", false],
      ["with its own bun.lock", true],
    ];

    describe.concurrent.each(lockfiles)("%s", (_, ownLockfile) => {
      test("stops below an empty package.json next to a lockfile", async () => {
        using project = workspace(undefined, TOOL);
        const folder = await install(project, ownLockfile);
        writeFileSync(project.packageJson, "");

        await expectStopped(
          project,
          `error: failed to parse '${project.packageJson}': file is empty\n` + cannotTell(folder, project.root),
          {},
          folder,
        );
      });

      test("stops below a package.json whose workspaces field is a string", async () => {
        using project = workspace(undefined, TOOL);
        const folder = await install(project, ownLockfile);
        writeFileSync(project.packageJson, INVALID_ROOT);

        const { stdout, stderr, exitCode } = await runBun(["pm", "bin"], folder);
        expect({ stdout, errors: errorLines(stderr), exitCode }).toEqual({
          stdout: "",
          errors: [TYPE_ERROR],
          exitCode: 1,
        });
        expect(slashes(stderr)).toEndWith(slashes(cannotTell(folder, project.root)));
      });
    });

    describe.skipIf(isWindows).each(lockfiles)("%s", (_, ownLockfile) => {
      test.serial("stops below a package.json that lists a folder that can't be opened first", async () => {
        using project = workspace(undefined, TOOL);
        const folder = await install(project, ownLockfile);
        writeFileSync(project.packageJson, rootPackageJson(["locked/*", "packages/*"]));
        const locked = join(project.root, "locked");
        mkdirSync(locked, { mode: 0o000 });
        try {
          using user = unprivilegedSpawnOptions(project.root);
          const result = await runBun(["pm", "bin"], folder, bunEnv, user);

          expect({ ...result, stderr: errorLines(result.stderr) }).toEqual({
            stdout: "",
            stderr: [`error: Failed to run workspace pattern locked/* due to error EACCES (open "${locked}")`],
            exitCode: 1,
          });
          expect(result.stderr).toEndWith(cannotTell(folder, project.root));
        } finally {
          chmodSync(locked, 0o755);
        }
      });
    });

    // The first package.json with `workspaces` settles it for a workspace. Nothing above it is read.
    test("stops if it has its own workspaces, but a workspace of that folder doesn't", async () => {
      using project = workspace(INVALID_ROOT, {
        "tools/x/package.json": JSON.stringify({ name: "x", workspaces: ["packages/*"] }),
        "tools/x/packages/y/package.json": JSON.stringify({ name: "y", version: "1.0.0" }),
      });
      const folder = join(project.root, "tools", "x");

      const { stdout, stderr, exitCode } = await runBun(["pm", "bin"], folder);
      expect({ stdout, errors: errorLines(stderr), exitCode }).toEqual({
        stdout: "",
        errors: [TYPE_ERROR],
        exitCode: 1,
      });
      expect(await runBun(["pm", "bin"], join(folder, "packages", "y"))).toEqual({
        stdout: binOf(folder),
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // A workspace can be a symlink to another folder. `$PWD` then leads to the root, and the real
  // path of the folder doesn't.
  describe.concurrent.skipIf(isWindows)("run in a folder that a symlink leads to", () => {
    function linked(aboveRealPath: string, workspaces: string[]) {
      const dir = tempDir("workspace-root-not-asked-link", {
        "package.json": rootPackageJson(workspaces),
        "packages/pkg2/package.json": JSON.stringify({ name: "pkg2", version: "1.0.0" }),
        "elsewhere/package.json": aboveRealPath,
        "elsewhere/pkg1/package.json": MEMBER,
        "elsewhere/pkg1/vendor/local/package.json": LOCAL,
      });
      const typed = join(String(dir), "packages", "pkg1");
      symlinkSync(join("..", "elsewhere", "pkg1"), typed);
      return {
        root: String(dir),
        typed,
        above: join(String(dir), "elsewhere"),
        member: join(String(dir), "elsewhere", "pkg1"),
        run: (...args: string[]) => runBun(args, typed, { ...bunEnv, PWD: typed }),
        [Symbol.dispose]: () => dir[Symbol.dispose](),
      };
    }
    const invalid = `{ "name": "elsewhere", "workspaces": "pkg1" }`;

    test("the root above $PWD lists the folder: the file above the real path doesn't matter", async () => {
      using project = linked(invalid, ["packages/*"]);

      expect(await project.run("pm", "bin")).toEqual({ stdout: binOf(project.root), stderr: "", exitCode: 0 });
      expect((await project.run("install")).exitCode).toBe(0);
      expect(
        ["", "elsewhere", "elsewhere/pkg1"].filter(dir => existsSync(join(project.root, dir, "bun.lock"))),
      ).toEqual([""]);
    });

    test("nothing above $PWD lists the folder: the file above the real path is reported", async () => {
      using project = linked(invalid, ["apps/*"]);

      const { stdout, stderr, exitCode } = await project.run("pm", "bin");
      expect({ stdout, errors: errorLines(stderr), exitCode }).toEqual({
        stdout: "",
        errors: [TYPE_ERROR],
        exitCode: 1,
      });
      expect(stderr).toContain(`\n    at ${join(project.above, "package.json")}:1:`);
      expect(stderr).toEndWith(cannotTell(project.member, project.above));
    });

    test("the file above $PWD can't tell, and nothing above the real path lists the folder", async () => {
      using dir = tempDir("workspace-root-not-asked-link", {
        "repo/package.json": invalid,
        "repo/packages/pkg2/package.json": JSON.stringify({ name: "pkg2", version: "1.0.0" }),
        "elsewhere/pkg1/package.json": MEMBER,
      });
      const repo = join(String(dir), "repo");
      const typed = join(repo, "packages", "pkg1");
      symlinkSync(join(String(dir), "elsewhere", "pkg1"), typed);

      const { stdout, stderr, exitCode } = await runBun(["pm", "bin"], typed, { ...bunEnv, PWD: typed });
      expect({ stdout, errors: errorLines(stderr), exitCode }).toEqual({
        stdout: "",
        errors: [TYPE_ERROR],
        exitCode: 1,
      });
      expect(stderr).toContain(`\n    at ${join(repo, "package.json")}:1:`);
      // The note names the folder by the path that leads to that file.
      expect(stderr).toEndWith(cannotTell(typed, repo));
    });

    test("the file above the real path doesn't parse: the command stops before it looks above $PWD", async () => {
      using project = linked(`{ "name": "elsewhere", oops`, ["packages/*"]);

      const { stdout, stderr, exitCode } = await project.run("pm", "bin");
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
      expect(stderr).toContain(`\n    at ${join(project.above, "package.json")}:1:`);
    });
  });

  // Root ignores the mode bits, so bun runs as another user there. That changes the modes of the
  // directories above the fixture for a moment, so these tests don't run in parallel.
  describe.skipIf(isWindows)("with a file mode that keeps bun out", () => {
    // npm skips it too, and so does Bun for a .npmrc: the file may belong to another user.
    test.serial("a package.json above the folder that can't be opened is skipped", async () => {
      using project = workspace();
      chmodSync(project.packageJson, 0o000);
      using user = unprivilegedSpawnOptions(project.root);

      await expectOwnProject(project.member, user);
    });

    // The listing stops at the first folder that it can't open. `workspaces` is read in order, so
    // the order decides whether the listing gets to `packages/*`.
    test.serial.each([
      [["locked/*", "packages/*"], false],
      [["packages/*", "locked/*"], true],
    ] as [string[], boolean][])(
      "the workspaces %j include a folder that can't be opened",
      async (workspaces, listed) => {
        using project = workspace(rootPackageJson(workspaces));
        const locked = join(project.root, "locked");
        mkdirSync(locked, { mode: 0o000 });
        try {
          using user = unprivilegedSpawnOptions(project.root);
          if (listed) return await expectRootFound(project, user);
          const result = await runBun(["pm", "bin"], project.member, bunEnv, user);

          expect({ ...result, stderr: errorLines(result.stderr) }).toEqual({
            stdout: "",
            stderr: [`error: Failed to run workspace pattern locked/* due to error EACCES (open "${locked}")`],
            exitCode: 1,
          });
          expect(result.stderr).toEndWith(cannotTell(project.member, project.root));
        } finally {
          chmodSync(locked, 0o755);
        }
      },
    );

    // Here the folder that can't be opened is under the same pattern as the others. The listing
    // reads folders in the order the file system returns them and stops at that one. Each folder
    // is closed in turn: of the other two, the one read before it finds the root, and the one
    // read after it stops.
    test.serial("a folder under the same pattern can't be opened", async () => {
      const names = ["pkg1", "pkg2", "pkg3"];
      using project = workspace(
        undefined,
        Object.fromEntries(names.map(name => [`packages/${name}/package.json`, JSON.stringify({ name })])),
      );
      using user = unprivilegedSpawnOptions(project.root);
      const results: string[] = [];
      for (const closed of names) {
        const closedDir = join(project.root, "packages", closed);
        chmodSync(closedDir, 0o000);
        try {
          for (const name of names.filter(name => name !== closed)) {
            const member = join(project.root, "packages", name);
            const result = await runBun(["pm", "bin"], member, bunEnv, user);
            if (result.exitCode === 0) {
              expect(result).toEqual({ stdout: binOf(project.root), stderr: "", exitCode: 0 });
              results.push("root");
              continue;
            }
            expect({ ...result, stderr: errorLines(result.stderr) }).toEqual({
              stdout: "",
              stderr: [`error: Failed to run workspace pattern packages/* due to error EACCES (open "${closedDir}")`],
              exitCode: 1,
            });
            expect(result.stderr).toEndWith(cannotTell(member, project.root));
            results.push("stopped");
          }
        } finally {
          chmodSync(closedDir, 0o755);
        }
      }
      expect(results.sort()).toEqual(["root", "root", "root", "stopped", "stopped", "stopped"]);
    });
  });

  // `bunx` finds the root on its own. The root lists the workspace here, so `bunx` still finds the
  // root's package from a workspace below an empty package.json next to a lockfile.
  test.skipIf(isWindows)("bunx in a workspace below an empty package.json next to a lockfile", async () => {
    using project = workspace(undefined, {
      "node_modules/@corp/cli/package.json": JSON.stringify({ name: "@corp/cli", version: "1.0.0", bin: "cli.sh" }),
      "node_modules/@corp/cli/cli.sh": "#!/bin/sh\necho the cli of the root\n",
      "packages/package.json": "",
      "packages/bun.lock": "",
    });
    const cli = join(project.root, "node_modules", "@corp", "cli", "cli.sh");
    chmodSync(cli, 0o755);
    mkdirSync(join(project.root, "node_modules", ".bin"));
    symlinkSync(cli, join(project.root, "node_modules", ".bin", "cli"));

    expect(await runBun(["x", "--no-install", "@corp/cli"], project.member)).toEqual({
      stdout: "the cli of the root\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // What must not change: these folders are their own projects.
  describe.concurrent("the package.json above can tell, and the folder is its own project", () => {
    test("the workspaces above it don't list it", async () => {
      using project = workspace(rootPackageJson(["apps/*"]));

      await expectOwnProject(project.member);
    });

    test("the package.json above it has no workspaces", async () => {
      using project = workspace(JSON.stringify({ name: "root" }));

      await expectOwnProject(project.member);
    });

    test("the workspaces above it is an object without packages", async () => {
      using project = workspace(JSON.stringify({ name: "root", workspaces: { catalog: {} } }));

      await expectOwnProject(project.member);
    });

    // `touch package.json && bun install` works, so that file is `{}` for the folders below it too.
    test("the package.json above it is empty with no lockfile next to it", async () => {
      using project = workspace("");

      await expectOwnProject(project.member);
    });

    // The listing got to every folder that `workspaces` matches. Its error is about another folder.
    test("the workspaces above it don't list it, and one that they list doesn't parse", async () => {
      using project = workspace(undefined, {
        "packages/pkg2/package.json": `{ "name": "pkg2", oops`,
        "tools/x/package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
      });

      await expectOwnProject(join(project.root, "tools", "x"));
    });
  });
});

// The package.json that `bun install` finds above the directory it runs in becomes the root of
// the install: it says which lifecycle scripts are trusted, and its .npmrc and bunfig.toml apply.
// In a directory with the mode of /tmp any local user can put one above somebody else's project.
describe.concurrent.skipIf(isWindows)("package.json in a sticky, shared directory above the cwd", () => {
  // Its postinstall runs only if the root of the install trusts it.
  const dep = JSON.stringify({
    name: "dep",
    version: "1.0.0",
    scripts: { postinstall: `echo ran > "$POSTINSTALL_MARKER"` },
  });

  // `shared/package.json` claims `shared/proj` as its workspace.
  const workspaceFiles = {
    "shared/package.json": JSON.stringify({ name: "planted", workspaces: ["proj"], trustedDependencies: ["dep"] }),
    "shared/proj/package.json": JSON.stringify({ name: "proj", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
    "shared/proj/dep/package.json": dep,
  };

  // `shared/sub` has no package.json. The walk continues above a manifest that it ignores, and the empty project at the
  // top keeps it inside the fixture.
  const projectFiles = {
    "package.json": JSON.stringify({ name: "fence", version: "0.0.0" }),
    "shared/package.json": JSON.stringify({
      name: "planted",
      version: "1.0.0",
      dependencies: { dep: "file:./dep" },
      trustedDependencies: ["dep"],
    }),
    "shared/dep/package.json": dep,
    "shared/sub/.keep": "",
  };

  const marker = (root: string) => join(root, "postinstall-ran");
  const installIn = (root: string, ...subdirectory: string[]) =>
    runBun(["install"], join(root, ...subdirectory), { ...bunEnv, POSTINSTALL_MARKER: marker(root) });
  const ignored = (root: string) =>
    `warn: ignoring package.json in ${join(root, "shared")}: directory is writable by other users\n`;

  test.each([
    ["everyone", 0o1777],
    ["the group", 0o1770],
  ])("writable by %s: is not the workspace root", async (_, mode) => {
    using dir = tempDir("root-discovery-sticky-workspace", workspaceFiles);
    const root = String(dir);
    chmodSync(join(root, "shared"), mode);

    const { stdout, stderr, exitCode } = await installIn(root, "shared", "proj");

    expect(stderr).toContain(ignored(root));
    expect(stdout).toContain("Blocked 1 postinstall");
    expect({
      postinstall: existsSync(marker(root)),
      "shared/proj/bun.lock": existsSync(join(root, "shared", "proj", "bun.lock")),
      "shared/bun.lock": existsSync(join(root, "shared", "bun.lock")),
      "shared/node_modules": existsSync(join(root, "shared", "node_modules")),
    }).toEqual({
      postinstall: false,
      "shared/proj/bun.lock": true,
      "shared/bun.lock": false,
      "shared/node_modules": false,
    });
    expect(exitCode).toBe(0);
  });

  test("is not read, so one that is not JSON does not fail the install", async () => {
    using dir = tempDir("root-discovery-sticky-invalid", { ...workspaceFiles, "shared/package.json": "{{{" });
    const root = String(dir);
    chmodSync(join(root, "shared"), 0o1777);

    const { stderr, exitCode } = await installIn(root, "shared", "proj");

    expect(stderr).toContain(ignored(root));
    expect(stderr).not.toContain("error");
    expect(existsSync(join(root, "shared", "proj", "bun.lock"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  async function expectFenceInstalled(root: string) {
    const { stdout, stderr, exitCode } = await installIn(root, "shared", "sub");

    expect(stderr).toContain(ignored(root));
    expect(stderr).not.toContain("error");
    expect(stdout).not.toContain("+ dep");
    expect({
      postinstall: existsSync(marker(root)),
      "shared/bun.lock": existsSync(join(root, "shared", "bun.lock")),
      "shared/node_modules": existsSync(join(root, "shared", "node_modules")),
    }).toEqual({ postinstall: false, "shared/bun.lock": false, "shared/node_modules": false });
    expect(exitCode).toBe(0);
  }

  test("is not the project of a directory without a package.json", async () => {
    using dir = tempDir("root-discovery-sticky-project", projectFiles);
    const root = String(dir);
    chmodSync(join(root, "shared"), 0o1777);

    await expectFenceInstalled(root);
  });

  // root opens the file whatever its mode is
  test.skipIf(isRoot)("is passed over as well when it cannot be opened", async () => {
    using dir = tempDir("root-discovery-sticky-unreadable", projectFiles);
    const root = String(dir);
    chmodSync(join(root, "shared", "package.json"), 0);
    chmodSync(join(root, "shared"), 0o1777);

    await expectFenceInstalled(root);
  });

  test("is the project when the command runs in that directory", async () => {
    using dir = tempDir("root-discovery-sticky-cwd", projectFiles);
    const root = String(dir);
    chmodSync(join(root, "shared"), 0o1777);

    const { stdout, stderr, exitCode } = await installIn(root, "shared");

    expect(stderr).not.toContain("warn:");
    expect(stdout).toContain("+ dep");
    expect(existsSync(marker(root))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["sticky, writable by its owner only", 0o1755],
    ["writable by everyone, not sticky", 0o777],
  ])("%s: is still the workspace root", async (_, mode) => {
    using dir = tempDir("root-discovery-not-shared", workspaceFiles);
    const root = String(dir);
    chmodSync(join(root, "shared"), mode);

    const { stdout, stderr, exitCode } = await installIn(root, "shared", "proj");

    expect(stderr).not.toContain("warn:");
    expect(stdout).not.toContain("Blocked");
    expect(existsSync(marker(root))).toBe(true);
    expect(existsSync(join(root, "shared", "bun.lock"))).toBe(true);
    expect(exitCode).toBe(0);
  });
});

// A working directory can be PATH_MAX - 1 bytes long, and `<cwd>/package.json` is 13 bytes longer.
// On Windows the path buffer is longer than any path the OS accepts.
describe.concurrent.skipIf(isWindows)("working directory close to PATH_MAX", () => {
  /** A project in a directory whose absolute path is exactly `cwdBytes` bytes long. */
  function deepProject(cwdBytes: number) {
    const dir = tempDir("root-discovery-deep-cwd", {
      "project/package.json": JSON.stringify({ name: "deep", version: "1.0.0" }),
    });
    let cwd = String(dir);
    // The last name has to stay under NAME_MAX (255).
    while (cwdBytes - Buffer.byteLength(cwd) > 256) cwd = join(cwd, Buffer.alloc(200, "d").toString());
    cwd = join(cwd, Buffer.alloc(cwdBytes - Buffer.byteLength(cwd) - 1, "L").toString());
    expect(Buffer.byteLength(cwd)).toBe(cwdBytes);
    // package.json may be too long to write by its final path: the directory is moved there with it inside.
    mkdirSync(dirname(cwd), { recursive: true });
    renameSync(join(String(dir), "project"), cwd);
    return { cwd, [Symbol.dispose]: () => dir[Symbol.dispose]() };
  }

  test("the longest <cwd>/package.json that can be opened is read", async () => {
    using project = deepProject(POSIX_PATH_BUFFER_BYTES - 1 - "/package.json".length);

    expect(await runBun(["pm", "pkg", "get", "name"], project.cwd)).toEqual({
      stdout: '"deep"\n',
      stderr: "",
      exitCode: 0,
    });
  });

  describe.each([
    ["PATH_MAX bytes long, leaving no room for the NUL", POSIX_PATH_BUFFER_BYTES - "/package.json".length],
    ["as long as it can be", POSIX_PATH_BUFFER_BYTES - 1],
  ])("<cwd>/package.json is %s", (_, cwdBytes) => {
    test.each(["install", "pm ls"])("bun %s fails with ENAMETOOLONG", async command => {
      using project = deepProject(cwdBytes);

      const { stdout, stderr, exitCode } = await runBun(command.split(" "), project.cwd);

      expect(stderr.replaceAll(project.cwd, "<cwd>")).toContain(
        'ENAMETOOLONG: File name too long: could not open "<cwd>/package.json" (open)\n',
      );
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    });
  });
});
