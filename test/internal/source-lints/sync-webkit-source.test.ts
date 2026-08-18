/**
 * `bun sync-webkit-source` (scripts/sync-webkit-source.ts) checks vendor/WebKit
 * out at the commit the pinned prebuilt WebKit was built from. When the pin is
 * an oven-sh/WebKit release name, that commit is the one in the name: the tag
 * object behind the release was, until oven-sh/WebKit#461, created at whatever
 * main's HEAD was when the release job ran (see pinnedCommit). Unless a test says
 * otherwise, the release tags below point at the wrong commit the way the real
 * ones do; resolving through the tag lands there, resolving the name lands on
 * the commit that was built.
 *
 * Clones come in two shapes: a plain clone, and `--depth=1`, which is what a
 * developer cloning a repo the size of WebKit is likely to have and whose only
 * refspec is the tip of one branch; whatever the script fetches has to arrive
 * in both.
 */
import { $, spawnSync } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { tempDir, tmpdirSync } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { pinnedCommit, syncWebKitSource } from "../../../scripts/sync-webkit-source.ts";

// Keep this file's git and the script's git (Bun.$) away from the developer's
// config: signing, hooks, url rewrites. GIT_CONFIG_GLOBAL has to be a real
// file; git on some Windows builds rejects the null device.
const gitConfig = join(tmpdirSync(), "test.gitconfig");
writeFileSync(gitConfig, "[advice]\n\tdetachedHead = false\n");
const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: gitConfig,
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
 * Pushes to PR 7 on origin, oldest first: commits on top of `base` that only refs/pull/7/head
 * reaches, which is all that is left of them once the PR's branch is gone. Calling it again is a
 * force-push: refs/pull/7/head moves to the new commits and stops reaching the earlier ones.
 */
function pushesToPullRequest(origin: string, base: string, names: string[]): string[] {
  git(origin, "checkout", "-q", "--detach", base);
  const pushes = names.map(name => commit(origin, name));
  git(origin, "update-ref", "refs/pull/7/head", pushes[pushes.length - 1]);
  git(origin, "checkout", "-q", "--detach", base);
  return pushes;
}

/** The release name build-preview.yml derives from a push to PR 7. */
function previewName(push: string): string {
  return `autobuild-preview-pr-7-${push.slice(0, 8)}`;
}

/**
 * Publishes the preview release of `built` (a push to PR 7) on origin, tagged at `taggedAt`,
 * which for every release made before oven-sh/WebKit#461 is whatever main's HEAD was rather
 * than `built`.
 */
function publishPreview(origin: string, built: string, taggedAt: string): string {
  const name = previewName(built);
  git(origin, "tag", name, taggedAt);
  return name;
}

describe.concurrent("sync-webkit-source", () => {
  test("pinnedCommit takes the commit from the release name", () => {
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
      preview: {
        shaPrefix: "9203122d",
        pullRef: "refs/pull/459/head",
        tagRef: "refs/tags/autobuild-preview-pr-459-9203122d",
      },
      abbreviatedSha: undefined,
      previewWithoutSha: undefined,
      previewWith7Hex: undefined,
      previewWith9Hex: undefined,
      unknown: undefined,
    });
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

    expect(await syncWebKitSource(repo, name)).toBe(built);
    expect(head(repo)).toBe(built);
  });

  test("a sha the clone does not have yet is fetched from origin", async () => {
    using dir = tempDir("sync-webkit-source-fetch", {});
    const { origin, clone, base } = originAndClone(String(dir));
    const later = commit(origin, "later");
    expect(head(clone)).toBe(base);

    expect(await syncWebKitSource(clone, later)).toBe(later);
    expect(head(clone)).toBe(later);
    // The same commit under its release name is already checked out.
    expect(await syncWebKitSource(clone, `autobuild-${later}`)).toBe(later);
    expect(head(clone)).toBe(later);
  });

  test("a sha behind a depth-1 clone's boundary is fetched without deepening the clone into the whole history", async () => {
    using dir = tempDir("sync-webkit-source-fetch-shallow", {});
    const { origin } = makeOrigin(String(dir));
    const built = commit(origin, "built");
    const tip = commit(origin, "tip");
    const clone = cloneOf(String(dir), origin, "depth-1");
    expect(head(clone)).toBe(tip);

    expect(await syncWebKitSource(clone, `autobuild-${built}`)).toBe(built);
    expect(head(clone)).toBe(built);
    expect(isShallow(clone)).toBe(true);
    expect(git(clone, "rev-list", "--count", built)).toBe("1");
  });

  test("a sha origin does not have fails by name", async () => {
    using dir = tempDir("sync-webkit-source-missing", {});
    const { clone, base } = originAndClone(String(dir));
    const missing = "0badc0de0badc0de0badc0de0badc0de0badc0de";

    await expect(syncWebKitSource(clone, missing)).rejects.toThrow(
      `commit ${missing} (${missing}) is not in ${clone}, and origin did not serve it`,
    );
    expect(head(clone)).toBe(base);
  });

  describe.each<CloneShape>(["full", "depth-1"])("in a %s clone", shape => {
    test("a preview of the PR's head checks it out through the PR ref, whatever its tag points at", async () => {
      using dir = tempDir(`sync-webkit-source-preview-${shape}`, {});
      const { origin, clone, base } = originAndClone(String(dir), shape);
      const [prHead] = pushesToPullRequest(origin, base, ["pr-head"]);
      const name = publishPreview(origin, prHead, base);
      // The clone's own copy of the tag is as wrong as origin's.
      git(clone, "fetch", "-q", "origin", `refs/tags/${name}:refs/tags/${name}`);
      expect({ tag: tagTarget(clone, name), head: head(clone) }).toEqual({ tag: base, head: base });

      expect(await syncWebKitSource(clone, name)).toBe(prHead);
      expect(head(clone)).toBe(prHead);
    });

    test("a preview of an earlier push of the PR checks out that push, not the PR's current head", async () => {
      using dir = tempDir(`sync-webkit-source-preview-earlier-push-${shape}`, {});
      const { origin, clone, base } = originAndClone(String(dir), shape);
      const [firstPush] = pushesToPullRequest(origin, base, ["first-push", "second-push", "third-push"]);
      const name = publishPreview(origin, firstPush, base);

      expect(await syncWebKitSource(clone, name)).toBe(firstPush);
      expect(head(clone)).toBe(firstPush);
    });

    test("a preview of a push the PR replaced is checked out through its tag once the tag points at it", async () => {
      using dir = tempDir(`sync-webkit-source-preview-replaced-push-${shape}`, {});
      const { origin, clone, base } = originAndClone(String(dir), shape);
      const [replacedPush] = pushesToPullRequest(origin, base, ["replaced-push"]);
      pushesToPullRequest(origin, base, ["force-pushed-replacement"]);
      // A tag made after oven-sh/WebKit#461 (or moved to where its name says) is the only ref left reaching the push.
      const name = publishPreview(origin, replacedPush, replacedPush);

      expect(await syncWebKitSource(clone, name)).toBe(replacedPush);
      expect(head(clone)).toBe(replacedPush);
    });
  });

  test("a preview whose release is gone is still checked out through the PR ref", async () => {
    using dir = tempDir("sync-webkit-source-preview-release-gone", {});
    const { origin, clone, base } = originAndClone(String(dir));
    const [prHead] = pushesToPullRequest(origin, base, ["pr-head"]);

    expect(await syncWebKitSource(clone, previewName(prHead))).toBe(prHead);
    expect(head(clone)).toBe(prHead);
  });

  test("a preview's 8 hex are matched against commit ids, not resolved as a name", async () => {
    using dir = tempDir("sync-webkit-source-preview-shadowed", {});
    const { origin, clone, base } = originAndClone(String(dir));
    const [prHead] = pushesToPullRequest(origin, base, ["pr-head"]);
    const name = publishPreview(origin, prHead, base);
    // `git rev-parse <8 hex>` prefers a ref of that name, and a clone that does not have the PR head
    // yet would resolve it without ever fetching. Same shape as an unrelated local commit sharing
    // the 8 hex, which a test cannot arrange on purpose.
    git(clone, "branch", prHead.slice(0, 8), base);
    expect(git(clone, "rev-parse", "--verify", `${prHead.slice(0, 8)}^{commit}`)).toBe(base);

    expect(await syncWebKitSource(clone, name)).toBe(prHead);
    expect(head(clone)).toBe(prHead);
  });

  test("a preview of a replaced push whose tag predates the fix fails rather than checking out the tag", async () => {
    using dir = tempDir("sync-webkit-source-preview-unreachable", {});
    const { origin, clone, base } = originAndClone(String(dir));
    git(origin, "update-ref", "refs/pull/7/head", base);
    const name = "autobuild-preview-pr-7-0badc0de";
    git(origin, "tag", name, base);

    await expect(syncWebKitSource(clone, name)).rejects.toThrow(
      `no commit starting with 0badc0de (${name}) in ${clone}: neither refs/pull/7/head nor refs/tags/${name} on origin reaches one`,
    );
    expect(head(clone)).toBe(base);
  });

  test("a pin that does not name a commit is rejected before anything is fetched or checked out", async () => {
    using dir = tempDir("sync-webkit-source-unknown", {});
    const repo = initRepo(join(String(dir), "repo"));
    const only = commit(repo, "only");
    git(repo, "tag", "autobuild-nightly", only);

    await expect(syncWebKitSource(repo, "autobuild-nightly")).rejects.toThrow(
      'cannot tell which commit WEBKIT_VERSION "autobuild-nightly" was built from',
    );
    expect(head(repo)).toBe(only);
  });
});
