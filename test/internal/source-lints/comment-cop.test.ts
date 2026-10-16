/**
 * The script embedded in .github/workflows/comment-cop.yml, run the way
 * actions/github-script runs it (an async function body with `require`,
 * `github`, `context` and `core` in scope) against a fake `github` that
 * records the comments the script posts instead of sending them.
 *
 * GITHUB_TOKEN's GraphQL quota is shared by every workflow run in the repo and
 * is routinely exhausted, so the fake fails every GraphQL request the way
 * GitHub does then; the step has to dedup and post using REST alone.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");

const workflow = Bun.YAML.parse(readFileSync(join(repoRoot, ".github", "workflows", "comment-cop.yml"), "utf8")) as {
  jobs: { "comment-cop": { steps: { with?: { script?: string } }[] } };
};
const scanScript = workflow.jobs["comment-cop"].steps.find(step => step.with?.script)!.with!.script!;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;
const runScan = new AsyncFunction("require", "github", "context", "core", scanScript);
const require = createRequire(import.meta.url);

const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const PATH = "src/runtime/example.rs";

/** Same key the workflow derives for a comment group: path plus a hash of the comment text. */
const keyFor = (text: string) => `${PATH}:${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
/** What one of the workflow's own comments looks like when read back from the PR. */
const botComment = (key: string) => `<!-- comment-cop:${key} -->\nplease delete this comment\n`;

// Two three-line comment groups, added at lines 2-4 and 6-8 of the new file.
const firstGroup = ["// first group, line one", "// first group, line two", "// first group, line three"];
const secondGroup = ["// second group, line one", "// second group, line two", "// second group, line three"];
const patch = [
  "@@ -1,2 +1,9 @@",
  " use bun_core::Output;",
  ...firstGroup.map(line => `+${line}`),
  "+fn first() {}",
  ...secondGroup.map(line => `+${line}`),
  "+fn second() {}",
  " fn existing() {}",
].join("\n");
const FIRST = keyFor(firstGroup.join("\n"));
const SECOND = keyFor(secondGroup.join("\n"));
/** Flagged on an earlier push; the comment it flagged is no longer in the diff. */
const STALE = `${PATH}:000000000001`;

const expectedPost = (key: string, start: number, end: number) => ({
  owner: "oven-sh",
  repo: "bun",
  pull_number: 4242,
  commit_id: HEAD_SHA,
  path: PATH,
  start_line: start,
  start_side: "RIGHT",
  line: end,
  side: "RIGHT",
  body: expect.stringContaining(`<!-- comment-cop:${key} -->`),
});

/** Bodies of the review comments already on the PR, as `pulls.listReviewComments` returns them. */
async function scan(reviewComments: string[]) {
  const posted: { body: string }[] = [];
  const graphqlRequests: string[] = [];
  const warnings: string[] = [];

  const github = {
    rest: {
      pulls: {
        listFiles: async () => ({ data: [{ filename: PATH, status: "modified", patch }] }),
        listReviewComments: async () => ({
          data: reviewComments.map((body, i) => ({ id: i + 1, body, user: { login: "github-actions[bot]" } })),
        }),
        createReviewComment: async (params: { body: string }) => {
          posted.push(params);
          return { data: {} };
        },
      },
    },
    paginate: async (endpoint: () => Promise<{ data: unknown[] }>) => (await endpoint()).data,
    graphql: async (query: string) => {
      graphqlRequests.push(query);
      throw Object.assign(
        new Error(
          "Request failed due to following response errors:\n - API rate limit already exceeded for site ID installation.",
        ),
        { name: "GraphqlResponseError", errors: [{ type: "RATE_LIMIT", code: "graphql_rate_limit" }] },
      );
    },
  };
  const context = {
    repo: { owner: "oven-sh", repo: "bun" },
    payload: { pull_request: { number: 4242, head: { sha: HEAD_SHA }, base: { ref: "main" } } },
  };
  const core = {
    info: () => {},
    warning: (message: string) => warnings.push(message),
  };

  await runScan(require, github, context, core);
  return { posted, graphqlRequests, warnings };
}

describe("comment-cop with the GraphQL quota exhausted", () => {
  test("posts the groups that are not flagged yet and skips the one that is", async () => {
    expect(await scan([botComment(FIRST), "nit: rename this (a human review comment)", botComment(STALE)])).toEqual({
      posted: [expectedPost(SECOND, 6, 8)],
      graphqlRequests: [],
      warnings: [],
    });
  });

  test("a second run recognizes the comments the first run posted and posts nothing", async () => {
    const firstRun = await scan([]);
    expect(firstRun).toEqual({
      posted: [expectedPost(FIRST, 2, 4), expectedPost(SECOND, 6, 8)],
      graphqlRequests: [],
      warnings: [],
    });

    expect(await scan(firstRun.posted.map(comment => comment.body))).toEqual({
      posted: [],
      graphqlRequests: [],
      warnings: [],
    });
  });
});
