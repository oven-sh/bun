/**
 * `bun sync-webkit-source` (scripts/sync-webkit-source.ts) checks vendor/WebKit
 * out at the commit the pinned prebuilt WebKit was built from. That commit is
 * the one in the release's name (and, for a preview, which names only 8 hex of
 * it, the one recorded inside the downloaded prebuilt), never the one the
 * release's tag points at: until oven-sh/WebKit#461 the tag was created at
 * whatever main's HEAD was when the release job ran. The release tags below
 * therefore point at the wrong commit, the way the real ones do; resolving
 * through the tag lands there.
 *
 * Clones come in two shapes: the plain clone CONTRIBUTING.md describes, and a
 * `--depth=1` clone, which nothing recommends but which exists (a repo this size
 * invites it) and whose only refspec is the tip of one branch; the pinned commit
 * has to arrive in both, and a clone that already has it must not be touched.
 */
import { $, spawnSync } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { tempDir, tmpdirSync } from "harness";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { commitOfDownloadedPrebuilt, pinnedCommit, syncWebKitSource } from "../../../scripts/sync-webkit-source.ts";

// Keep this file's git and the script's git (Bun.$) away from the developer's
// config (signing, hooks, url rewrites) and from any repository the temp dir
// happens to live under. GIT_CONFIG_GLOBAL has to be a real file; git on some
// Windows builds rejects the null device.
const scratch = tmpdirSync();
const gitConfig = join(scratch, "test.gitconfig");
writeFileSync(gitConfig, "[advice]\n\tdetachedHead = false\n");
const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: gitConfig,
  GIT_CEILING_DIRECTORIES: dirname(scratch),
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};
$.env(gitEnv);
afterAll(() => $.env(undefined));

function git(cwd: string, ...args: string[]): string {
  const res = spawnSync({ cmd: ["git", ...args], cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
  if (!res.success) throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${res.stderr.toString()}`);
  return res.stdout.toString().trim();
}

function head(repo: string): string {
  return git(repo, "rev-parse", "HEAD");
}

function tagTarget(repo: string, tag: string): string {
  return git(repo, "rev-parse", `${tag}^{commit}`);
}

function isShallow(repo: string): boolean {
  return git(repo, "rev-parse", "--is-shallow-repository") === "true";
}

/** Adds a commit touching `name` and returns its sha. */
function commit(repo: string, name: string): string {
  writeFileSync(join(repo, name), name);
  git(repo, "add", name);
  git(repo, "commit", "-q", "-m", name);
  return head(repo);
}

function initRepo(repo: string): string {
  mkdirSync(repo);
  git(repo, "init", "-q");
  return repo;
}

/** An `origin` whose branch has one commit, `base`; the tests add to it whatever the clone has to fetch. */
function makeOrigin(dir: string): { origin: string; base: string } {
  const origin = initRepo(join(dir, "origin"));
  return { origin, base: commit(origin, "base") };
}

type CloneShape = "full" | "depth-1";

function cloneOf(dir: string, origin: string, shape: CloneShape): string {
  const clone = join(dir, "clone");
  // git ignores --depth for a path; a file:// URL goes through the transport that honors it.
  if (shape === "depth-1") git(dir, "clone", "-q", "--depth=1", pathToFileURL(origin).href, clone);
  else git(dir, "clone", "-q", origin, clone);
  expect(isShallow(clone)).toBe(shape === "depth-1");
  return clone;
}

function originAndClone(dir: string, shape: CloneShape = "full"): { origin: string; clone: string; base: string } {
  const { origin, base } = makeOrigin(dir);
  return { origin, clone: cloneOf(dir, origin, shape), base };
}

/**
 * A push to PR 7 on origin: a commit on top of `base` that only refs/pull/7/head reaches, which
 * is all that is left of it once the PR's branch is gone. Pushing again replaces it: the ref
 * moves to the new commit and the earlier one is reachable from nothing.
 */
function pushToPullRequest(origin: string, base: string, name: string): string {
  git(origin, "checkout", "-q", "--detach", base);
  const push = commit(origin, name);
  git(origin, "update-ref", "refs/pull/7/head", push);
  git(origin, "checkout", "-q", "--detach", base);
  return push;
}

/** The release name build-preview.yml derives from a push to PR 7, with its tag on origin created the way GitHub created them before oven-sh/WebKit#461: at main's HEAD. */
function publishPreview(origin: string, push: string, mainHead: string): string {
  const name = `autobuild-preview-pr-7-${push.slice(0, 8)}`;
  git(origin, "tag", name, mainHead);
  expect(tagTarget(origin, name)).toBe(mainHead);
  return name;
}

/**
 * A build cache holding one extracted prebuilt of `version`, recording `builtFrom` the way
 * oven-sh/WebKit's release scripts append it to the tarball's cmakeconfig.h.
 */
function cacheWithPrebuilt(dir: string, version: string, builtFrom: string): string {
  const cacheDir = join(dir, "build-cache");
  const include = join(cacheDir, `webkit-${version.replace(/^autobuild-/, "")}-debug-asan`, "include");
  mkdirSync(include, { recursive: true });
  writeFileSync(
    join(include, "cmakeconfig.h"),
    `#define ENABLE_FTL_JIT 1\n#define USE_BUN_JSC_ADDITIONS 1\n#define BUN_WEBKIT_VERSION "${builtFrom}"\n`,
  );
  return cacheDir;
}

/** The message a sync is expected to fail with (several assertions on one message, so the sync runs once). */
function failureOf(sync: Promise<string>): Promise<string> {
  return sync.then(
    sha => `resolved to ${sha} instead of failing`,
    (error: Error) => error.message,
  );
}

/** A build cache nothing has been downloaded into. */
function emptyCache(dir: string): string {
  const cacheDir = join(dir, "build-cache");
  mkdirSync(cacheDir);
  return cacheDir;
}

describe.concurrent("sync-webkit-source", () => {
  test("pinnedCommit reads the release name", () => {
    const sha = "781d6abb94b9eaee825e95ef700a83d8cf576f55";
    expect({
      sha: pinnedCommit(sha),
      main: pinnedCommit(`autobuild-${sha}`),
      preview: pinnedCommit("autobuild-preview-pr-459-9203122d"),
      abbreviatedSha: pinnedCommit(sha.slice(0, 12)),
      previewWithoutSha: pinnedCommit("autobuild-preview-pr-459"),
      // build-preview.yml names previews after exactly the first 8 hex of the head.
      previewWith7Hex: pinnedCommit("autobuild-preview-pr-459-9203122"),
      previewWith9Hex: pinnedCommit("autobuild-preview-pr-459-9203122d6"),
      unknown: pinnedCommit("autobuild-nightly"),
    }).toEqual({
      sha: { sha },
      main: { sha },
      preview: { shaPrefix: "9203122d", prebuiltKey: "preview-pr-459-9203122d" },
      abbreviatedSha: undefined,
      previewWithoutSha: undefined,
      previewWith7Hex: undefined,
      previewWith9Hex: undefined,
      unknown: undefined,
    });
  });

  test("commitOfDownloadedPrebuilt reads BUN_WEBKIT_VERSION out of whichever variant was downloaded", () => {
    using dir = tempDir("sync-webkit-source-cache", {});
    const builtFrom = "9203122d6ea77efaa415f6dcf116f8cecfea88f0";
    const cacheDir = cacheWithPrebuilt(String(dir), "autobuild-preview-pr-459-9203122d", builtFrom);
    expect({
      downloaded: commitOfDownloadedPrebuilt(cacheDir, "preview-pr-459-9203122d"),
      otherPush: commitOfDownloadedPrebuilt(cacheDir, "preview-pr-459-b5fc3025"),
      noCacheAtAll: commitOfDownloadedPrebuilt(join(String(dir), "never-built"), "preview-pr-459-9203122d"),
    }).toEqual({ downloaded: builtFrom, otherPush: undefined, noCacheAtAll: undefined });
  });

  test("autobuild-<sha> checks out <sha>, not the commit its tag points at", async () => {
    using dir = tempDir("sync-webkit-source-main", {});
    const repo = initRepo(join(String(dir), "repo"));
    const built = commit(repo, "built");
    const landedDuringBuild = commit(repo, "landed-during-build");
    const name = `autobuild-${built}`;
    git(repo, "tag", name, landedDuringBuild);
    expect({ tag: tagTarget(repo, name), head: head(repo) }).toEqual({
      tag: landedDuringBuild,
      head: landedDuringBuild,
    });

    expect(await syncWebKitSource(repo, name, emptyCache(String(dir)))).toBe(built);
    expect(head(repo)).toBe(built);
  });

  test("a sha the clone does not have yet is fetched from origin", async () => {
    using dir = tempDir("sync-webkit-source-fetch", {});
    const { origin, clone, base } = originAndClone(String(dir));
    const cacheDir = emptyCache(String(dir));
    const later = commit(origin, "later");
    expect(head(clone)).toBe(base);

    expect(await syncWebKitSource(clone, later, cacheDir)).toBe(later);
    expect(head(clone)).toBe(later);
    // The same commit under its release name is already checked out.
    expect(await syncWebKitSource(clone, `autobuild-${later}`, cacheDir)).toBe(later);
    expect(head(clone)).toBe(later);
  });

  test("a sha behind a depth-1 clone's boundary is fetched without deepening the clone into the whole history", async () => {
    using dir = tempDir("sync-webkit-source-fetch-shallow", {});
    const { origin } = makeOrigin(String(dir));
    const built = commit(origin, "built");
    const tip = commit(origin, "tip");
    const clone = cloneOf(String(dir), origin, "depth-1");
    expect(head(clone)).toBe(tip);

    expect(await syncWebKitSource(clone, `autobuild-${built}`, emptyCache(String(dir)))).toBe(built);
    expect(head(clone)).toBe(built);
    expect(isShallow(clone)).toBe(true);
    expect(git(clone, "rev-list", "--count", built)).toBe("1");
  });

  test("a sha origin does not have fails with git saying so", async () => {
    using dir = tempDir("sync-webkit-source-missing", {});
    const { clone, base } = originAndClone(String(dir));
    const missing = "0badc0de0badc0de0badc0de0badc0de0badc0de";

    const failure = await failureOf(syncWebKitSource(clone, missing, emptyCache(String(dir))));
    expect(failure).toStartWith(
      `commit ${missing} (${missing}) is not in ${clone}, and fetching it from origin failed:\n`,
    );
    expect(failure).toContain(`not our ref ${missing}`);
    expect(head(clone)).toBe(base);
  });

  test("an origin that cannot be reached is reported as that, not as a missing commit", async () => {
    using dir = tempDir("sync-webkit-source-unreachable-origin", {});
    const { origin, clone, base } = originAndClone(String(dir));
    const later = commit(origin, "later");
    git(clone, "remote", "set-url", "origin", join(String(dir), "no-such-origin"));

    const failure = await failureOf(syncWebKitSource(clone, later, emptyCache(String(dir))));
    expect(failure).toStartWith(`commit ${later} (${later}) is not in ${clone}, and fetching it from origin failed:\n`);
    expect(failure).toContain("does not appear to be a git repository");
    expect(head(clone)).toBe(base);
  });

  describe.each<CloneShape>(["full", "depth-1"])("in a %s clone", shape => {
    test("a preview checks out the commit its downloaded prebuilt was built from, not the commit its tag points at", async () => {
      using dir = tempDir(`sync-webkit-source-preview-${shape}`, {});
      const { origin, clone, base } = originAndClone(String(dir), shape);
      const push = pushToPullRequest(origin, base, "pr-head");
      const name = publishPreview(origin, push, base);
      const cacheDir = cacheWithPrebuilt(String(dir), name, push);

      expect(await syncWebKitSource(clone, name, cacheDir)).toBe(push);
      expect(head(clone)).toBe(push);
      expect(isShallow(clone)).toBe(shape === "depth-1");
    });

    test("a commit the clone already has is checked out without fetching", async () => {
      using dir = tempDir(`sync-webkit-source-local-${shape}`, {});
      const { origin, base } = makeOrigin(String(dir));
      const tip = commit(origin, "tip");
      const clone = cloneOf(String(dir), origin, shape);
      // A depth-1 clone has only the tip; fetching it again with --depth=1 would re-shallow the clone at it.
      const wanted = shape === "depth-1" ? tip : base;

      expect(await syncWebKitSource(clone, `autobuild-${wanted}`, emptyCache(String(dir)))).toBe(wanted);
      // Any fetch, even one that brought nothing, leaves FETCH_HEAD behind.
      expect({ head: head(clone), fetched: existsSync(join(clone, ".git", "FETCH_HEAD")) }).toEqual({
        head: wanted,
        fetched: false,
      });
    });
  });

  test("a repo that was only initialized and pointed at origin gets the commit too", async () => {
    using dir = tempDir("sync-webkit-source-initialized", {});
    const { origin, base } = makeOrigin(String(dir));
    const repo = initRepo(join(String(dir), "repo"));
    git(repo, "remote", "add", "origin", origin);

    expect(await syncWebKitSource(repo, base, emptyCache(String(dir)))).toBe(base);
    expect(head(repo)).toBe(base);
  });

  test("when git itself fails, its explanation is what the error says", async () => {
    using dir = tempDir("sync-webkit-source-not-a-repo", {});
    const notARepo = join(String(dir), "vendor-webkit");
    mkdirSync(notARepo);

    await expect(
      syncWebKitSource(notARepo, "781d6abb94b9eaee825e95ef700a83d8cf576f55", emptyCache(String(dir))),
    ).rejects.toThrow("not a git repository");
  });

  test("a preview of a push the PR has since replaced is still checked out", async () => {
    using dir = tempDir("sync-webkit-source-preview-replaced", {});
    const { origin, clone, base } = originAndClone(String(dir));
    // GitHub serves a commit by id for as long as it has the object, reachable or not; this is the
    // upload-pack setting that makes a local origin behave the same way.
    git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
    const replaced = pushToPullRequest(origin, base, "replaced-push");
    pushToPullRequest(origin, base, "replacement");
    expect(git(origin, "for-each-ref", "--contains", replaced)).toBe("");
    const name = publishPreview(origin, replaced, base);
    const cacheDir = cacheWithPrebuilt(String(dir), name, replaced);

    expect(await syncWebKitSource(clone, name, cacheDir)).toBe(replaced);
    expect(head(clone)).toBe(replaced);
  });

  test("a preview whose prebuilt has not been downloaded says what to do, rather than guessing from the tag", async () => {
    using dir = tempDir("sync-webkit-source-preview-not-downloaded", {});
    const { origin, clone, base } = originAndClone(String(dir));
    const name = publishPreview(origin, pushToPullRequest(origin, base, "pr-head"), base);
    const cacheDir = emptyCache(String(dir));

    await expect(syncWebKitSource(clone, name, cacheDir)).rejects.toThrow(
      `${name} names only the first 8 hex of its commit; the full sha is read from the downloaded prebuilt, and there is none under ${cacheDir}`,
    );
    expect(head(clone)).toBe(base);
  });

  test("a downloaded prebuilt that was not built from the commit in the name is refused", async () => {
    using dir = tempDir("sync-webkit-source-preview-mismatch", {});
    const { origin, clone, base } = originAndClone(String(dir));
    const push = pushToPullRequest(origin, base, "pr-head");
    const name = publishPreview(origin, push, base);
    const cacheDir = cacheWithPrebuilt(String(dir), name, base);

    await expect(syncWebKitSource(clone, name, cacheDir)).rejects.toThrow(
      `the prebuilt under ${cacheDir} for ${name} was built from ${base}, which is not the commit in the name`,
    );
    expect(head(clone)).toBe(base);
  });

  test("a pin that does not name a commit is rejected before anything is fetched or checked out", async () => {
    using dir = tempDir("sync-webkit-source-unknown", {});
    const repo = initRepo(join(String(dir), "repo"));
    const only = commit(repo, "only");
    git(repo, "tag", "autobuild-nightly", only);

    await expect(syncWebKitSource(repo, "autobuild-nightly", emptyCache(String(dir)))).rejects.toThrow(
      'cannot tell which commit WEBKIT_VERSION "autobuild-nightly" was built from',
    );
    expect(head(repo)).toBe(only);
  });
});
