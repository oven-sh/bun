/**
 * scripts/close-linked-issues.ts runs from .github/workflows/close-linked-issues.yml
 * on every merged PR. It closes the issues and pull requests that the PR's
 * description says it closes, fixes, resolves, supersedes or replaces, which
 * GitHub only does for the first reference after a closing keyword.
 *
 * The first half pins the parser on phrases from real bun PR descriptions. The
 * second half runs the script against a fake GitHub API and checks what it
 * writes.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

import { findLinkedReferences } from "../../scripts/close-linked-issues.ts";

const REPO = "oven-sh/bun";
const SCRIPT = join(import.meta.dir, "../../scripts/close-linked-issues.ts");

/** Same-repo references as numbers, other repositories as "owner/repo#n". */
function refs(body: string): (number | string)[] {
  return findLinkedReferences(body, REPO).map(ref =>
    ref.repository === REPO ? ref.number : `${ref.repository}#${ref.number}`,
  );
}

test.each([
  // what GitHub already handles
  ["Fixes #39852", [39852]],
  ["Closes #31772. Fixes #31771.", [31772, 31771]],
  ["- Fixes #39930", [39930]],
  ["Fixes: #30429", [30429]],
  ["FIXES #1", [1]],
  ["(Fixes #1)", [1]],
  ["**Fixes #1**", [1]],
  ["## Why (fixes #13771, closes #30543)", [13771, 30543]],
  ["Closes https://github.com/oven-sh/bun/issues/11418", [11418]],
  ["Resolves #1. Resolved #2. Resolve #3.", [1, 2, 3]],
  // lists, which GitHub stops after the first entry
  ["Fixes #34055, #30327, #24394, #20816, #32403, #11898, #10056.", [34055, 30327, 24394, 20816, 32403, 11898, 10056]],
  ["Fixes #18192 and #31675 as a consequence", [18192, 31675]],
  ["Fixes #1, #2, and #3", [1, 2, 3]],
  ["Fixes #1 & #2", [1, 2]],
  ["Closes #33280,  Closes #32864 and Closes #29696 (the timer in #32949 is orthogonal)", [33280, 32864, 29696]],
  ["Closes #33182 and #32947 on top of current main (which already has #36304 for catalogs).", [33182, 32947]],
  ["Fixes #1,\n#2", [1, 2]],
  // keywords GitHub does not know
  ["Supersedes #39908 (same change, moved from a fork branch)", [39908]],
  ["Supersedes #38778 and #38391. Carries the entry point arm of #35053.", [38778, 38391]],
  ["Supersedes #39193 and keeps its three tests.", [39193]],
  ["This supersedes #33306 and #32803. Their tests are kept here.", [33306, 32803]],
  ["- This replaces #33793. Its code change landed through #39804.", [33793]],
  ["This PR replaces #37202, which fixed the same two problems.", [37202]],
  ["Replaces #38168 and #38199 (both were stop-gaps against the old pin).", [38168, 38199]],
  ["**node:vm: wall-clock timeout** (supersedes #38495). `timeout` used JSC's `Watchdog`.", [38495]],
  // reference forms
  ["Fixes oven-sh/bun#1", [1]],
  ["Fixes OVEN-SH/Bun#1", [1]],
  ["Fixes other/repo#2", ["other/repo#2"]],
  ["Fixes https://github.com/oven-sh/bun/pull/5#issuecomment-1", [5]],
  ["Fixes https://www.github.com/oven-sh/bun/issues/5/", [5]],
  ["Fixes https://github.com/oven-sh/bun/pull/5/files.", [5]],
  ["Fixes https://github.com/other/repo/issues/6", ["other/repo#6"]],
  ["Fixes [#7](https://github.com/oven-sh/bun/issues/7)", [7]],
  ["Fixes [the crash](https://github.com/oven-sh/bun/issues/8)", [8]],
  ["Fixes [#9](https://example.com/9)", [9]],
  ["Fixes [#1](https://github.com/oven-sh/bun/issues/1), [#2](https://github.com/oven-sh/bun/issues/2)", [1, 2]],
  ["Fixes #1\r\nFixes #2", [1, 2]],
  ["```bun test``` prints nothing.\nFixes #2", [2]],
  ["~~Fixes #1~~ Fixes #2", [2]],
] as [string, (number | string)[]][])("finds %j", (body, expected) => {
  expect(refs(body)).toEqual(expected);
});

test.each([
  // a mention is not a closing statement
  "See #1",
  "Related to #1",
  "Part of #18895. The stack as a whole fixes it; #38281 closes it.",
  "Follow-up to #40002.",
  "Split out of #39548.",
  "Rebase of #39319 (closed as stale)",
  "Adopts #33917 by @someone, rebased onto current main.",
  "Duplicate of #1",
  "Fix for #1",
  "Fixes the wrap half of #27461.",
  "Same gate as #29594, which this supersedes.",
  "#36525 was closed in favor of #34018.",
  "#33828 fixed the same ownership problem on POSIX.",
  "**Closed PRs re-applied**: #35437, #35559.",
  // negated or hedged
  "This does not fix #1",
  "This doesn't fix #1",
  "This doesn’t fix #1",
  "Partially fixes #1",
  "This may fix #1",
  "May also fix #12318 / #10046 (same fd reverse-mapping), untested.",
  "This would fix #1 if the parser were stricter.",
  // the keyword as an adjective or a noun
  "Supersedes the closed #26040.",
  "Flagged by a review comment on closed #35351 (duplicate of merged #35344).",
  "The same helper as the open `rm` fix #37521.",
  "This fix #1 is small.",
  // another reference is the subject
  "#100 supersedes #1",
  "PR #100 fixes #1.",
  "#100 and #101 fix #1",
  // an infinitive says nothing about what the PR does
  "I was unable to fix #1 here.",
  "Decided not to close #1.",
  "How to fix #1: run the test twice.",
  "Changes the parser to fix #1 and #2.",
  // the number is part of a longer word
  "This supersedes #33130's right-sized-copy optimisation.",
  "Fixes #1abc",
  "Fixes C#123",
  "Fixes issue#123",
  "Fixes #0",
  "Fixes #",
  "Fixes 123",
  // not prose
  "`Fixes #1`",
  "``Fixes #1``",
  "```\nFixes #1\n```",
  "~~~sh\nFixes #1\n~~~\n",
  "<!-- Fixes #1 -->",
  "<!-- Fixes #1",
  "> Fixes #1",
  "~~Fixes #1~~",
  "~~~ `sh`\nFixes #1\n~~~",
  // a list does not cross a paragraph break or continue without a separator
  "Closes:\n\n#1",
  // other GitHub URLs
  "Fixes https://github.com/oven-sh/bun/commit/abcdef",
  "Fixes https://github.com/oven-sh/bun/issues/new",
  "Fixes https://github.com/oven-sh/bun",
])("ignores %j", body => {
  expect(refs(body)).toEqual([]);
});

test.each([
  ["Fixes #18895 (together with #39511 and #39513, which land before this).", [18895]],
  [
    "Fixes #31897. Supersedes #31607, which conflicts with main since #30413. Fixes the wrap half of #27461.",
    [31897, 31607],
  ],
  ["Fixes #38675. Also fixes #28019 (same root cause).", [38675, 28019]],
  ["Fixes #24124. Related: #23128 (the `.npmrc` half), supersedes the closed #26040.", [24124]],
  ["Fixes #1, and also #2", [1]],
  ["Fixes #1 #2", [1]],
  ["Fixes #1,\n\n#2", [1]],
  ["Fixes #1,\n- #2", [1]],
  ["Fixes #1 and", [1]],
  ["Fixes #1, #2's sibling", [1]],
  ["Fixes #1\n```\nCloses #2\n```\nCloses #3", [1, 3]],
  ["Fix #1, #2", [1, 2]],
  ["- Fix #1", [1]],
  ["This will fix #1.", [1]],
  ["Adds the flag and fixes #1.", [1]],
] as [string, number[]][])("stops at the right place in %j", (body, expected) => {
  expect(refs(body)).toEqual(expected);
});

test("reports the keyword and the repository", () => {
  expect(findLinkedReferences("Supersedes #1. Fixes other/repo#2.", REPO)).toEqual([
    { repository: REPO, number: 1, keyword: "supersedes" },
    { repository: "other/repo", number: 2, keyword: "fixes" },
  ]);
});

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

/**
 * A GitHub API with one merged PR (#10) and four referenced items: #1 an open
 * issue, #2 an open pull request, #3 a closed issue, #4 nothing. Every write is
 * recorded.
 */
function fakeGitHub(pr: { body: string; merged?: boolean; base?: string }, options: { failPatch?: boolean } = {}) {
  const writes: Recorded[] = [];
  const issues: Record<string, object> = {
    "1": { number: 1, state: "open" },
    "2": { number: 2, state: "open", pull_request: {} },
    "3": { number: 3, state: "closed" },
    "10": { number: 10, state: "closed", pull_request: {} },
  };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const [, owner, repo, resource, number, sub] = pathname.split("/").slice(1);
      if (`${owner}/${repo}` !== REPO) return new Response("wrong repository", { status: 500 });
      if (request.method === "GET") {
        if (resource === "pulls" && number === "10") {
          return Response.json({
            number: 10,
            body: pr.body,
            merged: pr.merged ?? true,
            base: { ref: pr.base ?? "main", repo: { default_branch: "main" } },
          });
        }
        if (resource === "issues" && number in issues && sub === undefined) return Response.json(issues[number]);
        return Response.json({ message: "Not Found" }, { status: 404 });
      }
      writes.push({ method: request.method, path: pathname, body: await request.json() });
      if (options.failPatch && request.method === "PATCH") return new Response("boom", { status: 500 });
      return Response.json({});
    },
  });
  return { origin: server.url.origin, writes, [Symbol.asyncDispose]: () => server.stop(true) };
}

async function runScript(origin: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), SCRIPT],
    env: {
      ...bunEnv,
      GITHUB_TOKEN: "test-token",
      GITHUB_REPOSITORY: REPO,
      GITHUB_API_URL: origin,
      PR_NUMBER: "10",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("closes the open issue and pull request, skips the closed and missing ones", async () => {
  await using fake = fakeGitHub({ body: "Fixes #1, #2 and #3. Supersedes #4. Closes #10. Fixes #1." });
  const { stdout, stderr, exitCode } = await runScript(fake.origin);
  expect(stdout.trim().split("\n")).toEqual([
    "#10: #1, #2, #3, #4",
    "#1: closed issue (fixes in #10)",
    "#2: closed pull request (fixes in #10)",
    "#3: already closed, skipping",
    "#4: does not exist, skipping",
  ]);
  expect(stderr).toBe("");
  expect(fake.writes).toEqual([
    { method: "PATCH", path: "/repos/oven-sh/bun/issues/1", body: { state: "closed", state_reason: "completed" } },
    { method: "POST", path: "/repos/oven-sh/bun/issues/1/comments", body: { body: "Closed as completed by #10." } },
    { method: "PATCH", path: "/repos/oven-sh/bun/pulls/2", body: { state: "closed" } },
    { method: "POST", path: "/repos/oven-sh/bun/issues/2/comments", body: { body: "Superseded by #10." } },
  ]);
  expect(exitCode).toBe(0);
});

test.concurrent("DRY_RUN reads but never writes", async () => {
  await using fake = fakeGitHub({ body: "Fixes #1 and #2" });
  const { stdout, exitCode } = await runScript(fake.origin, { DRY_RUN: "1" });
  expect(stdout).toContain("#1: would close issue (fixes in #10)");
  expect(stdout).toContain("#2: would close pull request (fixes in #10)");
  expect(fake.writes).toEqual([]);
  expect(exitCode).toBe(0);
});

test.concurrent("a PR that is not merged changes nothing", async () => {
  await using fake = fakeGitHub({ body: "Fixes #1", merged: false });
  const { stdout, exitCode } = await runScript(fake.origin);
  expect(stdout).toContain("#10: not merged, nothing to do");
  expect(fake.writes).toEqual([]);
  expect(exitCode).toBe(0);
});

test.concurrent("a PR merged into another branch than the default changes nothing", async () => {
  await using fake = fakeGitHub({ body: "Fixes #1", base: "feature" });
  const { stdout, exitCode } = await runScript(fake.origin);
  expect(stdout).toContain("#10: merged into feature, not main, nothing to do");
  expect(fake.writes).toEqual([]);
  expect(exitCode).toBe(0);
});

test.concurrent("a PR whose description closes nothing changes nothing", async () => {
  await using fake = fakeGitHub({ body: "See #1 and #2." });
  const { stdout, exitCode } = await runScript(fake.origin);
  expect(stdout).toContain("#10: no references to close");
  expect(fake.writes).toEqual([]);
  expect(exitCode).toBe(0);
});

test.concurrent("a failed close fails the run after the other references were tried", async () => {
  await using fake = fakeGitHub({ body: "Fixes #1 and #2" }, { failPatch: true });
  const { stderr, exitCode } = await runScript(fake.origin);
  expect(stderr).toContain("#1: Error: PATCH /issues/1 failed: 500");
  expect(stderr).toContain("#2: Error: PATCH /pulls/2 failed: 500");
  expect(fake.writes.map(write => write.path)).toEqual(["/repos/oven-sh/bun/issues/1", "/repos/oven-sh/bun/pulls/2"]);
  expect(exitCode).toBe(1);
});
