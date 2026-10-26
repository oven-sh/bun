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

// `bun install` keeps the loaded version on purpose. `bun pm migrate` is the
// explicit step that moves an existing `bun.lock` to the version a fresh write
// gets, with every package row unchanged.
async function runPm(cwd: string, ...args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), "pm", ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

it.concurrent("bun pm migrate rewrites a v1 lockfile at version 2 with identical rows", async () => {
  using dir = tempDir("lockfile-v1-pm-migrate", {
    "package.json": JSON.stringify({ name: "root", dependencies: { dep: "file:./dep" } }),
    "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
  });
  const lockfilePath = join(String(dir), "bun.lock");

  await using install = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, installErr, installExit] = await Promise.all([install.stdout.text(), install.stderr.text(), install.exited]);
  expect(installErr).not.toContain("error:");
  expect(installExit).toBe(0);
  const fresh = await file(lockfilePath).text();
  expect(fresh).toContain(`"lockfileVersion": 2,`);
  const v1 = fresh.replace(`"lockfileVersion": 2,`, `"lockfileVersion": 1,`);
  await Bun.write(lockfilePath, v1);

  const [dryOut, dryErr, dryExit] = await runPm(String(dir), "migrate", "--dry-run");
  expect(dryOut).toBe("dry run: would write bun.lock at lockfileVersion 2 (now 1)\n");
  expect(dryErr).not.toContain("error:");
  expect(await file(lockfilePath).text()).toBe(v1);
  expect(dryExit).toBe(0);

  const [, err, exitCode] = await runPm(String(dir), "migrate");
  expect(err).toContain("migrated bun.lock from lockfileVersion 1 to 2");
  expect(await file(lockfilePath).text()).toBe(fresh);
  expect(exitCode).toBe(0);

  const [againOut, , againExit] = await runPm(String(dir), "migrate");
  expect(againOut).toBe("bun.lock is already at lockfileVersion 2\n");
  expect(await file(lockfilePath).text()).toBe(fresh);
  expect(againExit).toBe(0);
});

it.concurrent("bun pm migrate stamps version 3 when scoped override rules exist", async () => {
  using dir = tempDir("lockfile-v1-pm-migrate-scoped", {
    "package.json": JSON.stringify({
      name: "root",
      dependencies: { dep: "file:./dep" },
      overrides: { dep: { bar: "1.0.0" } },
    }),
    "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
  });
  const lockfilePath = join(String(dir), "bun.lock");

  await using install = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, installErr, installExit] = await Promise.all([install.stdout.text(), install.stderr.text(), install.exited]);
  expect(installErr).not.toContain("error:");
  expect(installExit).toBe(0);
  const fresh = await file(lockfilePath).text();
  expect(fresh).toContain(`"lockfileVersion": 3,`);
  await Bun.write(lockfilePath, fresh.replace(`"lockfileVersion": 3,`, `"lockfileVersion": 1,`));

  const [, err, exitCode] = await runPm(String(dir), "migrate");
  expect(err).toContain("migrated bun.lock from lockfileVersion 1 to 3");
  expect(await file(lockfilePath).text()).toBe(fresh);
  expect(exitCode).toBe(0);
});

it.concurrent("bun pm migrate names the off-registry package with no integrity and keeps version 1", async () => {
  await using offRegistry = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Response("not found", { status: 404 });
    },
  });
  const tarball = `http://127.0.0.1:${offRegistry.port}/no-deps/-/no-deps-1.0.0.tgz`;
  const v1Lockfile = JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: "root", dependencies: { "no-deps": "1.0.0" } } },
    packages: {
      "no-deps": ["no-deps@1.0.0", tarball, {}, ""],
    },
  });

  using dir = tempDir("lockfile-v1-pm-migrate-blocked", {
    "package.json": JSON.stringify({ name: "root", dependencies: { "no-deps": "1.0.0" } }),
    "bun.lock": v1Lockfile,
  });

  const [out, err, exitCode] = await runPm(String(dir), "migrate");
  expect(err).toContain(
    `error: bun.lock is held at lockfileVersion 1: Missing integrity hash for npm package resolved to a tarball URL outside the default registry: "no-deps@1.0.0" resolves to ${tarball}\n`,
  );
  expect(err).toContain(
    "note: version 2 needs an integrity hash for a tarball that is not under https://registry.npmjs.org",
  );
  expect(err).not.toContain("the next 'bun install'");
  expect(out).toBe("");
  expect(await file(join(String(dir), "bun.lock")).text()).toBe(v1Lockfile);
  expect(exitCode).toBe(1);
});

// The walk compares the URL with the default registry only, so the stamp does
// not depend on the writer's scopes. A v3 file that holds such an entry is
// written back at version 1 by the next `bun install`.
it.concurrent(
  "bun pm migrate names the default registry for a scoped tarball and says what bun install writes",
  async () => {
    await using scopedRegistry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return new Response("not found", { status: 404 });
      },
    });
    const scopedRegistryUrl = `http://127.0.0.1:${scopedRegistry.port}/`;
    const tarball = `${scopedRegistryUrl}@myorg/foo/-/foo-1.0.0.tgz`;
    const v3Lockfile = JSON.stringify({
      lockfileVersion: 3,
      configVersion: 1,
      workspaces: { "": { name: "root", dependencies: { "@myorg/foo": "1.0.0" } } },
      overrides: { "@myorg/foo": { bar: "1.0.0" } },
      packages: {
        "@myorg/foo": ["@myorg/foo@1.0.0", tarball, {}, ""],
      },
    });

    using dir = tempDir("lockfile-v3-pm-migrate-scoped-blocked", {
      "package.json": JSON.stringify({
        name: "root",
        dependencies: { "@myorg/foo": "1.0.0" },
        overrides: { "@myorg/foo": { bar: "1.0.0" } },
      }),
      "bunfig.toml": Bun.TOML.stringify({ install: { scopes: { myorg: { url: scopedRegistryUrl } } } }),
      "bun.lock": v3Lockfile,
    });

    const [out, err, exitCode] = await runPm(String(dir), "migrate");
    expect(err).toContain(
      `error: bun.lock is held at lockfileVersion 1: Missing integrity hash for npm package resolved to a tarball URL outside the default registry: "@myorg/foo@1.0.0" resolves to ${tarball}\n`,
    );
    expect(err).toContain("note: the next 'bun install' writes bun.lock at lockfileVersion 1 (it is now 3)\n");
    expect(out).toBe("");
    expect(await file(join(String(dir), "bun.lock")).text()).toBe(v3Lockfile);
    expect(exitCode).toBe(1);
  },
);

// `bun install` keeps a loaded version 2 as it is, so there is nothing to
// migrate. The entry that would hold a new lockfile at 1 is still named.
it.concurrent(
  "bun pm migrate leaves a version 2 lockfile alone and warns about the entry a new one would trip on",
  async () => {
    await using scopedRegistry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return new Response("not found", { status: 404 });
      },
    });
    const scopedRegistryUrl = `http://127.0.0.1:${scopedRegistry.port}/`;
    const tarball = `${scopedRegistryUrl}@myorg/foo/-/foo-1.0.0.tgz`;
    const v2Lockfile = JSON.stringify({
      lockfileVersion: 2,
      configVersion: 1,
      workspaces: { "": { name: "root", dependencies: { "@myorg/foo": "1.0.0" } } },
      packages: {
        "@myorg/foo": ["@myorg/foo@1.0.0", tarball, {}, ""],
      },
    });

    using dir = tempDir("lockfile-v2-pm-migrate-scoped-kept", {
      "package.json": JSON.stringify({ name: "root", dependencies: { "@myorg/foo": "1.0.0" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { scopes: { myorg: { url: scopedRegistryUrl } } } }),
      "bun.lock": v2Lockfile,
    });

    const [out, err, exitCode] = await runPm(String(dir), "migrate");
    expect(out).toBe("bun.lock is already at lockfileVersion 2\n");
    expect(err).toContain(
      `warn: a new bun.lock for this project would be at lockfileVersion 1: Missing integrity hash for npm package resolved to a tarball URL outside the default registry: "@myorg/foo@1.0.0" resolves to ${tarball}\n`,
    );
    expect(await file(join(String(dir), "bun.lock")).text()).toBe(v2Lockfile);
    expect(exitCode).toBe(0);
  },
);

// The v1 parser drops an integrity hash it cannot read, with a warning. A
// migration would write the entry without the hash, so it reads the hash the
// way version 2 does and refuses.
it.concurrent("bun pm migrate refuses an integrity hash the version 1 parser only warns about", async () => {
  const v1Lockfile = JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: "root", dependencies: { "no-deps": "1.0.0" } } },
    packages: {
      "no-deps": ["no-deps@1.0.0", "", {}, "md5-AAAAAAAAAAAAAAAAAAAAAA=="],
    },
  });

  using dir = tempDir("lockfile-v1-pm-migrate-malformed-integrity", {
    "package.json": JSON.stringify({ name: "root", dependencies: { "no-deps": "1.0.0" } }),
    "bun.lock": v1Lockfile,
  });

  const [out, err, exitCode] = await runPm(String(dir), "migrate");
  expect(err).toContain("error: Unsupported or malformed integrity hash\n");
  expect(err).toContain("error: failed to parse lockfile");
  expect(out).toBe("");
  expect(await file(join(String(dir), "bun.lock")).text()).toBe(v1Lockfile);
  expect(exitCode).toBe(1);
});

// An empty registry field means the default registry. An install reads it as
// the reader's registry, so a re-save with a mirror configured pins the mirror
// URL. The migration must not.
it.concurrent("bun pm migrate keeps an empty registry field empty under a configured registry", async () => {
  await using mirror = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Response("not found", { status: 404 });
    },
  });
  const integrity = "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
  const lockfile = (lockfileVersion: number) =>
    JSON.stringify(
      {
        lockfileVersion,
        configVersion: 1,
        workspaces: { "": { name: "root", dependencies: { "no-deps": "1.0.0" } } },
        packages: {
          "no-deps": ["no-deps@1.0.0", "", {}, integrity],
        },
      },
      null,
      2,
    );

  using dir = tempDir("lockfile-v1-pm-migrate-mirror", {
    "package.json": JSON.stringify({ name: "root", dependencies: { "no-deps": "1.0.0" } }),
    "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${mirror.port}/"\n`,
    "bun.lock": lockfile(1),
  });

  const [, err, exitCode] = await runPm(String(dir), "migrate");
  expect(err).toContain("migrated bun.lock from lockfileVersion 1 to 2");
  const after = await file(join(String(dir), "bun.lock")).text();
  expect(after).toContain(`"lockfileVersion": 2,`);
  expect(after).toContain(`["no-deps@1.0.0", "", {}, "${integrity}"]`);
  expect(after).not.toContain(`127.0.0.1:${mirror.port}`);
  expect(exitCode).toBe(0);
});

// bunfig `install.lockfile.save` sets the same internal bit as `--force`. Only
// the flag itself picks the overwrite path.
it.concurrent("bun pm migrate rewrites bun.lock under bunfig install.lockfile.save", async () => {
  using dir = tempDir("lockfile-v1-pm-migrate-bunfig-save", {
    "package.json": JSON.stringify({ name: "root", dependencies: { dep: "file:./dep" } }),
    "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    "bunfig.toml": "[install.lockfile]\nsave = true\n",
    "package-lock.json": JSON.stringify({ name: "root", lockfileVersion: 3, packages: { "": { name: "root" } } }),
  });
  const lockfilePath = join(String(dir), "bun.lock");

  await using install = spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, installErr, installExit] = await Promise.all([install.stdout.text(), install.stderr.text(), install.exited]);
  expect(installErr).not.toContain("error:");
  expect(installExit).toBe(0);
  const fresh = await file(lockfilePath).text();
  expect(fresh).toContain(`"lockfileVersion": 2,`);
  await Bun.write(lockfilePath, fresh.replace(`"lockfileVersion": 2,`, `"lockfileVersion": 1,`));

  const [, err, exitCode] = await runPm(String(dir), "migrate");
  expect(err).toContain("migrated bun.lock from lockfileVersion 1 to 2");
  expect(err).not.toContain("package-lock.json");
  expect(await file(lockfilePath).text()).toBe(fresh);
  expect(exitCode).toBe(0);
});

it.concurrent("bun pm migrate names the git package with an unsafe bun-tag and keeps version 1", async () => {
  // `bun pm migrate` does no git work, so the host never has to answer.
  const gitUrl = "git+ssh://git@127.0.0.1:1/example/repo.git#main";
  const v1Lockfile = JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: "root", dependencies: { dep: gitUrl } } },
    packages: {
      dep: [`dep@${gitUrl}`, {}, "../escape"],
    },
  });

  using dir = tempDir("lockfile-v1-pm-migrate-git-blocked", {
    "package.json": JSON.stringify({ name: "root", dependencies: { dep: gitUrl } }),
    "bun.lock": v1Lockfile,
  });

  const [out, err, exitCode] = await runPm(String(dir), "migrate");
  expect(err).toContain(
    `error: bun.lock is held at lockfileVersion 1: Invalid git dependency tag: "dep" has "bun-tag": "../escape"\n`,
  );
  expect(err).toContain("note: delete the entry from bun.lock and run 'bun install' to resolve it again\n");
  expect(out).toBe("");
  expect(await file(join(String(dir), "bun.lock")).text()).toBe(v1Lockfile);
  expect(exitCode).toBe(1);
});
