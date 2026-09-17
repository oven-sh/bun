/**
 * .github/workflows/close-linked-issues.yml runs on every merged PR. Its inline
 * github-script closes the issues and pull requests that the PR's description
 * says it closes, fixes, resolves, supersedes or replaces, which GitHub only
 * does for the first reference after a closing keyword.
 *
 * The script lives in the workflow file, so this test reads it out of the YAML
 * and runs it the way actions/github-script does: as the body of an async
 * function with `github`, `context` and `core` in scope, here all fakes. The
 * first half pins the parser on phrases from real bun PR descriptions, the
 * second half checks what the script writes.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW = join(import.meta.dir, "../../.github/workflows/close-linked-issues.yml");
const REPO = { owner: "oven-sh", repo: "bun" };
const PR = 10;

const source = (() => {
  const workflow = Bun.YAML.parse(readFileSync(WORKFLOW, "utf8")) as {
    jobs: Record<string, { steps: { uses?: string; with?: { script?: string } }[] }>;
  };
  const step = workflow.jobs["close-linked-issues"].steps.find(step => step.uses?.startsWith("actions/github-script"));
  return step!.with!.script!;
})();
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (github: unknown, context: unknown, core: unknown) => Promise<void>;
const script = new AsyncFunction("github", "context", "core", source);

interface Call {
  method: string;
  params: Record<string, unknown>;
}

interface Options {
  /** The description in the merge event (or, for a manual run, the one the API returns). */
  body: string;
  /** What `pulls.get` returns as the description. Defaults to `body`. */
  apiBody?: string;
  merged?: boolean;
  base?: string;
  /** `workflow_dispatch` inputs. Without them the run comes from a `pull_request_target` event. */
  inputs?: Record<string, string>;
  /** Every number is an open issue (for parser cases). Otherwise: #1 open issue, #2 open PR, #3 closed, #4 missing, #5 deleted. */
  everyIssueOpen?: boolean;
  failUpdate?: boolean;
  failComment?: boolean;
  /** `issues.get` fails with a 500 for this number. */
  failGet?: number;
}

const notFound = () => Object.assign(new Error("Not Found"), { status: 404 });
const gone = () => Object.assign(new Error("Gone"), { status: 410 });
const serverError = () => Object.assign(new Error("boom"), { status: 500 });

/** Runs the script against a fake API for PR #10 and records what it does. */
async function run(options: Options) {
  const calls: Call[] = [];
  const logs: string[] = [];
  let failed: string | null = null;
  const issues: Record<number, object> = {
    1: { number: 1, state: "open" },
    2: { number: 2, state: "open", pull_request: {} },
    3: { number: 3, state: "closed" },
    [PR]: { number: PR, state: "closed", pull_request: {} },
  };
  const write = (method: string) => async (params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (options.failUpdate && method.endsWith("update")) throw new Error("boom");
    if (options.failComment && method === "issues.createComment") throw new Error("locked");
    return { data: {} };
  };
  const github = {
    rest: {
      pulls: {
        get: async ({ pull_number }: { pull_number: number }) => {
          if (pull_number !== PR) throw notFound();
          return {
            data: {
              number: PR,
              body: options.apiBody ?? options.body,
              merged: options.merged ?? true,
              base: { ref: options.base ?? "main", repo: { default_branch: "main" } },
            },
          };
        },
        update: write("pulls.update"),
      },
      issues: {
        get: async ({ issue_number }: { issue_number: number }) => {
          if (issue_number === options.failGet) throw serverError();
          if (options.everyIssueOpen) return { data: { number: issue_number, state: "open" } };
          if (issue_number === 5) throw gone();
          if (!(issue_number in issues)) throw notFound();
          return { data: issues[issue_number] };
        },
        update: write("issues.update"),
        createComment: write("issues.createComment"),
      },
    },
  };
  const context = {
    repo: REPO,
    payload: options.inputs ? { inputs: options.inputs } : { pull_request: { number: PR, body: options.body } },
  };
  const core = {
    info: (message: string) => logs.push(message),
    warning: (message: string) => logs.push(`warning: ${message}`),
    error: (message: string) => logs.push(`error: ${message}`),
    setFailed: (message: string) => {
      failed = message;
    },
  };
  await script(github, context, core);
  return { calls, logs, failed: failed as string | null };
}

/** Closed same-repo numbers in order, then other-repository references as "owner/repo#n". */
async function refs(body: string): Promise<(number | string)[]> {
  const { calls, logs } = await run({ body, everyIssueOpen: true });
  const closed = calls.filter(call => call.method === "issues.update").map(call => call.params.issue_number as number);
  const suffix = ": another repository, skipping";
  const foreign = logs.filter(log => log.endsWith(suffix)).map(log => log.slice(0, -suffix.length));
  return [...closed, ...foreign];
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
  ["__Fixes #1__", [1]],
  ["_Fixes #1_", [1]],
  ["Fixes **#1**", [1]],
  ["**Fixes** #1", [1]],
  ["**Fixes:** #1", [1]],
  ["Fixes #1 and **#2**", [1, 2]],
  ["Fixes **#1**, **#2**", [1, 2]],
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
  ["Fixes #1, #2,\nand #3", [1, 2, 3]],
  ["Fixes #1\nand #2", [1, 2]],
  ["Fixes #1\n& #2", [1, 2]],
  ["Fixes #1 and\n#2", [1, 2]],
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
  ["Fixes <https://github.com/oven-sh/bun/issues/1>", [1]],
  ["Fixes <https://github.com/oven-sh/bun/issues/1> and <https://github.com/oven-sh/bun/issues/2>.", [1, 2]],
  ["Fixes #1\r\nFixes #2", [1, 2]],
  ["```bun test``` prints nothing.\nFixes #2", [2]],
  ["~~Fixes #1~~ Fixes #2", [2]],
  ["The `--foo option is broken.\n\nFixes #1234.\n\nUses `Bun.serve()` now.", [1234]],
  ["Reverts HEAD~~ which broke CI.\n\nFixes #1234.\n\nAlso see abc~~ for context.", [1234]],
  ["Adds a retry to the loader\nFix #1", [1]],
  ["This will\nfix #1", [1]],
  ["* Fixes #1", [1]],
  ["Fixes #1 *and* fixes #2", [1, 2]],
  ["Adds a placeholder:\n```html\n<!-- TODO: wire this up\n```\n\nFixes #1234 and #5678", [1234, 5678]],
  ["> <!-- Please describe\n\nFixes #1234", [1234]],
  ["<!--\n```\n-->\nFixes #1", [1]],
  ["Intro <!-- note --> Fixes #1", [1]],
  ["paste <!-- log -->\n    abc123 Fixes #1234", [1234]],
  ["Fixes #1 <!-- issue number -->", [1]],
  ["<!-->\nFixes #1", [1]],
  ["<!--->\nFixes #1", [1]],
  ["Handles `<!--` in templates. Fixes #1234 and #5678.", [1234, 5678]],
  ["Handles `<!--` in HTML.\nFixes #1234.\nAlso handles `-->` correctly.", [1234]],
  ["We have fixed #1.", [1]],
  ["We fix #1.", [1]],
  ["Here we fix #1.", [1]],
  ["Note that this fixes #1.", [1]],
  ["This PR fixes #1.", [1]],
  ["This code fixes #1.", [1]],
  ["When merged, this fixes #1.", [1]],
  ["Hopefully the tests agree. Fixes #1.", [1]],
  ["Title\n===\nFixes #1", [1]],
  ["Repro from the log:\n\n    abc123 Fixes #1234: handle null\n\nFixes #5678", [5678]],
  ["> quoted\n\nFixes #1", [1]],
  ["> quoted\n- Fixes #1", [1]],
  ["> quoted\n## Fixes #1", [1]],
  ["> quoted\n1. Fixes #1", [1]],
  ["> quoted\n-\tFixes #1", [1]],
  ["> ```\n> code\nFixes #1", [1]],
  ["> ```\n> code\n> ```\nFixes #1", [1]],
  ["Fix\n    ===\n    abc123 Fixes #1234", [1234]],
  ["Fix\n    # heading\n    abc123 Fixes #1234", [1234]],
  ["<!-- old\n--> ```\nFixes #1\n```", [1]],
  ["<!-- old\n--> > Fixes #1", [1]],
  ["<!-- old\nplan\n-->    Fixes #1234", [1234]],
  ["para\n    > text\nFixes #1", [1]],
  ["para\n    > Fixes #1", [1]],
  [">    ```\n> Reviewer wrote this\nFixes #1", [1]],
  ["text <!-- note\nFixes #1", [1]],
  ["The parser now handles <!-- in templates. Fixes #1", [1]],
  ["text <!-- note\n--> more\n    Fixes #1234", [1234]],
  ["para\n    <!-- x --> text\n    Fixes #1234", [1234]],
  ["> <!-- x -->\nFixes #1", [1]],
  ["> <!-- x\nFixes #1", [1]],
  ["> <!-- comment\n> more -->\nFixes #1", [1]],
  ["~~old\n# New\nFixes #1~~", [1]],
  ["~~old\n===\nFixes #1~~", [1]],
  ["~~old\n***\nFixes #1~~", [1]],
  ["`code\n# Head\nFixes #1`", [1]],
  ["**#100**\nfixes #1", [1]],
  ["text <!-- note\nFixes #1\n\n--> arrow", [1]],
  ["text <!-- note\nFixes #1\n\n```\n-->\n```", [1]],
  [">\t\tcode\nFixes #1", [1]],
  [" >  \ttext\nFixes #1", [1]],
  ["text <!-- note\nFixes #1\n```\n-->\n```", [1]],
  ["text <!-- note\nFixes #1\n> more -->", [1]],
  ["text <!-- note\nFixes #1\n# heading -->", [1]],
  ["text <!-- note\nFixes #1\n---\n-->", [1]],
  ["<!-- old\n--> ~~text\nFixes #1~~", [1]],
  ["A change (see below) that fixes #1.", [1]],
  ["Some text\n    Fixes #1", [1]],
  ["---\nFixes #1", [1]],
  ["```\ncode\n   ```\nFixes #1", [1]],
  ["<s>Fixes #1</s> Fixes #2", [2]],
  ["<s>old\n\nFixes #1", [1]],
  ["İİ notes. <s>old plan</s> Fixes #100", [100]],
  ["Bump ~1.2 to ~1.3, fixes #1", [1]],
  ["~Fixes #1~", [1]],
  ["Reverts abc123~1. Fixes #1234. See def456~2.", [1234]],
  ["> quoted\n<!-- note -->\nFixes #1", [1]],
  ["The `rm` fix #37521 and `ls`.", []],
  ["<section>Fixes #1</section>", [1]],
  ["para\n    ```\nFixes #1\n```", [1]],
  ["> quoted\n---\nFixes #1", [1]],
  ["> # Old plan\nFixes #1", [1]],
  ["> Fix\n> ===\nFixes #1", [1]],
  ["> Fix\n> --\nFixes #1", [1]],
  ["> ---\nFixes #1", [1]],
  [">\nFixes #1", [1]],
  ["> quoted\n***\nFixes #1", [1]],
] as [string, (number | string)[]][])("finds %j", async (body, expected) => {
  expect(await refs(body)).toEqual(expected);
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
  "This does not\nfix #1",
  "This may also\nfix #1",
  "partially\nfixes #1",
  "This hasn't fixed #1 yet.",
  "This PR neither fixes #1 nor closes #2.",
  "That would have fixed #1, but it was reverted.",
  "This wouldn't have fixed #1.",
  "This may have fixed #1.",
  "#100 has fixed #1.",
  "#100 has\nfixed #1.",
  "#100 also\nfixes #1.",
  "Hopefully this fixes #1.",
  "Hopefully, this fixes #1.",
  "Maybe this PR replaces #1.",
  "Probably will fix #1.",
  "Could this fix #1?",
  "Most likely this fixes #1.",
  "Perhaps this fixes #1.",
  "Perhaps fixes #1.",
  // a condition or a time, not a statement
  "Once we fix #1, this can land.",
  "Until we fix #1, this stays disabled.",
  "If this fixes #1, the crash goes away.",
  "Unless we replace #1, keep the shim.",
  "When they have fixed #1 this will work.",
  "Once we\nfix #1, this can land.",
  "If this PR fixes #1, the crash goes away.",
  "Not sure whether this fixes #1.",
  "Check whether this PR fixes #1.",
  "Once the change fixes #1, this can land.",
  "Unless this PR replaces #1, keep the shim.",
  "If\nthis fixes #1, the crash goes away.",
  "If `bun install` fixes #1, we can close it.",
  "Check whether `bun test` fixes #1.",
  "Unless ~~this~~ fixes #1, keep the shim.",
  // the keyword as an adjective or a noun
  "Supersedes the closed #26040.",
  "Flagged by a review comment on closed #35351 (duplicate of merged #35344).",
  "The same helper as the open `rm` fix #37521.",
  "This fix #1 is small.",
  // another reference is the subject
  "#100 supersedes #1",
  "PR #100 fixes #1.",
  "#100 and #101 fix #1",
  "Reverts #100 which fixed #1.",
  "Depends on #100, which fixes #1.",
  "Stacked on #100 that resolves #1.",
  "Reverts #100, which\nfixed #1.",
  "Depends on #100,\nwhich fixes #1.",
  "Reverts #100 (which fixed #1).",
  "Reverts #100 \u2014 which fixed #1.",
  "Reverts #100 -- which fixed #1.",
  "Reverts #100; which fixed #1.",
  "Reverts #100 \u2013\nwhich fixed #1.",
  "Reverts #100 ~~and #101~~, which fixed #1.",
  "Reverts #100 `old`, which fixed #1.",
  "Reverts #100 <!-- note -->, which fixed #1.",
  "Reverts #100 entirely, which fixed #1.",
  "Reverts #100 (the old approach), which fixed #1.",
  "Depends on #100 (WIP), which fixes #1.",
  "Reverts #100 [note], which fixed #1.",
  "Reverts #100 (#200), which fixed #1.",
  "text <!-- note\n--> ~~more\nFixes #1~~",
  "text <!-- note\nFixes #1\nmore -->",
  "#100 **also** fixes #1",
  "#100 **also**\nfixes #1",
  "Does not *really* fix #1",
  "May *also* fix #1",
  "Reverts #100, which **actually** fixed #1.",
  "~~old\nFixes #1~~",
  "[#100](https://github.com/oven-sh/bun/pull/100) supersedes #1",
  "See [#100](https://github.com/oven-sh/bun/pull/100), which fixed #1.",
  "(#100) fixes #1",
  "**#100** fixes #1",
  "<https://github.com/oven-sh/bun/pull/100> supersedes #1",
  "See <https://github.com/oven-sh/bun/pull/100>, which fixed #1.",
  "#100 ~~also~~ fixes #1",
  "#100 `also` fixes #1",
  "#100 <s>also</s> fixes #1",
  "Reverts #100, which ~~partially~~ fixed #1.",
  // an infinitive says nothing about what the PR does
  "I was unable to fix #1 here.",
  "Decided not to close #1.",
  "How to fix #1: run the test twice.",
  "Changes the parser to fix #1 and #2.",
  "I was unable to\nfix #1.",
  // the number is part of a longer word
  "This supersedes #33130's right-sized-copy optimisation.",
  "Fixes #1abc",
  "Fixes #1_foo",
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
  "> does not\nfix #1",
  "> quoted\n> more\nFixes #1",
  "    Fixes #1",
  "Log:\n\n    abc123 Fixes #1\n    def456 Fixes #2",
  "Log:\n\n  \tabc123 Fixes #1234",
  "```\n$ bun test\n```\n    ✓ Fixes #1234 (5ms)",
  "## Fix\n    abc123 Fixes #1234",
  "---\n    abc123 Fixes #1234",
  "Fix\n===\n    abc123 Fixes #1234",
  "Fix\n--\n    abc123 Fixes #1234",
  "* * *\n    abc123 Fixes #1234",
  "<!-- paste the log below -->\n    abc123 Fixes #1234",
  "<!-- a\nb -->\n    abc123 Fixes #1234",
  "```sh\necho hi\n    ```\nFixes #1234\n```",
  "> quoted\n#100 has the details. Fixes #1.",
  "> quoted\n**Fixes #1**",
  "> quoted\n2. Fixes #1",
  "> quoted\n-\nFixes #1",
  "> quoted\n+\nFixes #1",
  "> quoted\n1.\nFixes #1",
  "> quoted\n    - Fixes #1",
  "> ```\n> code\n> ```\n> more\nFixes #1",
  "<!-- old\n--> intro\n    abc123 Fixes #1234",
  "<!-- log below --> paste here\n    abc123 Fixes #1234",
  ">     ```\n> Reviewer wrote this\nFixes #1",
  ">\tReviewer said\nFixes #1",
  "> \tReviewer said\nFixes #1",
  "   >   \ttext\nFixes #1",
  "text <!-- note\nFixes #1 -->\nmore",
  "> <!-- x -->\n> quoted\nFixes #1",
  "   <!-- log --> paste\n    abc123 Fixes #1234",
  "~~Fixes #1~~",
  "<s>Fixes #1</s>",
  "See `note\nFixes #1234` and `done",
  "<DEL>Fixes #1</DEL>",
  "İİİİİİİİİİİİİ <s>Fixes #100</s>",
  "<strike>Fixes #1</strike>",
  '<del title="old plan">Fixes #1</del>',
  "<s >Fixes #1</s>",
  "~~Fixes #1 `x`~~",
  "~~Fixes #1 <!-- old -->~~",
  "~~`old plan` Fixes #1~~",
  "~~old plan:\n`bun test`\nFixes #1~~",
  "<del>old plan:\n`bun test`\nFixes #1</del>",
  "~~~ `sh`\nFixes #1\n~~~",
  // a list does not cross a paragraph break or continue without a separator
  "Closes:\n\n#1",
  // other GitHub URLs
  "Fixes https://github.com/oven-sh/bun/commit/abcdef",
  "Fixes https://github.com/oven-sh/bun/issues/new",
  "Fixes https://github.com/oven-sh/bun",
])("ignores %j", async body => {
  expect(await refs(body)).toEqual([]);
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
  ["Fixes #1\n#2", [1]],
  ["Fixes #1,\n\n#2", [1]],
  ["Fixes #1,\n- #2", [1]],
  ["Fixes #1 and", [1]],
  ["Fixes #1, #2's sibling", [1]],
  ["Fixes #1\n```\nCloses #2\n```\nCloses #3", [1, 3]],
  ["Fix #1, #2", [1, 2]],
  ["- Fix #1", [1]],
  ["This will fix #1.", [1]],
  ["Adds the flag and fixes #1.", [1]],
  ["A change that fixes #1.", [1]],
  ["This PR, which fixes #1, also adds a test.", [1]],
] as [string, number[]][])("stops at the right place in %j", async (body, expected) => {
  expect(await refs(body)).toEqual(expected);
});

test("names the keyword and the repository in the log", async () => {
  const { logs } = await run({ body: "Supersedes #1. Fixes other/repo#2.", everyIssueOpen: true });
  expect(logs).toEqual([
    "other/repo#2: another repository, skipping",
    "#10: #1",
    "#1: closed issue (supersedes in #10)",
  ]);
});

test("closes the open issue and pull request, skips the closed and missing ones and itself", async () => {
  const { calls, logs, failed } = await run({
    body: "Fixes #1, #2 and #3. Supersedes #4. Resolves #5. Closes #10. Fixes #1.",
  });
  expect(logs).toEqual([
    "#10: #1, #2, #3, #4, #5",
    "#1: closed issue (fixes in #10)",
    "#2: closed pull request (fixes in #10)",
    "#3: already closed, skipping",
    "#4: does not exist, skipping",
    "#5: does not exist, skipping",
  ]);
  expect(calls).toEqual([
    { method: "issues.update", params: { ...REPO, issue_number: 1, state: "closed", state_reason: "completed" } },
    { method: "issues.createComment", params: { ...REPO, issue_number: 1, body: "Closed as completed by #10." } },
    { method: "pulls.update", params: { ...REPO, pull_number: 2, state: "closed" } },
    { method: "issues.createComment", params: { ...REPO, issue_number: 2, body: "Superseded by #10." } },
  ]);
  expect(failed).toBeNull();
});

test("the description from the merge event is parsed, not a later edit", async () => {
  const { calls, logs } = await run({ body: "Fixes #1", apiBody: "Fixes #1 and #2" });
  expect(logs).toEqual(["#10: #1", "#1: closed issue (fixes in #10)"]);
  expect(calls.map(call => call.method)).toEqual(["issues.update", "issues.createComment"]);
});

test("an empty description in the merge event closes nothing, whatever the API returns now", async () => {
  const { calls, logs } = await run({ body: "", apiBody: "Fixes #1" });
  expect(logs).toEqual(["#10: no references to close"]);
  expect(calls).toEqual([]);
});

test("a manual run reads the current description", async () => {
  const { calls, logs } = await run({ body: "Fixes #1", inputs: { pr_number: "10", dry_run: "true" } });
  expect(logs).toEqual(["#10: #1 (dry run)", "#1: would close issue (fixes in #10)"]);
  expect(calls).toEqual([]);
});

test("a dry run from workflow_dispatch reads but never writes", async () => {
  const { calls, logs, failed } = await run({
    body: "Fixes #1 and #2",
    inputs: { pr_number: "10", dry_run: "true" },
  });
  expect(logs).toEqual([
    "#10: #1, #2 (dry run)",
    "#1: would close issue (fixes in #10)",
    "#2: would close pull request (fixes in #10)",
  ]);
  expect(calls).toEqual([]);
  expect(failed).toBeNull();
});

test("workflow_dispatch without a valid PR number fails before any request", async () => {
  const { calls, failed } = await run({ body: "Fixes #1", inputs: { pr_number: "abc" } });
  expect(calls).toEqual([]);
  expect(failed).toBe("not a pull request number: abc");
});

test("a PR that is not merged changes nothing", async () => {
  const { calls, logs } = await run({ body: "Fixes #1", merged: false });
  expect(logs).toEqual(["#10: not merged, nothing to do"]);
  expect(calls).toEqual([]);
});

test("a PR merged into another branch than the default changes nothing", async () => {
  const { calls, logs } = await run({ body: "Fixes #1", base: "feature" });
  expect(logs).toEqual(["#10: merged into feature, not main, nothing to do"]);
  expect(calls).toEqual([]);
});

test("a PR whose description closes nothing changes nothing", async () => {
  const { calls, logs } = await run({ body: "See #1 and #2." });
  expect(logs).toEqual(["#10: no references to close"]);
  expect(calls).toEqual([]);
});

test("a failed lookup fails the run after the other references were tried", async () => {
  const { calls, logs, failed } = await run({ body: "Fixes #1 and #2", failGet: 1 });
  expect(logs).toEqual(["#10: #1, #2", "error: #1: boom", "#2: closed pull request (fixes in #10)"]);
  expect(calls.map(call => call.method)).toEqual(["pulls.update", "issues.createComment"]);
  expect(failed).toBe("1 of 2 references could not be closed");
});

test("a failed comment is a warning, the close stands and the run succeeds", async () => {
  const { calls, logs, failed } = await run({ body: "Fixes #1 and #2", failComment: true });
  expect(logs).toEqual([
    "#10: #1, #2",
    "#1: closed issue (fixes in #10)",
    "warning: #1: closed, but the comment failed: locked",
    "#2: closed pull request (fixes in #10)",
    "warning: #2: closed, but the comment failed: locked",
  ]);
  expect(calls.map(call => call.method)).toEqual([
    "issues.update",
    "issues.createComment",
    "pulls.update",
    "issues.createComment",
  ]);
  expect(failed).toBeNull();
});

test("a failed close fails the run after the other references were tried", async () => {
  const { calls, logs, failed } = await run({ body: "Fixes #1 and #2", failUpdate: true });
  expect(logs).toEqual(["#10: #1, #2", "error: #1: boom", "error: #2: boom"]);
  expect(calls.map(call => call.method)).toEqual(["issues.update", "pulls.update"]);
  expect(failed).toBe("2 of 2 references could not be closed");
});
