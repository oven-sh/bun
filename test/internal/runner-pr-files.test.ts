/**
 * A pull request's build runs the test files that the pull request changes
 * first, and it builds nothing for a pull request that only changes docs. The
 * pipeline step (.buildkite/ci.ts) works out which files a pull request
 * changes, once per build: getPullRequestFiles() in scripts/buildkite.ts reads
 * them from the history its checkout has. The step decides on that list and
 * stores up to 500 of its files in the build's meta-data. A test shard
 * (scripts/runner.node.ts) only reads the stored list. Nothing asks GitHub,
 * where every job of every build would spend the hourly quota of one token.
 *
 * The scripts run the way CI runs them, with node, and with stand-ins for what
 * they reach outside the checkout: `buildkite-agent`, `gh` and `aws` are shell
 * scripts on PATH that log every call (the build's meta-data is a directory),
 * and fetch() is a preload that logs what it is asked. The checkout is a git
 * repository that each case makes. The pipeline step gets a commit message
 * with `[skip ci]`, so it stops after it has dealt with the list. The runner
 * gets an `--exec-path` that does not exist, so it stops as soon as it has
 * read the list.
 *
 * The last part is about getSecret() in scripts/buildkite.ts: a secret it
 * fetches must not be written to process.env, because every child process
 * inherits that, the tests the runner starts included.
 *
 * Shell-script stand-ins don't resolve as executables on Windows, hence the skip.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, nodeExe, tempDir } from "harness";
import { chmodSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

const fakeAgent = `#!/bin/sh
root=$(dirname "$0")/..
echo "buildkite-agent $1 $2 $3" >> "$root/calls.log"
case "$1 $2" in
  "meta-data get") [ -f "$root/meta-data/$3" ] && cat "$root/meta-data/$3" ;;
  "meta-data set") printf %s "$4" > "$root/meta-data/$3" ;;
  "secret get") echo "secret-of-$3" ;;
  *) exit 1 ;;
esac
`;

/** Logs the call and fails. `gh auth token` is the one call that gets an answer. */
const fakeTool = (name: string) => `#!/bin/sh
echo "${name} $*" >> "$(dirname "$0")/../calls.log"
[ "${name} $1 $2" = "gh auth token" ] && echo token-of-gh
`;

const fakeFetch = `
import { appendFileSync } from "node:fs";
import { join } from "node:path";

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  appendFileSync(join(import.meta.dirname, "fetch.log"), url + " " + new Headers(init?.headers).get("authorization") + "\\n");
  return Response.json({});
};
`;

const readLines = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : []);

interface Fakes {
  /** The build's meta-data: a file per key. */
  metaData?: Record<string, string>;
  env?: Record<string, string | undefined>;
  /** Fills the directory the script runs in. */
  checkout?: (directory: string) => Promise<unknown>;
}

/** Runs node with `args` and the stand-ins in place, and reports what it asked them for. */
async function runNode(args: (dir: string) => string[], { metaData = {}, env = {}, checkout }: Fakes) {
  using dir = tempDir("runner-pr-files", {
    "bin/buildkite-agent": fakeAgent,
    "bin/gh": fakeTool("gh"),
    "bin/aws": fakeTool("aws"),
    // The runner reads kernel.core_pattern on Linux and rejects a piped one.
    "bin/sysctl": "#!/bin/sh\necho core\n",
    "fetch.mjs": fakeFetch,
    "meta-data": metaData,
    "checkout": {},
  });
  const bin = join(String(dir), "bin");
  for (const name of readdirSync(bin)) {
    chmodSync(join(bin, name), 0o755);
  }
  await checkout?.(join(String(dir), "checkout"));

  await using proc = Bun.spawn({
    cmd: [
      nodeExe()!, // the tests are skipped without it
      "--disable-warning=ExperimentalWarning",
      "--import",
      join(String(dir), "fetch.mjs"),
      ...args(String(dir)),
    ],
    env: {
      // test/harness.ts takes every BUILDKITE* variable out of bunEnv, so the build that runs this test is not the
      // build that the script sees: that one is what a case puts in `env`.
      ...bunEnv,
      PATH: `${bin}:${bunEnv.PATH}`,
      // Whoever runs this test may have either in the environment.
      GITHUB_TOKEN: undefined,
      TEST_REPORTING_API: undefined,
      ...env,
    },
    cwd: join(String(dir), "checkout"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const stored = join(String(dir), "meta-data");
  return {
    calls: readLines(join(String(dir), "calls.log")),
    requests: readLines(join(String(dir), "fetch.log")),
    metaData: Object.fromEntries(readdirSync(stored).map(key => [key, readFileSync(join(stored, key), "utf8")])),
    stdout,
    stderr,
    exitCode,
  };
}

/**
 * Runs `body`, the statements of an async function, with scripts/buildkite.ts
 * imported as `buildkite`, and reports what it returns. `inherited(name)` is
 * what a child process finds in its environment under `name`.
 */
async function runScript(body: string, fakes: Fakes) {
  const script = `
    import { spawnSync } from "node:child_process";
    import * as buildkite from ${JSON.stringify(join(root, "scripts", "buildkite.ts"))};
    const inherited = name => spawnSync("sh", ["-c", 'printf %s "\${' + name + '-unset}"'], { encoding: "utf8" }).stdout;
    console.log(JSON.stringify(await (async () => { ${body} })()));
  `;
  const { calls, requests, stdout, stderr, exitCode } = await runNode(
    () => ["--input-type=module", "-e", script],
    fakes,
  );
  if (exitCode !== 0) throw new Error(`the script exited with ${exitCode}: ${stderr}`);
  // The scripts log to stdout too: the result is the last line.
  return { calls, requests, stderr, result: JSON.parse(stdout.trimEnd().split("\n").at(-1)!) };
}

/** Runs `cmd` in `cwd`, with `stdin` as its input. */
async function run(cwd: string, cmd: string[], stdin = "") {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...bunEnv, GIT_CONFIG_NOSYSTEM: "1" },
    stdin: Buffer.from(stdin),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`${cmd.join(" ")} exited with ${exitCode}: ${stderr}`);
}

/** Path to contents. */
type Files = Record<string, string>;

/**
 * Makes `directory` a repository with the history of a pull request, and HEAD
 * at the pull request's commit:
 *
 *   root - start - where the base branch is now (`baseRef`)
 *              \ - the pull request (HEAD), with exactly the files of `head`
 *
 * `refs` names more refs to create, at "root" or at "start". No file is
 * written: the commits come from one `git fast-import`.
 */
async function makeHistory(
  directory: string,
  baseRef: string,
  start: Files,
  head: Files,
  refs: Record<string, "root" | "start"> = {},
) {
  const marks = { root: 1, start: 2, base: 3, head: 4 };
  const commit = (ref: string, mark: number, files: Files, parent?: number) => [
    `commit ${ref}`,
    `mark :${mark}`,
    "committer Test <test@example.com> 0 +0000",
    "data 0",
    ...(parent ? [`from :${parent}`] : []),
    "deleteall",
    ...Object.entries(files).flatMap(([path, contents]) => [
      `M 100644 inline ${path}`,
      `data ${Buffer.byteLength(contents)}`,
      contents,
    ]),
  ];
  const stream = [
    ...commit("refs/heads/pull-request", marks.root, { "README.md": "# a repository\n" }),
    ...commit("refs/heads/pull-request", marks.start, start, marks.root),
    ...commit(baseRef, marks.base, { ...start, "src/only-on-the-base-branch.ts": "" }, marks.start),
    ...commit("refs/heads/pull-request", marks.head, head, marks.start),
    ...Object.entries(refs).flatMap(([ref, at]) => [`reset ${ref}`, `from :${marks[at]}`]),
    "",
  ];
  // One process for the three commands: a debug build of bun is slow to start one.
  const commands = "git init --quiet && git symbolic-ref HEAD refs/heads/pull-request && git fast-import --quiet";
  await run(directory, ["sh", "-c", commands], stream.join("\n"));
}

/**
 * Makes `directory` what the pipeline step has for a pull request on `base`:
 * a clone with the whole history, HEAD at the pull request's commit, and
 * origin's branches.
 */
const checkOutPullRequest = (directory: string, base: string, start: Files, head: Files) =>
  makeHistory(
    directory,
    `refs/remotes/origin/${base}`,
    start,
    head,
    base === "main" ? {} : { "refs/remotes/origin/main": "root" },
  );

/** `count` paths in `directory`, in the order git lists them. */
const pages = (directory: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${directory}/${String(i).padStart(3, "0")}.md`);

/** A pull request that moves `count` pages of the docs to another directory, and changes the files of `other`. */
const moveDocs = (count: number, other: Files) => ({
  start: { ...Object.fromEntries(pages("docs/old", count).map(path => [path, "a page\n"])), ...other },
  head: {
    ...Object.fromEntries(pages("docs/new", count).map(path => [path, "a page\n"])),
    ...Object.fromEntries(Object.keys(other).map(path => [path, "changed\n"])),
  },
});

const pullRequestEnv = { BUILDKITE: "true", BUILDKITE_PULL_REQUEST: "45177" };

const skip = isWindows || !nodeExe();

describe.skipIf(skip)("getPullRequestFiles", () => {
  const getFiles = (base: string, checkout: Fakes["checkout"]) =>
    runScript(`return buildkite.getPullRequestFiles();`, {
      env: { ...pullRequestEnv, BUILDKITE_PULL_REQUEST_BASE_BRANCH: base },
      checkout,
    });

  test.concurrent("lists what differs from the commit where the pull request left its base branch", async () => {
    expect(
      await getFiles("main", directory =>
        checkOutPullRequest(
          directory,
          "main",
          { "src/changed.ts": "before\n", "src/removed.ts": "", "test/old-name.test.ts": "a test\n" },
          { "src/changed.ts": "after\n", "test/new-name.test.ts": "a test\n", "test/added.test.ts": "" },
        ),
      ),
    ).toEqual({
      // Neither the token nor a request. src/only-on-the-base-branch.ts, which the base branch got later, is not listed.
      calls: [],
      requests: [],
      stderr: "",
      result: {
        allFiles: [
          "src/changed.ts",
          "src/removed.ts",
          "test/added.test.ts",
          // A renamed file is a removed one and an added one.
          "test/new-name.test.ts",
          "test/old-name.test.ts",
        ],
        newFiles: ["test/added.test.ts", "test/new-name.test.ts"],
      },
    });
  });

  test.concurrent("compares a stacked pull request with its own base branch", async () => {
    expect(
      await getFiles("release/x", directory =>
        checkOutPullRequest(
          directory,
          "release/x",
          { "src/on-the-release.ts": "" },
          { "src/on-the-release.ts": "", "src/stacked.ts": "" },
        ),
      ),
    ).toEqual({
      calls: [],
      requests: [],
      stderr: "",
      result: { allFiles: ["src/stacked.ts"], newFiles: ["src/stacked.ts"] },
    });
  });

  // output() of scripts/agent.ts keeps 1 MiB. The list is not cut at 500 files either: the pipeline step decides on all of it.
  test.concurrent("lists every file of a pull request whose diff is over 1 MiB", async () => {
    // 1400 paths of 820 bytes. The commit has them without a file on disk, so no limit of a file system applies.
    const long = Buffer.alloc(200, "d").toString();
    const paths = pages([long, long, long, long].join("/"), 1400);
    expect(
      await runScript(
        `const { allFiles, newFiles } = buildkite.getPullRequestFiles();
         return { files: allFiles.length, bytes: allFiles.join("\\n").length, newFiles: newFiles.length };`,
        {
          env: { ...pullRequestEnv, BUILDKITE_PULL_REQUEST_BASE_BRANCH: "main" },
          checkout: directory =>
            checkOutPullRequest(
              directory,
              "main",
              { "src/index.ts": "" },
              Object.fromEntries(paths.map(path => [path, ""])),
            ),
        },
      ),
    ).toEqual({
      calls: [],
      requests: [],
      stderr: "",
      // The 1400 added files, and src/index.ts, which the pull request removes.
      result: { files: 1401, bytes: paths.join("\n").length + "\nsrc/index.ts".length, newFiles: 1400 },
    });
  });

  test.concurrent("lists nothing, and says why, when its checkout lacks the base branch", async () => {
    const { stderr, ...rest } = await getFiles("gone", directory =>
      makeHistory(
        directory,
        "refs/remotes/origin/main",
        { "src/index.ts": "" },
        { "src/index.ts": "changed\n" },
        // A branch of the checkout's own that has the name of origin's is not the base branch.
        { "refs/heads/origin/gone": "start" },
      ),
    );
    expect(rest).toEqual({ calls: [], requests: [], result: { allFiles: [], newFiles: [] } });
    expect(stderr).toStartWith("- PR 45177, no file list: git merge-base refs/remotes/origin/gone HEAD: ");
  });

  // A build of the merge queue, or of a branch: the step asks for every build that is not of the main branch.
  test.concurrent("lists nothing, and has no complaint, when the build is not for a pull request", async () => {
    expect(
      await runScript(`return buildkite.getPullRequestFiles();`, {
        env: { BUILDKITE: "true", BUILDKITE_PULL_REQUEST: "false" },
        checkout: directory =>
          checkOutPullRequest(directory, "main", { "src/index.ts": "" }, { "src/index.ts": "changed\n" }),
      }),
    ).toEqual({ calls: [], requests: [], stderr: "", result: { allFiles: [], newFiles: [] } });
  });

  // A shallow clone can give a merge base that is older than the real one.
  test.concurrent("lists nothing, and says why, when its checkout is a shallow clone", async () => {
    expect(
      await getFiles("main", async directory => {
        using origin = tempDir("runner-pr-files-origin", {});
        await makeHistory(String(origin), "refs/heads/main", { "src/index.ts": "" }, { "src/index.ts": "changed\n" });
        // Two commits deep: the pull request's commit and main's both still reach the commit they share.
        await run(directory, ["git", "clone", "--quiet", "--depth=2", "--no-single-branch", `file://${origin}`, "."]);
      }),
    ).toEqual({
      calls: [],
      requests: [],
      stderr: "- PR 45177, no file list: the checkout is a shallow clone\n",
      result: { allFiles: [], newFiles: [] },
    });
  });
});

describe.skipIf(skip)("the pipeline step", () => {
  /** Runs .buildkite/ci.mjs for a pull request on `main`, in a checkout with that history. */
  async function runPipelineStep({ start, head }: { start: Files; head: Files }, env: Record<string, string> = {}) {
    const { calls, requests, metaData, stdout, stderr, exitCode } = await runNode(
      () => [join(root, ".buildkite", "ci.mjs")],
      {
        checkout: directory => checkOutPullRequest(directory, "main", start, head),
        env: {
          ...pullRequestEnv,
          BUILDKITE_PULL_REQUEST_BASE_BRANCH: "main",
          BUILDKITE_PIPELINE_DEFAULT_BRANCH: "main",
          BUILDKITE_BRANCH: "a-branch",
          BUILDKITE_REPO: "https://github.com/oven-sh/bun.git",
          // With no pipeline to generate, the step needs nothing but the checkout.
          BUILDKITE_MESSAGE: "a commit [skip ci]",
          ...env,
        },
      },
    );
    return {
      calls,
      requests,
      stderr,
      exitCode,
      skippedAsDocs: stdout.includes("- PR is only docs, skipping tests!"),
      stored: Object.fromEntries(Object.entries(metaData).map(([key, value]) => [key, JSON.parse(value) as string[]])),
    };
  }

  test.concurrent("uploads nothing for a pull request that only changes docs", async () => {
    expect(
      await runPipelineStep({
        start: { "docs/index.md": "a page\n", "src/index.ts": "" },
        head: { "docs/index.md": "a better page\n", "docs/new.md": "", "src/index.ts": "" },
      }),
    ).toEqual({ calls: [], requests: [], stderr: "", exitCode: 0, skippedAsDocs: true, stored: {} });
  });

  // No list is not a list of only docs: the build goes on.
  test.concurrent("does not take a pull request for docs-only when its checkout cannot tell", async () => {
    const { stderr, ...rest } = await runPipelineStep(
      { start: { "docs/index.md": "a page\n" }, head: { "docs/index.md": "a better page\n" } },
      { BUILDKITE_PULL_REQUEST_BASE_BRANCH: "gone" },
    );
    expect(stderr).toStartWith("- PR 45177, no file list: ");
    expect(rest).toEqual({ calls: [], requests: [], exitCode: 0, skippedAsDocs: false, stored: {} });
  });

  // 500 files in path order: the 249 moved pages at their new paths and at their old ones, src/index.ts, and the test.
  test.concurrent("stores every file of a pull request with 500 files", async () => {
    const { start, head } = moveDocs(249, { "src/index.ts": "" });
    expect(await runPipelineStep({ start, head: { ...head, "test/js/added.test.ts": "" } })).toEqual({
      calls: ["buildkite-agent meta-data set pr-all-files", "buildkite-agent meta-data set pr-new-files"],
      requests: [],
      stderr: "",
      exitCode: 0,
      skippedAsDocs: false,
      stored: {
        "pr-all-files": [...pages("docs/new", 249), ...pages("docs/old", 249), "src/index.ts", "test/js/added.test.ts"],
        "pr-new-files": [...pages("docs/new", 249), "test/js/added.test.ts"],
      },
    });
  });

  // 502 files. The 250 moved pages fill the first 500 places in path order, so the two files that are not under docs/
  // come after them. A shard uses the files under test/: the test is stored, and the last page and src/new.ts are not.
  test.concurrent("decides on every file, and stores 500 of them for the test shards, the tests first", async () => {
    const { start, head } = moveDocs(250, {});
    expect(await runPipelineStep({ start, head: { ...head, "src/new.ts": "", "test/js/added.test.ts": "" } })).toEqual({
      calls: ["buildkite-agent meta-data set pr-all-files", "buildkite-agent meta-data set pr-new-files"],
      requests: [],
      stderr: "",
      exitCode: 0,
      skippedAsDocs: false,
      stored: {
        "pr-all-files": [...pages("docs/new", 250), ...pages("docs/old", 249), "test/js/added.test.ts"],
        "pr-new-files": [...pages("docs/new", 250), "test/js/added.test.ts"],
      },
    });
  });

  // scripts/agent.ts is one of the files that CI's images are baked from, and a fork's build cannot bake.
  test.concurrent("refuses a fork that changes a bake input, wherever the file is in the list", async () => {
    const { stderr, ...rest } = await runPipelineStep(moveDocs(250, { "scripts/agent.ts": "" }), {
      BUILDKITE_PULL_REQUEST_REPO: "https://github.com/a-fork/bun.git",
      BUILDKITE_MESSAGE: "a commit",
    });
    expect(stderr).toContain("This pull request changes what CI's images are baked from (scripts/agent.ts)");
    expect(rest).toEqual({
      calls: ["buildkite-agent meta-data set pr-all-files", "buildkite-agent meta-data set pr-new-files"],
      requests: [],
      exitCode: 1,
      skippedAsDocs: false,
      stored: {
        "pr-all-files": [...pages("docs/new", 250), ...pages("docs/old", 250)],
        "pr-new-files": pages("docs/new", 250),
      },
    });
  });
});

describe.skipIf(skip)("a test shard", () => {
  /** Starts the runner as a shard of a build for pull request `pullRequest` ("false" when the build has none). */
  async function runShard(pullRequest: string, metaData: Record<string, string>) {
    const { calls, requests, stdout, stderr, exitCode } = await runNode(
      dir => [join(root, "scripts", "runner.node.ts"), "--quiet", `--exec-path=${join(dir, "no-such-bun")}`],
      {
        metaData,
        // In CI the shard that runs this test has EXPECTED_PLATFORM_OS, which makes a runner check its machine first.
        env: { BUILDKITE: "true", BUILDKITE_PULL_REQUEST: pullRequest, EXPECTED_PLATFORM_OS: undefined },
      },
    );
    // The runner read the list, and stopped where it looks for the bun to test.
    expect(stderr).toContain("Could not find executable:");
    expect(exitCode).toBe(1);
    return { calls, requests, listLines: stdout.split("\n").filter(line => line.includes("PR file list")) };
  }

  test.concurrent("reads the list that the pipeline step stored", async () => {
    expect(
      await runShard("45177", {
        "pr-all-files": `["test/js/bun/changed.test.ts","test/js/bun/added.test.ts"]`,
        "pr-new-files": `["test/js/bun/added.test.ts"]`,
      }),
    ).toEqual({
      calls: ["buildkite-agent meta-data get pr-all-files", "buildkite-agent meta-data get pr-new-files"],
      requests: [],
      listLines: ["- PR file list from build meta-data: 2 files, 1 new files"],
    });
  });

  test.concurrent("does not ask GitHub when the pipeline step stored no list", async () => {
    expect(await runShard("45177", {})).toEqual({
      calls: ["buildkite-agent meta-data get pr-all-files"],
      requests: [],
      listLines: ["- No PR file list in build meta-data: changed tests do not run first"],
    });
  });

  test.concurrent("looks for no list when the build is not for a pull request", async () => {
    expect(await runShard("false", {})).toEqual({ calls: [], requests: [], listLines: [] });
  });
});

describe.skipIf(skip)("getSecret", () => {
  test.concurrent("fetches a secret once and does not pass it on to child processes", async () => {
    expect(
      await runScript(
        `const fetched = [buildkite.getSecret("TEST_REPORTING_API"), buildkite.getSecret("TEST_REPORTING_API")];
         const fromEnvironment = buildkite.getSecret("CI_QUEUE_PROBE_TOKEN");
         return { fetched, fromEnvironment, inherited: inherited("TEST_REPORTING_API") };`,
        { env: { BUILDKITE: "true", CI_QUEUE_PROBE_TOKEN: "set-by-the-environment" } },
      ),
    ).toEqual({
      calls: ["buildkite-agent secret get TEST_REPORTING_API"],
      requests: [],
      stderr: "",
      result: {
        fetched: ["secret-of-TEST_REPORTING_API", "secret-of-TEST_REPORTING_API"],
        fromEnvironment: "set-by-the-environment",
        inherited: "unset",
      },
    });
  });

  // Off Buildkite, getJson() sends GitHub the token that `gh auth token` prints.
  test.concurrent("asks gh for the GitHub token once and does not pass it on to child processes", async () => {
    const url = "https://api.github.com/repos/oven-sh/bun/releases/latest";
    expect(
      await runScript(
        `await buildkite.getJson(${JSON.stringify(url)});
         await buildkite.getJson(${JSON.stringify(url)});
         return inherited("GITHUB_TOKEN");`,
        {},
      ),
    ).toEqual({
      calls: ["gh auth token"],
      requests: [`${url} Bearer token-of-gh`, `${url} Bearer token-of-gh`],
      stderr: "",
      result: "unset",
    });
  });
});
