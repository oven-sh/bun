import { spawn, spawnSync } from "bun";
import { install_test_helpers } from "bun:internal-for-testing";
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isRoot, isWindows, tempDir, tmpdirSync } from "harness";
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

async function runBun(args: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
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
