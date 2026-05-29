import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { exists } from "fs/promises";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { join } from "path";

// These tests cover the text lockfile bump to version 2 and the parse-time
// checks gated behind it. They use `file:` dependencies so they run fully
// offline (no registry required).

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

  // version 1 predates the check, so parsing no longer rejects it (the install
  // then fails cloning the unreachable repo, but not with the parse-time error).
  {
    using dir = tempDir("lockfile-v1-gittag", {
      "package.json": JSON.stringify({ name: "root", dependencies: { dep: gitUrl } }),
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
    expect(err).not.toContain("Invalid git dependency tag");
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
