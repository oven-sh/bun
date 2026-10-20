import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { exists } from "fs/promises";
import { bunExe, bunEnv as env, MAX_PATH_BYTES, tempDir } from "harness";
import { join } from "path";

// These tests cover the text lockfile bump to version 2 and the parse-time
// checks gated behind it. They run fully offline — using `file:` deps or
// loopback/unreachable endpoints — so no external network or registry is
// required.

it("a freshly written text lockfile defaults to version 2", async () => {
  using dir = tempDir("lockfile-v2-default", {
    "package.json": JSON.stringify({ name: "root", dependencies: { dep: "file:./dep" } }),
    "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lockfile = await file(join(String(dir), "bun.lock")).text();
  expect(err).not.toContain("error:");
  expect(lockfile).toContain(`"lockfileVersion": 2,`);
  expect(exitCode).toBe(0);
});

// Re-saving an existing lockfile must never bump its version. A v1 `bun.lock`
// that is rewritten — here because a new dependency is added — keeps
// `lockfileVersion: 1`, even though every entry would satisfy the v2 invariants.
// Only a lockfile with no prior version (fresh install / migration) is written
// at the current version.
it("re-saving a v1 lockfile keeps it at version 1 even after adding a dependency", async () => {
  const v1Lockfile =
    JSON.stringify(
      {
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { "": { name: "root", dependencies: { a: "file:./a" } } },
        packages: { a: ["a@file:a", {}] },
      },
      null,
      2,
    ) + "\n";

  using dir = tempDir("lockfile-v1-no-bump", {
    // package.json asks for a second `file:` dep the lockfile doesn't have yet,
    // forcing a real re-save (not a no-op skip).
    "package.json": JSON.stringify({ name: "root", dependencies: { a: "file:./a", b: "file:./b" } }),
    "a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
    "b/package.json": JSON.stringify({ name: "b", version: "1.0.0" }),
    "bun.lock": v1Lockfile,
  });

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const after = await file(join(String(dir), "bun.lock")).text();
  expect(err).not.toContain("error:");
  // The lockfile was actually rewritten (the new dep is present)...
  expect(after).toContain(`"b": ["b@file:b"`);
  // ...but its version was preserved, not bumped to 2.
  expect(after).toContain(`"lockfileVersion": 1,`);
  expect(after).not.toContain(`"lockfileVersion": 2,`);
  expect(exitCode).toBe(0);
});

// A v0 lockfile is the one version that must NOT be preserved verbatim: v0→v1
// was a content-format change (v1 stopped emitting a workspace package's deps
// object), and the writer only ever emits the v1+ single-element
// `["name@workspace:path"]` form. Stamping v0 on that output would make the
// next parse fail with "Missing dependencies object". So a re-saved v0 lockfile
// is floored to v1 — and, critically, must still parse on the next install.
it("re-saving a v0 lockfile floors it to version 1 so it stays parseable", async () => {
  const v0Lockfile =
    JSON.stringify(
      {
        lockfileVersion: 0,
        workspaces: {
          "": { name: "root", dependencies: { pkg1: "workspace:*" } },
          "packages/pkg1": { name: "pkg1" },
        },
        // v0 workspace entry shape (with a trailing object).
        packages: { pkg1: ["pkg1@workspace:packages/pkg1", {}] },
      },
      null,
      2,
    ) + "\n";

  using dir = tempDir("lockfile-v0-floor", {
    "package.json": JSON.stringify({
      name: "root",
      workspaces: ["packages/*"],
      dependencies: { pkg1: "workspace:*" },
    }),
    "packages/pkg1/package.json": JSON.stringify({ name: "pkg1" }),
    "bun.lock": v0Lockfile,
  });

  // First install re-saves the lockfile.
  await using first = spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, firstErr, firstExit] = await Promise.all([first.stdout.text(), first.stderr.text(), first.exited]);

  const after = await file(join(String(dir), "bun.lock")).text();
  expect(firstErr).not.toContain("error:");
  // Floored to v1 — never left at v0 (the writer can't emit v0 content), and
  // not bumped past the existing version to v2 either.
  expect(after).toContain(`"lockfileVersion": 1,`);
  expect(after).not.toContain(`"lockfileVersion": 0,`);
  expect(after).not.toContain(`"lockfileVersion": 2,`);
  expect(firstExit).toBe(0);

  // The re-saved lockfile must still parse. With the version left at v0 this
  // would fail with "failed to parse lockfile" / "Missing dependencies object".
  await using second = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, secondErr, secondExit] = await Promise.all([second.stdout.text(), second.stderr.text(), second.exited]);
  expect(secondErr).not.toContain("failed to parse lockfile");
  expect(secondErr).not.toContain("Ignoring lockfile");
  expect(secondErr).not.toContain("lockfile had changes, but lockfile is frozen");
  expect(secondExit).toBe(0);
});

it("an existing v1 lockfile still loads (backward compatible)", async () => {
  const v1Lockfile =
    JSON.stringify(
      {
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { "": { name: "root", dependencies: { dep: "file:./dep" } } },
        packages: { dep: ["dep@file:dep", {}] },
      },
      null,
      2,
    ) + "\n";

  using dir = tempDir("lockfile-v1-load", {
    "package.json": JSON.stringify({ name: "root", dependencies: { dep: "file:./dep" } }),
    "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    "bun.lock": v1Lockfile,
  });

  await using proc = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(err).not.toContain("error:");
  expect(await exists(join(String(dir), "node_modules", "dep", "package.json"))).toBe(true);
  expect(exitCode).toBe(0);
});

// An off-registry npm tarball URL with no integrity hash is a breaking change
// introduced after the Rust rewrite: rejecting it breaks lockfiles written
// before the check existed, so it is only enforced at version 2.
it("off-registry npm tarball integrity is enforced only at version 2", async () => {
  // A loopback host that is never the configured registry. For v2 parsing fails
  // before any fetch, so it is not contacted; for v1 parsing succeeds and the
  // install proceeds to request the tarball, hitting this 404 handler.
  await using offRegistry = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Response("not found", { status: 404 });
    },
  });

  const offRegistryTarball = `http://127.0.0.1:${offRegistry.port}/no-deps/-/no-deps-1.0.0.tgz`;
  const lockfile = (lockfileVersion: number) =>
    JSON.stringify({
      lockfileVersion,
      configVersion: 1,
      workspaces: { "": { name: "root", dependencies: { "no-deps": "1.0.0" } } },
      packages: { "no-deps": ["no-deps@1.0.0", offRegistryTarball, {}, ""] },
    });

  // version 2 fails closed while parsing.
  {
    using dir = tempDir("lockfile-v2-integrity", {
      "package.json": JSON.stringify({ name: "root", dependencies: { "no-deps": "1.0.0" } }),
      "bun.lock": lockfile(2),
    });
    await using proc = spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain(
      "Missing integrity hash for npm package resolved to a tarball URL outside the configured registry",
    );
    expect(await exists(join(String(dir), "node_modules", "no-deps"))).toBe(false);
    expect(exitCode).not.toBe(0);
  }

  // version 1 predates the check, so parsing accepts it (the install then fails
  // to download the tarball from the 404 handler, but not with the integrity error).
  {
    using dir = tempDir("lockfile-v1-integrity", {
      "package.json": JSON.stringify({ name: "root", dependencies: { "no-deps": "1.0.0" } }),
      "bun.lock": lockfile(1),
    });
    await using proc = spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("Missing integrity hash");
  }
});

// An unsafe `git` `.bun-tag` is a post-rewrite breaking change that is gated to
// v2. `Repository::checkout` re-validates the tag before running git, so a v1
// lockfile carrying an unsafe git tag still never executes anything unsafe.
// (The `github` tarball path has no such re-validation — see the next test.)
it("unsafe git .bun-tag is rejected only at version 2", async () => {
  // When v1 parsing succeeds, install proceeds to `git clone` (an https
  // attempt, then ssh). `GIT_ALLOW_PROTOCOL=file` makes git reject both
  // transports immediately, so the clone fails fast with no network at all —
  // connecting to an "unreachable" loopback port can hang on some CI hosts.
  const gitEnv = { ...env, GIT_ALLOW_PROTOCOL: "file" };
  const gitUrl = "git+ssh://git@127.0.0.1:1/example/repo.git#main";
  const lockfile = (lockfileVersion: number) =>
    JSON.stringify({
      lockfileVersion,
      configVersion: 1,
      workspaces: {
        "": { name: "root", dependencies: { dep: gitUrl } },
      },
      packages: {
        // `.bun-tag` (last element) contains a path separator.
        dep: [`dep@${gitUrl}`, {}, "../escape"],
      },
    });

  // version 2 rejects the unsafe tag while parsing, before any git work.
  {
    using dir = tempDir("lockfile-v2-gittag", {
      "package.json": JSON.stringify({ name: "root", dependencies: { dep: gitUrl } }),
      "bun.lock": lockfile(2),
    });
    await using proc = spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: String(dir),
      env: gitEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain("Invalid git dependency tag");
    expect(exitCode).not.toBe(0);
  }

  // version 1 predates the check, so parsing no longer rejects it (the install
  // then fails cloning the repo, but not with the parse-time error).
  {
    using dir = tempDir("lockfile-v1-gittag", {
      "package.json": JSON.stringify({ name: "root", dependencies: { dep: gitUrl } }),
      "bun.lock": lockfile(1),
    });
    await using proc = spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile", "--lockfile-only"],
      cwd: String(dir),
      env: gitEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("Invalid git dependency tag");
    // v1 parses cleanly and `--lockfile-only` skips the install, so it exits 0.
    expect(exitCode).toBe(0);
  }
});

// The tag is formatted into a cache folder name before `Repository::checkout` validates it.
it.concurrent.each([0, 1, 2])(
  "rejects a git .bun-tag longer than the path buffer at version %d",
  async lockfileVersion => {
    const gitUrl = "git+ssh://git@127.0.0.1:1/example/repo.git#main";
    using dir = tempDir("lockfile-gittag-length", {
      "package.json": JSON.stringify({ name: "root", dependencies: { dep: gitUrl } }),
      "bun.lock": JSON.stringify({
        lockfileVersion,
        configVersion: 1,
        workspaces: { "": { name: "root", dependencies: { dep: gitUrl } } },
        packages: { dep: [`dep@${gitUrl}`, {}, Buffer.alloc(MAX_PATH_BYTES + 4, "a").toString()] },
      }),
    });
    await using proc = spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: String(dir),
      // Blocks the ssh transport so git can't clone.
      env: { ...env, GIT_ALLOW_PROTOCOL: "file" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(err).toContain("Invalid git dependency tag");
    expect(exitCode).toBe(1);
  },
);

// A `github` dependency resolves via the tarball-download path, not
// `Repository::checkout`, so its `.bun-tag` is fed into the cache folder name
// with no use-site re-validation. The parse-time safety check therefore stays
// unconditional for github — an unsafe tag is rejected at every version.
it("unsafe github .bun-tag is rejected at every version", async () => {
  const ghUrl = "github:example/repo#main";
  const lockfile = (lockfileVersion: number) =>
    JSON.stringify({
      lockfileVersion,
      configVersion: 1,
      workspaces: {
        "": { name: "root", dependencies: { dep: ghUrl } },
      },
      packages: {
        // `.bun-tag` (last element) contains a path separator.
        dep: [`dep@${ghUrl}`, {}, "../escape"],
      },
    });

  for (const version of [1, 2]) {
    using dir = tempDir(`lockfile-v${version}-githubtag`, {
      "package.json": JSON.stringify({ name: "root", dependencies: { dep: ghUrl } }),
      "bun.lock": lockfile(version),
    });
    await using proc = spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain("Invalid git dependency tag");
    expect(exitCode).not.toBe(0);
  }
});

it("a github resolution whose committish contains a slash reads back with owner, repo and tag intact", async () => {
  const ghUrl = "github:example/repo#feature/branch";
  const lockfile = JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: {
      "": { name: "root", dependencies: { dep: ghUrl } },
    },
    packages: {
      dep: [`dep@${ghUrl}`, {}, "example-repo-abc1234"],
    },
  });

  using dir = tempDir("lockfile-github-committish-slash", {
    "package.json": JSON.stringify({ name: "root", dependencies: { dep: ghUrl } }),
    "bun.lock": lockfile,
  });

  await using proc = spawn({
    cmd: [bunExe(), "pm", "hash-string"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(out).toContain("dep@github:example/repo#abc1234\n");
  expect(exitCode).toBe(0);
});

// The tag of a GitHub package is the name of the root directory of its tarball. GitHub names the
// root `<owner>-<repo>-<commit>`, so the end of such a tag is the commit, and bun.lock saves it
// after the `#` of the package. The tag of a git package is its commit. Any other tag has no
// commit, and the package keeps the ref that it has. The hash that bun.lockb stores (`bun pm
// hash-string`) keeps the text of earlier versions: the tag from its last `-`, commit or not.
it("saves a commit after the `#` of a git or GitHub package only when its tag has one", async () => {
  const sha1 = Buffer.alloc(40, "0123456789abcdef").toString();
  const sha256 = Buffer.alloc(64, "0123456789abcdef").toString();
  // [name, resolution in bun.lock, tag, resolution that is saved, resolution in the hash]
  const rows: [string, string, string, string, string?][] = [
    // 7 digits of a commit, or all of it, at the end of a root directory's name
    ["short", "github:o/short#main", "o-short-abc1234", "github:o/short#abc1234"],
    ["full", "github:o/full#main", `o-full-${sha1}`, `github:o/full#${sha1}`],
    // a commit alone
    ["whole", "github:o/whole#main", sha1, `github:o/whole#${sha1}`],
    ["git", "git+http://localhost:1/git.git#main", sha1, `git+http://localhost:1/git.git#${sha1}`],
    ["sha256", "git+http://localhost:1/sha256.git#main", sha256, `git+http://localhost:1/sha256.git#${sha256}`],
    // no commit: not hex digits, not at the end of a longer name, or not the length of a commit
    ["word", "github:o/word#main", "my-package", "github:o/word#main", "github:o/word#package"],
    ["bare", "github:o/bare#main", "abc1234", "github:o/bare#main", "github:o/bare#abc1234"],
    ["eight", "github:o/eight#main", "o-eight-abc12345", "github:o/eight#main", "github:o/eight#abc12345"],
    ["most", "github:o/most#main", `o-most-${sha1.slice(1)}`, "github:o/most#main", `github:o/most#${sha1.slice(1)}`],
    ["dash", "github:o/dash#main", "my-lib-", "github:o/dash#main", "github:o/dash#"],
    ["dot", "github:o/dot#main", "pkg.root", "github:o/dot#main", "github:o/dot#pkg.root"],
    ["ref", "github:o/ref#rel-20240115", "rel-20240115", "github:o/ref#rel-20240115", "github:o/ref#20240115"],
    ["none", "github:o/none", "my-lib", "github:o/none", "github:o/none#lib"],
    ["tag", "git+http://localhost:1/tag.git#v1.0.0", "v1.0.0", "git+http://localhost:1/tag.git#v1.0.0"],
    // Bun before 1.4 misreads these bytes after the `#`, so such a ref is not saved
    ["slash", "github:o/slash#feature/x", "my-lib", "github:o/slash#lib"],
    ["plus", "github:o/plus#v1+meta", "my-lib", "github:o/plus#lib"],
    // saved by an earlier version
    ["cut", "github:o/cut#lib", "my-lib", "github:o/cut#lib"],
    // no tag
    ["untagged", "git+http://localhost:1/untagged.git#main", "", "git+http://localhost:1/untagged.git#main"],
    ["plain", "git+http://localhost:1/plain.git", "", "git+http://localhost:1/plain.git"],
  ];
  const dependencies = Object.fromEntries(rows.map(([name, resolution]) => [name, resolution]));

  const requests: string[] = [];
  await using github = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname);
      return new Response("Not Found", { status: 404 });
    },
  });
  using dir = tempDir("lockfile-git-tag-commit", {
    // A dependency that bun.lock does not have makes the install save it again.
    "package.json": JSON.stringify({ name: "root", dependencies: { ...dependencies, extra: "file:./extra" } }),
    "extra/package.json": JSON.stringify({ name: "extra", version: "1.0.0" }),
    "bun.lock": JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { "": { name: "root", dependencies } },
      packages: Object.fromEntries(rows.map(([name, resolution, tag]) => [name, [`${name}@${resolution}`, {}, tag]])),
    }),
  });
  const run = async (...args: string[]) => {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: { ...env, GITHUB_API_URL: github.url.origin },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
    return out;
  };

  await run("install", "--lockfile-only");
  const { packages } = Bun.JSONC.parse(await file(join(String(dir), "bun.lock")).text()) as {
    packages: Record<string, unknown[]>;
  };
  const hashed = (await run("pm", "hash-string")).split("\n");
  expect(
    Object.fromEntries(
      rows.map(([name]) => [name, { saved: packages[name], hashed: hashed.find(line => line.startsWith(`${name}@`)) }]),
    ),
  ).toEqual(
    Object.fromEntries(
      rows.map(([name, , tag, saved, inHash = saved]) => [
        name,
        { saved: [`${name}@${saved}`, {}, tag], hashed: `${name}@${inHash}` },
      ]),
    ),
  );
  expect(requests).toEqual([]);
});

// The writer must not silently upgrade a lockfile to v2 if doing so would make
// it fail the v2 parse checks on the next install. A v1 lockfile with an
// off-registry tarball and no integrity hash must round-trip as v1.
it("re-saving a v1 off-registry lockfile keeps it at version 1", async () => {
  await using offRegistry = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Response("not found", { status: 404 });
    },
  });

  const v1Lockfile = JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: "root", dependencies: { "no-deps": "1.0.0" } } },
    packages: {
      "no-deps": ["no-deps@1.0.0", `http://127.0.0.1:${offRegistry.port}/no-deps/-/no-deps-1.0.0.tgz`, {}, ""],
    },
  });

  using dir = tempDir("lockfile-v1-roundtrip", {
    "package.json": JSON.stringify({ name: "root", dependencies: { "no-deps": "1.0.0" } }),
    "bun.lock": v1Lockfile,
  });

  // `--lockfile-only` re-serializes the lockfile without performing the install
  // (so the unreachable off-registry tarball is never fetched). This is the
  // write path that would wrongly stamp v2 without the version-selection guard.
  await using proc = spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const after = await file(join(String(dir), "bun.lock")).text();
  expect(err).toContain("Saved lockfile");
  // Still v1 — the off-registry no-integrity entry can't be made v2-valid, so
  // stamping v2 would make the next parse reject it.
  expect(after).toContain(`"lockfileVersion": 1,`);
  expect(exitCode).toBe(0);
});

// A nested override rule alone must not push a walk-held v1 file to v3 (v3 implies v2 strictness).
it("re-saving a v1 off-registry lockfile that gains a nested override rule stays at version 1 and re-reads frozen in the same directory", async () => {
  await using offRegistry = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Response("not found", { status: 404 });
    },
  });

  const v1Lockfile = JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: "root", dependencies: { "no-deps": "1.0.0" } } },
    packages: {
      "no-deps": ["no-deps@1.0.0", `http://127.0.0.1:${offRegistry.port}/no-deps/-/no-deps-1.0.0.tgz`, {}, ""],
    },
  });

  using dir = tempDir("lockfile-v1-nested-override-roundtrip", {
    "package.json": JSON.stringify({
      name: "root",
      dependencies: { "no-deps": "1.0.0" },
      overrides: { "no-deps": { bar: "1.0.0" } },
    }),
    "bun.lock": v1Lockfile,
  });

  await using proc = spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const after = await file(join(String(dir), "bun.lock")).text();
  expect(err).toContain("Saved lockfile");
  expect(after).toContain(`"lockfileVersion": 1,`);
  expect(after).not.toContain(`"lockfileVersion": 3,`);
  expect(after).toContain(`"no-deps": {`);
  expect(after).toContain(`"bar": "1.0.0"`);
  expect(after).toContain(`no-deps-1.0.0.tgz", {}, ""]`);
  expect(exitCode).toBe(0);

  await using frozenProc = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile", "--lockfile-only"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, frozenErr, frozenExit] = await Promise.all([
    frozenProc.stdout.text(),
    frozenProc.stderr.text(),
    frozenProc.exited,
  ]);

  expect(frozenErr).not.toContain(
    "Missing integrity hash for npm package resolved to a tarball URL outside the configured registry",
  );
  expect(frozenErr).not.toContain("Ignoring lockfile");
  expect(frozenErr).not.toContain("lockfile had changes, but lockfile is frozen");
  expect(await file(join(String(dir), "bun.lock")).text()).toBe(after);
  expect(frozenExit).toBe(0);
});

// The version stamp must not depend on the writer's registry config. A lockfile
// is committed and shared, so whether the *reader* accepts it cannot hinge on
// the *writer*'s `~/.npmrc` / scoped registries. A v1 lockfile with a tarball
// under a writer-only scoped registry (and no integrity hash) used to be stamped
// v2 — matching the writer's own scope — which then failed to parse for a
// teammate or CI that lacks that scope. It must round-trip as v1 so it keeps
// loading regardless of the reader's config.
it("re-saving keeps v1 for a tarball under a writer-only scoped registry", async () => {
  // A scoped registry the writer knows about but a reader won't. `--lockfile-only`
  // never fetches the tarball, so the host need not be reachable.
  await using scopedRegistry = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Response("not found", { status: 404 });
    },
  });
  const scopedRegistryUrl = `http://127.0.0.1:${scopedRegistry.port}/`;
  const scopedTarball = `${scopedRegistryUrl}@myorg/foo/-/foo-1.0.0.tgz`;

  const v1Lockfile = JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: "root", dependencies: { "@myorg/foo": "1.0.0" } } },
    packages: {
      // Off-registry tarball (under the scoped registry, not the default) with
      // an empty integrity hash.
      "@myorg/foo": ["@myorg/foo@1.0.0", scopedTarball, {}, ""],
    },
  });

  // Writer: has the `@myorg` scope configured, so `scope_for_package_name`
  // resolves the tarball URL to its registry. This is the config that used to
  // make the writer consider the entry "v2-clean" and stamp v2.
  using writerDir = tempDir("lockfile-scoped-writer", {
    "package.json": JSON.stringify({ name: "root", dependencies: { "@myorg/foo": "1.0.0" } }),
    "bunfig.toml": Bun.TOML.stringify({ install: { scopes: { myorg: { url: scopedRegistryUrl } } } }),
    "bun.lock": v1Lockfile,
  });

  await using writerProc = spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: String(writerDir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, writerErr, writerExit] = await Promise.all([
    writerProc.stdout.text(),
    writerProc.stderr.text(),
    writerProc.exited,
  ]);

  const rewritten = await file(join(String(writerDir), "bun.lock")).text();
  expect(writerErr).toContain("Saved lockfile");
  // Must stay v1: the tarball is not under the *default* registry, which is the
  // only normalization the writer applies, so v2 can't be guaranteed to parse
  // for a reader without the `@myorg` scope.
  expect(rewritten).toContain(`"lockfileVersion": 1,`);
  expect(writerExit).toBe(0);

  // Reader: no `@myorg` scope. The re-saved lockfile must still load — if the
  // writer had stamped v2, this would fail with the integrity error.
  using readerDir = tempDir("lockfile-scoped-reader", {
    "package.json": JSON.stringify({ name: "root", dependencies: { "@myorg/foo": "1.0.0" } }),
    "bun.lock": rewritten,
  });

  await using readerProc = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile", "--lockfile-only"],
    cwd: String(readerDir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, readerErr, readerExit] = await Promise.all([
    readerProc.stdout.text(),
    readerProc.stderr.text(),
    readerProc.exited,
  ]);

  expect(readerErr).not.toContain(
    "Missing integrity hash for npm package resolved to a tarball URL outside the configured registry",
  );
  // v1 round-trips with no fetch, so the reader exits cleanly.
  expect(readerExit).toBe(0);
});

it("re-saving keeps v1 for a writer-only scoped tarball even when a nested override rule is added", async () => {
  await using scopedRegistry = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Response("not found", { status: 404 });
    },
  });
  const scopedRegistryUrl = `http://127.0.0.1:${scopedRegistry.port}/`;
  const scopedTarball = `${scopedRegistryUrl}@myorg/foo/-/foo-1.0.0.tgz`;

  const v1Lockfile = JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: "root", dependencies: { "@myorg/foo": "1.0.0" } } },
    packages: {
      "@myorg/foo": ["@myorg/foo@1.0.0", scopedTarball, {}, ""],
    },
  });
  // `bar` is not in the tree, so the new rule re-resolves nothing and the row survives verbatim.
  const packageJson = JSON.stringify({
    name: "root",
    dependencies: { "@myorg/foo": "1.0.0" },
    overrides: { "@myorg/foo": { bar: "1.0.0" } },
  });

  using writerDir = tempDir("lockfile-scoped-nested-writer", {
    "package.json": packageJson,
    "bunfig.toml": Bun.TOML.stringify({ install: { scopes: { myorg: { url: scopedRegistryUrl } } } }),
    "bun.lock": v1Lockfile,
  });

  await using writerProc = spawn({
    cmd: [bunExe(), "install", "--lockfile-only"],
    cwd: String(writerDir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, writerErr, writerExit] = await Promise.all([
    writerProc.stdout.text(),
    writerProc.stderr.text(),
    writerProc.exited,
  ]);

  const rewritten = await file(join(String(writerDir), "bun.lock")).text();
  expect(writerErr).toContain("Saved lockfile");
  expect(rewritten).toContain(`"lockfileVersion": 1,`);
  expect(rewritten).not.toContain(`"lockfileVersion": 3,`);
  expect(rewritten).toContain(`"@myorg/foo": {`);
  expect(rewritten).toContain(`"bar": "1.0.0"`);
  expect(rewritten).toContain(scopedTarball);
  expect(writerExit).toBe(0);

  using readerDir = tempDir("lockfile-scoped-nested-reader", {
    "package.json": packageJson,
    "bun.lock": rewritten,
  });

  await using readerProc = spawn({
    cmd: [bunExe(), "install", "--frozen-lockfile", "--lockfile-only"],
    cwd: String(readerDir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, readerErr, readerExit] = await Promise.all([
    readerProc.stdout.text(),
    readerProc.stderr.text(),
    readerProc.exited,
  ]);

  expect(readerErr).not.toContain(
    "Missing integrity hash for npm package resolved to a tarball URL outside the configured registry",
  );
  expect(readerErr).not.toContain("Ignoring lockfile");
  expect(readerErr).not.toContain("lockfile had changes, but lockfile is frozen");
  expect(await file(join(String(readerDir), "bun.lock")).text()).toBe(rewritten);
  expect(readerExit).toBe(0);
});
