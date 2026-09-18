/**
 * The script embedded in .github/workflows/update-lolhtml.yml, run the way
 * actions/github-script runs it (an async function body with `require`,
 * `github`, `context` and `core` in scope) against a fake GitHub API.
 *
 * bun builds oven-sh/lol-html, a fork of cloudflare/lol-html, so LOLHTML_COMMIT
 * in scripts/build/deps/lolhtml.ts is a commit of the fork. An upstream commit
 * can never replace it: bun does not compile without the fork's suspension API.
 * The workflow compares upstream's latest release with LOLHTML_UPSTREAM_BASE,
 * the upstream commit the fork is rebased onto, and opens an issue that asks
 * for a rebase of the fork.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const workflowsDir = join(repoRoot, ".github", "workflows");
const DEP_FILE = "scripts/build/deps/lolhtml.ts";

const BASE = "1111111111111111111111111111111111111111";
const FORK_HEAD = "2222222222222222222222222222222222222222";
const RELEASE = "3333333333333333333333333333333333333333";
const TAG_OBJECT = "4444444444444444444444444444444444444444";
const TITLE = "deps: rebase the lol-html fork onto v3.1.0";

/** The two lines of the dep file that matter, in the shape the real file has. */
const depFile = (base: string) =>
  `const LOLHTML_UPSTREAM_BASE = "${base}"; // v3.0.1\nconst LOLHTML_COMMIT = "${FORK_HEAD}";\n`;

interface Job {
  permissions?: Record<string, string>;
  steps: { uses?: string; with?: { script?: string } }[];
}
const job = () => {
  const workflow = Bun.YAML.parse(readFileSync(join(workflowsDir, "update-lolhtml.yml"), "utf8"));
  return (workflow as { jobs: Record<string, Job> }).jobs["check-update"];
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

interface Options {
  /** Contents of scripts/build/deps/lolhtml.ts. */
  depFile?: string;
  /** The tag of upstream's latest release. */
  tag?: string;
  /** Upstream made the tag with `git tag -a`: the ref points at a tag object, not at the commit. */
  annotated?: boolean;
  /** Where the release is, seen from the recorded base, as the compare API reports it. */
  status: "ahead" | "behind" | "identical" | "diverged";
  /** Titles of the issues that oven-sh/bun has, open or closed. */
  issues?: string[];
}

/** Runs the script against a fake API and records what it asks and what it writes. */
async function run({ depFile: source = depFile(BASE), tag = "v3.1.0", annotated, status, issues = [] }: Options) {
  const step = job().steps.find(step => step.uses?.startsWith("actions/github-script"));
  if (!step?.with?.script) throw new Error("update-lolhtml.yml has no actions/github-script step");
  const script = new AsyncFunction("require", "github", "context", "core", step.with.script);

  const compared: string[] = [];
  const searched: string[] = [];
  const created: { title: string; body: string }[] = [];
  let failed: string | null = null;

  const fromUpstream = ({ owner, repo }: { owner: string; repo: string }) =>
    expect(`${owner}/${repo}`).toBe("cloudflare/lol-html");
  const github = {
    rest: {
      repos: {
        getLatestRelease: async (params: { owner: string; repo: string }) => {
          fromUpstream(params);
          return { data: { tag_name: tag, html_url: `https://github.com/cloudflare/lol-html/releases/tag/${tag}` } };
        },
        compareCommitsWithBasehead: async (params: { owner: string; repo: string; basehead: string }) => {
          fromUpstream(params);
          compared.push(params.basehead);
          return { data: { status } };
        },
      },
      git: {
        getRef: async (params: { owner: string; repo: string; ref: string }) => {
          fromUpstream(params);
          expect(params.ref).toBe(`tags/${tag}`);
          return { data: { object: annotated ? { type: "tag", sha: TAG_OBJECT } : { type: "commit", sha: RELEASE } } };
        },
        getTag: async (params: { owner: string; repo: string; tag_sha: string }) => {
          fromUpstream(params);
          expect(params.tag_sha).toBe(TAG_OBJECT);
          return { data: { object: { type: "commit", sha: RELEASE } } };
        },
      },
      search: {
        // Like GitHub, match every title that contains the quoted phrase.
        issuesAndPullRequests: async ({ q }: { q: string }) => {
          searched.push(q);
          const phrase = q.match(/"(.*)"/)![1];
          const items = issues.flatMap((title, i) => (title.includes(phrase) ? [{ number: i + 1, title }] : []));
          return { data: { total_count: items.length, items } };
        },
      },
      issues: {
        create: async ({ owner, repo, ...issue }: { owner: string; repo: string; title: string; body: string }) => {
          expect(`${owner}/${repo}`).toBe("oven-sh/bun");
          created.push(issue);
          return { data: { number: 100 } };
        },
      },
    },
  };
  const context = { repo: { owner: "oven-sh", repo: "bun" } };
  const core = {
    info: () => {},
    setFailed: (message: string) => {
      failed = message;
    },
  };
  const require = (id: string) => {
    expect(id).toBe("node:fs");
    return {
      readFileSync: (path: string) => {
        expect(path).toBe(DEP_FILE);
        return source;
      },
    };
  };

  await script(require, github, context, core);
  return { compared, searched, created, failed: failed as string | null };
}

describe("update-lolhtml.yml", () => {
  test("opens an issue when the fork's base does not contain upstream's latest release", async () => {
    const { compared, searched, created, failed } = await run({ status: "ahead" });

    expect({ compared, searched, failed }).toEqual({
      compared: [`${BASE}...${RELEASE}`],
      searched: [`repo:oven-sh/bun is:issue in:title "${TITLE}"`],
      failed: null,
    });
    expect(created.map(issue => issue.title)).toEqual([TITLE]);
    expect(created[0].body).toMatchInlineSnapshot(`
      "cloudflare/lol-html released [v3.1.0](https://github.com/cloudflare/lol-html/releases/tag/v3.1.0).

      bun builds the fork [oven-sh/lol-html](https://github.com/oven-sh/lol-html) (branch \`bun\`), which adds content-handler suspension to upstream.
      \`scripts/build/deps/lolhtml.ts\` records the upstream commit that the fork is rebased onto, \`LOLHTML_UPSTREAM_BASE\`, as \`1111111111111111111111111111111111111111\`.
      That commit does not contain v3.1.0: https://github.com/cloudflare/lol-html/compare/1111111111111111111111111111111111111111...3333333333333333333333333333333333333333

      To update:

      1. In oven-sh/lol-html, fetch \`v3.1.0\` from upstream and run \`git rebase --onto v3.1.0 1111111111111111111111111111111111111111 bun\`. Run \`cargo test\`, then push the branch.
      2. In \`scripts/build/deps/lolhtml.ts\`, set \`LOLHTML_COMMIT\` to the new head of \`bun\` and \`LOLHTML_UPSTREAM_BASE\` to \`3333333333333333333333333333333333333333\`.
      3. Update the \`lol_html\` entry in \`Cargo.lock\`. The build runs cargo with \`--locked\`.

      Do not set \`LOLHTML_COMMIT\` to an upstream commit. \`src/runtime/api/html_rewriter.rs\` needs \`HtmlRewriter::resume()\`, and only the fork has it.

      Opened by [this workflow](https://github.com/oven-sh/bun/actions/workflows/update-lolhtml.yml)."
    `);
  });

  test("compares the base that the real dep file records, not the fork commit it pins", async () => {
    const source = readFileSync(join(repoRoot, DEP_FILE), "utf8");
    const sha = (name: string) => source.match(new RegExp(`${name} = "([0-9a-f]{40})"`))![1];

    expect(await run({ depFile: source, status: "ahead" })).toMatchObject({
      compared: [`${sha("LOLHTML_UPSTREAM_BASE")}...${RELEASE}`],
      failed: null,
    });
    expect(sha("LOLHTML_UPSTREAM_BASE")).not.toBe(sha("LOLHTML_COMMIT"));
  });

  test("resolves an annotated tag to its commit", async () => {
    const { compared, created } = await run({ annotated: true, status: "ahead" });

    expect(compared).toEqual([`${BASE}...${RELEASE}`]);
    expect(created[0].body).not.toContain(TAG_OBJECT);
  });

  // "behind": the base is a commit after the tag, like 77127cd2 (v2.7.2 plus one Cargo.lock commit).
  test.each(["identical", "behind"] as const)("does nothing when the base contains the release (%s)", async status => {
    expect(await run({ status })).toEqual({
      compared: [`${BASE}...${RELEASE}`],
      searched: [],
      created: [],
      failed: null,
    });
  });

  test("opens an issue when the release and the base have diverged", async () => {
    const { created } = await run({ status: "diverged" });

    expect(created.map(issue => issue.title)).toEqual([TITLE]);
  });

  test("opens one issue per release, whether that issue is open or closed", async () => {
    const { created, failed } = await run({ status: "ahead", issues: ["HTMLRewriter crashes", TITLE] });

    expect({ created, failed }).toEqual({ created: [], failed: null });
  });

  test("an issue for another release does not count", async () => {
    const { created } = await run({ status: "ahead", issues: [`${TITLE}-rc.1`, `Re: ${TITLE}`] });

    expect(created.map(issue => issue.title)).toEqual([TITLE]);
  });

  test("fails when the dep file does not record the base", async () => {
    expect(await run({ depFile: `const LOLHTML_COMMIT = "${FORK_HEAD}";\n`, status: "ahead" })).toEqual({
      compared: [],
      searched: [],
      created: [],
      failed: `Could not find LOLHTML_UPSTREAM_BASE in ${DEP_FILE}`,
    });
  });

  test("fails on a tag name that is not a plain version", async () => {
    const { created, failed } = await run({ tag: 'v3.1.0" @everyone', status: "ahead" });

    expect({ created, failed }).toEqual({
      created: [],
      failed: 'Unexpected tag name from cloudflare/lol-html: "v3.1.0\\" @everyone"',
    });
  });

  test("cannot push a branch or open a pull request", () => {
    expect(job().permissions).toEqual({ contents: "read", issues: "write" });
  });
});

// update-lolhtml.yml broke when the dep moved to a fork and the workflow kept bumping the pin from upstream.
test("the update workflows that bump a pin ask the repository that the dep is fetched from", () => {
  const bumped: string[] = [];
  for (const workflow of new Bun.Glob("update-*.yml").scanSync(workflowsDir)) {
    const text = readFileSync(join(workflowsDir, workflow), "utf8");
    const dep = text.match(/^\s*DEP_FILE=(scripts\/build\/deps\/[\w-]+\.ts)$/m)?.[1];
    if (!dep) continue;
    bumped.push(workflow);

    const asks = new Set(
      Array.from(text.matchAll(/api\.github\.com\/repos\/([\w.-]+\/[\w.-]+)\//g), match => match[1]),
    );
    const fetches = readFileSync(join(repoRoot, dep), "utf8").match(/^\s*repo: "([^"]+)",$/m)?.[1];
    expect({ workflow, asks: [...asks] }).toEqual({ workflow, asks: [fetches] });
  }
  expect(bumped).toContain("update-zstd.yml");
});
