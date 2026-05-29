import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { exists } from "fs/promises";
import { bunExe, bunEnv as env, tempDir } from "harness";
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
  // Point at an unreachable local endpoint (port 1) so that when v1 parsing
  // succeeds and install proceeds to `git clone`, the clone fails fast instead
  // of reaching out to a real host — keeping this test offline.
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
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain("Invalid git dependency tag");
    expect(exitCode).not.toBe(0);
  }

  // version 1 predates the check, so parsing no longer rejects it. Use
  // `--lockfile-only`: the lockfile is still parsed (so the v1 git-tag check is
  // exercised and correctly does not fire), but the command returns before the
  // install phase, so it never reaches the `git clone` of the unreachable repo
  // — which can hang instead of failing fast (notably on macOS).
  {
    using dir = tempDir("lockfile-v1-gittag", {
      "package.json": JSON.stringify({ name: "root", dependencies: { dep: gitUrl } }),
      "bun.lock": lockfile(1),
    });
    await using proc = spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile", "--lockfile-only"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("Invalid git dependency tag");
    // v1 parses cleanly and `--lockfile-only` skips the install, so it exits 0.
    expect(exitCode).toBe(0);
  }
});

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
    "bunfig.toml": `[install.scopes]\nmyorg = { url = "${scopedRegistryUrl}" }\n`,
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
