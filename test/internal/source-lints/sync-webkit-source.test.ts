/**
 * `bun sync-webkit-source` (scripts/sync-webkit-source.ts) checks vendor/WebKit
 * out at the commit the pinned prebuilt WebKit was built from. When the pin is
 * an oven-sh/WebKit release name, that commit is the one in the name: the tag
 * object behind the release was, until oven-sh/WebKit#461, created at whatever
 * main's HEAD was when the release job ran (see pinnedCommit). The release-name
 * repos below therefore have their tag pointing at the wrong commit, the way the
 * real ones do; resolving through the tag lands there, resolving the name lands
 * on the commit that was built.
 */
import { $, spawnSync } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { tempDir, tmpdirSync } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

/** An `origin` with one commit and a clone of it; the tests then add to origin what the clone has to fetch. */
function originAndClone(dir: string): { origin: string; clone: string; base: string } {
  const origin = initRepo(join(dir, "origin"));
  const base = commit(origin, "base");
  const clone = join(dir, "clone");
  git(dir, "clone", "-q", origin, clone);
  return { origin, clone, base };
}

/**
 * Pushes to PR 7 on origin, oldest first: commits on top of `base` that only refs/pull/7/head
 * reaches, which is all that is left of them once the PR's branch is gone.
 */
function pushesToPullRequest(origin: string, base: string, names: string[]): string[] {
  git(origin, "checkout", "-q", "--detach", base);
  const pushes = names.map(name => commit(origin, name));
  git(origin, "update-ref", "refs/pull/7/head", pushes[pushes.length - 1]);
  git(origin, "checkout", "-q", "--detach", base);
  return pushes;
}

/** The release name build-preview.yml gives the build of `push` to PR 7. */
function previewTag(push: string): string {
  return `autobuild-preview-pr-7-${push.slice(0, 8)}`;
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
      preview: { shaPrefix: "9203122d", pullRef: "refs/pull/459/head" },
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
    const tag = `autobuild-${built}`;
    git(repo, "tag", tag, landedDuringBuild);
    expect({ tag: tagTarget(repo, tag), head: head(repo) }).toEqual({
      tag: landedDuringBuild,
      head: landedDuringBuild,
    });

    expect(await syncWebKitSource(repo, tag)).toBe(built);
    expect(head(repo)).toBe(built);
  });

  test("a preview tag checks out the PR head it is named after, fetched from the PR ref", async () => {
    using dir = tempDir("sync-webkit-source-preview", {});
    const { origin, clone, base } = originAndClone(String(dir));
    const [prHead] = pushesToPullRequest(origin, base, ["pr-head"]);
    const tag = previewTag(prHead);
    git(clone, "tag", tag, base);
    expect({ tag: tagTarget(clone, tag), head: head(clone) }).toEqual({ tag: base, head: base });

    expect(await syncWebKitSource(clone, tag)).toBe(prHead);
    expect(head(clone)).toBe(prHead);
  });

  test("a preview built from an earlier push of the PR checks out that push, not the PR's current head", async () => {
    using dir = tempDir("sync-webkit-source-preview-earlier-push", {});
    const { origin, clone, base } = originAndClone(String(dir));
    const [firstPush] = pushesToPullRequest(origin, base, ["first-push", "second-push"]);
    const tag = previewTag(firstPush);
    git(clone, "tag", tag, base);

    expect(await syncWebKitSource(clone, tag)).toBe(firstPush);
    expect(head(clone)).toBe(firstPush);
  });

  test("a preview's 8 hex are matched against commit ids, not resolved as a name", async () => {
    using dir = tempDir("sync-webkit-source-preview-shadowed", {});
    const { origin, clone, base } = originAndClone(String(dir));
    const [prHead] = pushesToPullRequest(origin, base, ["pr-head"]);
    const tag = previewTag(prHead);
    git(clone, "tag", tag, base);
    // `git rev-parse <8 hex>` prefers a ref of that name, and a clone that does not have the PR head
    // yet would resolve it without ever fetching. Same shape as an unrelated local commit sharing
    // the 8 hex, which a test cannot arrange on purpose.
    git(clone, "branch", prHead.slice(0, 8), base);
    expect(git(clone, "rev-parse", "--verify", `${prHead.slice(0, 8)}^{commit}`)).toBe(base);

    expect(await syncWebKitSource(clone, tag)).toBe(prHead);
    expect(head(clone)).toBe(prHead);
  });

  test("a preview whose commit the PR no longer has fails rather than checking out the tag", async () => {
    using dir = tempDir("sync-webkit-source-preview-gone", {});
    const { origin, clone, base } = originAndClone(String(dir));
    git(origin, "update-ref", "refs/pull/7/head", base);
    const tag = "autobuild-preview-pr-7-0badc0de";
    git(clone, "tag", tag, base);

    await expect(syncWebKitSource(clone, tag)).rejects.toThrow(
      `no commit starting with 0badc0de (${tag}) in ${clone} even after fetching refs/pull/7/head, whose head is ${base}`,
    );
    expect(head(clone)).toBe(base);
  });

  test("a sha the clone does not have yet is fetched from origin's branches", async () => {
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
