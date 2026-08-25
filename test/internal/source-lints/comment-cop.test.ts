/**
 * The script embedded in .github/workflows/comment-cop.yml, run the way
 * actions/github-script runs it (an async function body with `require`,
 * `github`, `context` and `core` in scope) against a fake `github` that records
 * the API calls the script makes instead of sending them.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const workflow = Bun.YAML.parse(
  readFileSync(join(import.meta.dir, "..", "..", "..", ".github", "workflows", "comment-cop.yml"), "utf8"),
) as {
  permissions: Record<string, string>;
  jobs: { "comment-cop": { steps: { with?: { script?: string } }[] } };
};
const scanScript = workflow.jobs["comment-cop"].steps.find(step => step.with?.script)!.with!.script!;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;
const runScan = new AsyncFunction("require", "github", "context", "core", scanScript);
const require = createRequire(import.meta.url);

const PATH = "src/runtime/example.rs";
const comment = ["// a comment block that the cop flags, line one", "// line two"];
const patch = ["@@ -1,1 +1,3 @@", ...comment.map(line => `+${line}`), " fn existing() {}"].join("\n");
/** The key the workflow derives for a comment group: path plus a hash of the comment text. */
const PRESENT = `${PATH}:${createHash("sha256").update(comment.join("\n")).digest("hex").slice(0, 12)}`;

const thread = (id: string, key: string | null, isResolved = false) => ({
  id,
  isResolved,
  comments: { nodes: [{ body: key ? `<!-- comment-cop:${key} -->\nplease delete this comment\n` : "nit: rename" }] },
});
/** Flagged on an earlier push; the block they flagged is no longer in the diff. */
const STALE = [thread("T_STALE_A", `${PATH}:00000000000a`), thread("T_STALE_B", `${PATH}:00000000000b`)];
const threads = [
  thread("T_PRESENT", PRESENT),
  ...STALE,
  thread("T_ALREADY_RESOLVED", `${PATH}:00000000000c`, true),
  thread("T_HUMAN", null),
];

/** Runs the scan with a fake GitHub whose resolve mutation rejects the given thread ids. */
async function scan(rejected: Set<string>) {
  const posted: unknown[] = [];
  const resolveAttempts: string[] = [];
  const info: string[] = [];
  const warnings: string[] = [];

  const github = {
    rest: {
      pulls: {
        listFiles: async () => ({ data: [{ filename: PATH, status: "modified", patch }] }),
        createReviewComment: async (params: unknown) => {
          posted.push(params);
          return { data: {} };
        },
      },
    },
    paginate: async (endpoint: () => Promise<{ data: unknown[] }>) => (await endpoint()).data,
    graphql: async (query: string, variables: { id?: string }) => {
      if (query.includes("reviewThreads")) {
        return { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: threads } } } };
      }
      if (query.includes("resolveReviewThread")) {
        resolveAttempts.push(variables.id!);
        if (rejected.has(variables.id!)) {
          throw new Error(
            "Request failed due to following response errors:\n - Resource not accessible by integration",
          );
        }
        return { resolveReviewThread: { thread: { id: variables.id } } };
      }
      throw new Error(`unexpected GraphQL request: ${query}`);
    },
  };
  const context = {
    repo: { owner: "oven-sh", repo: "bun" },
    payload: { pull_request: { number: 4242, head: { sha: "0123456789abcdef0123456789abcdef01234567" } } },
  };
  const core = {
    info: (message: string) => info.push(message),
    warning: (message: string) => warnings.push(message),
  };

  await runScan(require, github, context, core);
  return { posted, resolveAttempts, info, warnings };
}

describe("comment-cop auto-resolve", () => {
  test("the workflow token is allowed to resolve review threads", () => {
    // GitHub gates resolveReviewThread on the contents permission, not on
    // pull-requests. Under contents: read every mutation is rejected with
    // "Resource not accessible by integration" and stale threads stay open.
    expect(workflow.permissions.contents).toBe("write");
    expect(workflow.permissions["pull-requests"]).toBe("write");
  });

  test("resolves the stale threads it opened and reports how many succeeded", async () => {
    expect(await scan(new Set())).toEqual({
      posted: [],
      resolveAttempts: ["T_STALE_A", "T_STALE_B"],
      info: ["Resolved 2 of 2 stale comment-cop thread(s).", expect.stringContaining("No new comment groups to flag")],
      warnings: [],
    });
  });

  test("a rejected mutation is a warning, not a resolved thread", async () => {
    const { info, warnings } = await scan(new Set(["T_STALE_B"]));
    expect(warnings).toEqual([expect.stringContaining("resolveReviewThread failed for T_STALE_B")]);
    expect(info[0]).toBe("Resolved 1 of 2 stale comment-cop thread(s).");
  });
});
