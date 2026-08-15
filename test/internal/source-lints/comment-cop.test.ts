/**
 * The script embedded in .github/workflows/comment-cop.yml, run the way
 * actions/github-script runs it (as an async function body with `github`,
 * `context`, `core` and `require` in scope) against a fake `github` that
 * records writes instead of sending them.
 *
 * The scenarios pin the workflow's dependence on the two GitHub API quotas:
 * GITHUB_TOKEN's GraphQL quota is shared by every workflow run in the repo and
 * is routinely exhausted, so scanning, dedup and posting have to work with
 * GraphQL unavailable, and only the auto-resolve of stale threads (thread ids
 * and resolved state exist only in GraphQL) may depend on it, as a warning.
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
const markerComment = (key: string) => `<!-- comment-cop:${key} -->\nplease delete this comment\n`;

// Two three-line comment groups added at lines 2-4 and 6-8 of the new file.
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
/** Flagged on an earlier push, and the comment it flagged is no longer in the diff. */
const STALE_UNRESOLVED = `${PATH}:000000000001`;
const STALE_RESOLVED = `${PATH}:000000000002`;

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

const rateLimitError = () =>
  Object.assign(
    new Error(
      "Request failed due to following response errors:\n - API rate limit already exceeded for site ID installation.",
    ),
    { name: "GraphqlResponseError", errors: [{ type: "RATE_LIMIT", code: "graphql_rate_limit" }] },
  );

type Thread = { id: string; isResolved: boolean; comments: { nodes: { body: string }[] } };
const thread = (id: string, body: string | null, isResolved = false): Thread => ({
  id,
  isResolved,
  comments: { nodes: body === null ? [] : [{ body }] },
});

interface Scenario {
  /** Bodies of the review comments already on the PR, as `pulls.listReviewComments` returns them. */
  reviewComments: string[];
  /** Pages served for the reviewThreads query; omitted means every GraphQL request fails on the rate limit. */
  threadPages?: Thread[][];
}

async function scan({ reviewComments, threadPages }: Scenario) {
  const posted: unknown[] = [];
  const resolved: string[] = [];
  const graphqlRequests: string[] = [];
  const restPaginated: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  const endpoint = <T>(name: string, rows: () => T[]) =>
    Object.assign(async () => ({ data: rows() }), { endpointName: name });
  const github = {
    rest: {
      pulls: {
        listFiles: endpoint("pulls.listFiles", () => [{ filename: PATH, status: "modified", patch }]),
        listReviewComments: endpoint("pulls.listReviewComments", () =>
          reviewComments.map((body, i) => ({ id: i + 1, body, user: { login: "github-actions[bot]" } })),
        ),
        createReviewComment: async (params: unknown) => {
          posted.push(params);
          return { data: {} };
        },
      },
    },
    paginate: async (fn: { endpointName: string; (): Promise<{ data: unknown[] }> }) => {
      restPaginated.push(fn.endpointName);
      return (await fn()).data;
    },
    graphql: async (query: string, variables: { id?: string; after?: string | null }) => {
      const isMutation = /^\s*mutation\b/.test(query);
      graphqlRequests.push(isMutation ? "mutation" : "query");
      if (threadPages === undefined) throw rateLimitError();
      if (isMutation) {
        resolved.push(variables.id!);
        return { resolveReviewThread: { thread: { id: variables.id } } };
      }
      const pageIndex = variables.after == null ? 0 : Number(variables.after);
      return {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: pageIndex + 1 < threadPages.length, endCursor: String(pageIndex + 1) },
              nodes: threadPages[pageIndex],
            },
          },
        },
      };
    },
  };
  const context = {
    repo: { owner: "oven-sh", repo: "bun" },
    payload: { pull_request: { number: 4242, head: { sha: HEAD_SHA }, base: { ref: "main" } } },
  };
  const core = {
    info: (message: string) => info.push(message),
    warning: (message: string) => warnings.push(message),
  };

  await runScan(require, github, context, core);
  return { posted, resolved, graphqlRequests, restPaginated, warnings, info };
}

describe("comment-cop with the GraphQL quota exhausted", () => {
  test("still posts the new groups and dedups the already flagged one", async () => {
    const result = await scan({
      reviewComments: [
        markerComment(FIRST),
        "nit: rename this (a human review comment)",
        markerComment(STALE_UNRESOLVED),
      ],
    });
    expect(result).toEqual({
      posted: [expectedPost(SECOND, 6, 8)],
      resolved: [],
      // The stale key makes it try the thread lookup once; the failure is a warning, not a failed check.
      graphqlRequests: ["query"],
      restPaginated: ["pulls.listFiles", "pulls.listReviewComments"],
      warnings: [expect.stringContaining("API rate limit already exceeded")],
      info: ["Posted 1 review comment(s)."],
    });
  });

  test("does not touch GraphQL when no flagged block has gone stale", async () => {
    const result = await scan({ reviewComments: [markerComment(FIRST), "looks good"] });
    expect(result).toEqual({
      posted: [expectedPost(SECOND, 6, 8)],
      resolved: [],
      graphqlRequests: [],
      restPaginated: ["pulls.listFiles", "pulls.listReviewComments"],
      warnings: [],
      info: ["Posted 1 review comment(s)."],
    });
  });

  test("a second run after posting finds its own comments through REST and posts nothing", async () => {
    const firstRun = await scan({ reviewComments: [] });
    expect(firstRun.posted).toEqual([expectedPost(FIRST, 2, 4), expectedPost(SECOND, 6, 8)]);

    const secondRun = await scan({ reviewComments: firstRun.posted.map(params => (params as { body: string }).body) });
    expect(secondRun).toEqual({
      posted: [],
      resolved: [],
      graphqlRequests: [],
      restPaginated: ["pulls.listFiles", "pulls.listReviewComments"],
      warnings: [],
      info: ["No new comment groups to flag (2 present, all already flagged)."],
    });
  });
});

describe("comment-cop with GraphQL available", () => {
  test("resolves only the unresolved threads whose flagged block left the diff", async () => {
    const result = await scan({
      reviewComments: [
        markerComment(FIRST),
        markerComment(STALE_UNRESOLVED),
        markerComment(STALE_RESOLVED),
        "nit: rename this (a human review comment)",
      ],
      threadPages: [
        [
          thread("THREAD_FIRST", markerComment(FIRST)),
          thread("THREAD_STALE_UNRESOLVED", markerComment(STALE_UNRESOLVED)),
        ],
        [
          thread("THREAD_STALE_RESOLVED", markerComment(STALE_RESOLVED), true),
          thread("THREAD_HUMAN", "nit: rename this (a human review comment)"),
          thread("THREAD_EMPTY", null),
        ],
      ],
    });
    expect(result).toEqual({
      posted: [expectedPost(SECOND, 6, 8)],
      resolved: ["THREAD_STALE_UNRESOLVED"],
      graphqlRequests: ["query", "query", "mutation"],
      restPaginated: ["pulls.listFiles", "pulls.listReviewComments"],
      warnings: [],
      info: ["Resolved 1 stale comment-cop thread(s).", "Posted 1 review comment(s)."],
    });
  });
});
