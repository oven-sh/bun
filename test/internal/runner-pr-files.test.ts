/**
 * A pull request's build runs the test files that the pull request changes
 * first. The pipeline step (.buildkite/ci.ts) works out which files those are,
 * once per build, and stores the list in the build's meta-data:
 * getPullRequestFiles() in scripts/buildkite.ts reads it from the history its
 * checkout has. A test shard (scripts/runner.node.ts) only reads the stored
 * list. It never asks GitHub, where the shards of every build would spend the
 * hourly quota of one token.
 *
 * The scripts run the way CI runs them, with node, and with stand-ins for what
 * they reach outside the checkout: `buildkite-agent` and `gh` are shell
 * scripts on PATH that log every call (the build's meta-data is a directory),
 * and fetch() is a preload that logs what it is asked and answers with a file
 * list. The runner gets an `--exec-path` that does not exist, so it stops as
 * soon as it has read the list.
 *
 * The last part is about getSecret() in scripts/buildkite.ts: a secret it
 * fetches must not be written to process.env, because every child process
 * inherits that, the tests the runner starts included.
 *
 * Shell-script stand-ins don't resolve as executables on Windows, hence the skip.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, nodeExe, tempDir } from "harness";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const scripts = join(import.meta.dir, "..", "..", "scripts");

const fakeAgent = `#!/bin/sh
root=$(dirname "$0")/..
echo "buildkite-agent $*" >> "$root/calls.log"
case "$1 $2" in
  "meta-data get") [ -f "$root/meta-data/$3" ] && cat "$root/meta-data/$3" ;;
  "secret get") echo "secret-of-$3" ;;
  *) exit 1 ;;
esac
`;

const fakeGh = `#!/bin/sh
echo "gh $*" >> "$(dirname "$0")/../calls.log"
[ "$1 $2" = "auth token" ] && echo token-of-gh
`;

/** What the fetch() stand-in answers: GitHub's list of the files of a pull request. */
const githubFiles = [
  { filename: "test/js/bun/changed.test.ts", status: "modified" },
  { filename: "test/js/bun/added.test.ts", status: "added" },
];

const fakeFetch = `
import { appendFileSync } from "node:fs";
import { join } from "node:path";

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  appendFileSync(join(import.meta.dirname, "fetch.log"), url + " " + new Headers(init?.headers).get("authorization") + "\\n");
  return Response.json(${JSON.stringify(githubFiles)});
};
`;

const readLines = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : []);

interface Fakes {
  /** The build's meta-data: a file per key. */
  metaData?: Record<string, string>;
  env?: Record<string, string | undefined>;
  /** Fills the directory the script runs in. */
  checkout?: (directory: string) => Promise<void>;
}

/** Runs node with `args` and the stand-ins in place, and reports what it asked them for. */
async function runNode(args: (dir: string) => string[], { metaData = {}, env = {}, checkout }: Fakes) {
  using dir = tempDir("runner-pr-files", {
    "bin/buildkite-agent": fakeAgent,
    "bin/gh": fakeGh,
    // The runner reads kernel.core_pattern on Linux and rejects a piped one.
    "bin/sysctl": "#!/bin/sh\necho core\n",
    "fetch.mjs": fakeFetch,
    "meta-data": metaData,
    "checkout": {},
  });
  const bin = join(String(dir), "bin");
  for (const name of ["buildkite-agent", "gh", "sysctl"]) {
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
  return {
    calls: readLines(join(String(dir), "calls.log")),
    requests: readLines(join(String(dir), "fetch.log")),
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
    import * as buildkite from ${JSON.stringify(join(scripts, "buildkite.ts"))};
    const inherited = name => spawnSync("sh", ["-c", 'printf %s "\${' + name + '-unset}"'], { encoding: "utf8" }).stdout;
    console.log(JSON.stringify(await (async () => { ${body} })()));
  `;
  const { stdout, stderr, exitCode, ...asked } = await runNode(() => ["--input-type=module", "-e", script], fakes);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  // The scripts log to stdout too: the result is the last line.
  return { ...asked, result: JSON.parse(stdout.trimEnd().split("\n").at(-1)!) };
}

const gitEnv = {
  ...bunEnv,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function git(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: ["git", ...args], cwd, env: gitEnv, stdout: "ignore", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} exited with ${exitCode}: ${stderr}`);
}

/**
 * Makes `directory` the checkout of a pull request's commit: it is one commit
 * (`change` makes it, on the files of `base`) after the commit where the pull
 * request left `main`, and origin's `main` has moved on since.
 */
async function checkOutPullRequest(directory: string, base: Record<string, string>, change: () => Promise<unknown>) {
  const commit = async (message: string) => {
    await git(directory, "add", "-A");
    await git(directory, "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", message);
  };
  await git(directory, "-c", "init.defaultBranch=main", "init", "--quiet");
  for (const [path, contents] of Object.entries(base)) {
    await Bun.write(join(directory, path), contents);
  }
  await commit("where the pull request starts");
  await Bun.write(join(directory, "src/only-on-main.ts"), "export {};\n");
  await commit("main moves on");
  await git(directory, "update-ref", "refs/remotes/origin/main", "HEAD");
  await git(directory, "checkout", "--quiet", "-b", "pull-request", "HEAD~1");
  await change();
  await commit("the pull request");
}

const pullRequestEnv = {
  BUILDKITE: "true",
  BUILDKITE_PULL_REQUEST: "45177",
  BUILDKITE_PULL_REQUEST_BASE_BRANCH: "main",
};

const skip = isWindows || !nodeExe();

describe.skipIf(skip)("the pipeline step", () => {
  test.concurrent("lists the files of the pull request from the history of its checkout", async () => {
    expect(
      await runScript(`return await buildkite.getPullRequestFiles();`, {
        env: pullRequestEnv,
        checkout: directory =>
          checkOutPullRequest(
            directory,
            {
              "src/changed.ts": "export const before = 1;\n",
              "src/removed.ts": "export {};\n",
              "test/old-name.test.ts": "import { test } from 'bun:test';\ntest('moves', () => {});\n",
            },
            async () => {
              await Bun.write(join(directory, "src/changed.ts"), "export const after = 2;\n");
              await git(directory, "rm", "--quiet", "src/removed.ts");
              await git(directory, "mv", "test/old-name.test.ts", "test/new-name.test.ts");
              await Bun.write(
                join(directory, "test/added.test.ts"),
                "import { test } from 'bun:test';\ntest('new', () => {});\n",
              );
            },
          ),
      }),
    ).toEqual({
      // Neither the token nor a request: the list is the diff against the commit where the pull request left main.
      // src/only-on-main.ts, which main got later, is not in it.
      calls: [],
      requests: [],
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

  // The list is stored as one meta-data value, which Buildkite limits to 100 KB.
  test.concurrent("lists the first 500 files of a bigger pull request", async () => {
    const name = (i: number) => `added/${String(i).padStart(3, "0")}.ts`;
    expect(
      await runScript(
        `const { allFiles, newFiles } = await buildkite.getPullRequestFiles();
         return { files: allFiles.length, first: allFiles[0], last: allFiles.at(-1), newFiles: newFiles.length };`,
        {
          env: pullRequestEnv,
          checkout: directory =>
            checkOutPullRequest(directory, { "src/index.ts": "export {};\n" }, async () => {
              for (let i = 0; i <= 500; i++) {
                await Bun.write(join(directory, name(i)), "export {};\n");
              }
            }),
        },
      ),
    ).toEqual({
      calls: [],
      requests: [],
      result: { files: 500, first: name(0), last: name(499), newFiles: 500 },
    });
  });

  // A shallow clone can give a merge base that is not the real one, so its answer is not used.
  test.concurrent("asks GitHub when its checkout is a shallow clone", async () => {
    expect(
      await runScript(`return await buildkite.getPullRequestFiles();`, {
        env: pullRequestEnv,
        checkout: async directory => {
          using origin = tempDir("runner-pr-files-origin", {});
          await checkOutPullRequest(String(origin), { "src/changed.ts": "export const before = 1;\n" }, () =>
            Bun.write(join(String(origin), "src/changed.ts"), "export const after = 2;\n"),
          );
          // Two commits deep: the pull request's commit and main's both still reach the commit they share.
          await git(directory, "clone", "--quiet", "--depth=2", "--no-single-branch", `file://${origin}`, ".");
        },
      }),
    ).toEqual({
      calls: ["buildkite-agent secret get GITHUB_TOKEN"],
      requests: [
        "https://api.github.com/repos/oven-sh/bun/pulls/45177/files?per_page=50&page=1 Bearer secret-of-GITHUB_TOKEN",
      ],
      result: {
        allFiles: ["test/js/bun/changed.test.ts", "test/js/bun/added.test.ts"],
        newFiles: ["test/js/bun/added.test.ts"],
      },
    });
  });
});

describe.skipIf(skip)("a test shard", () => {
  /** Starts the runner as a shard of a build for pull request `pullRequest` ("false" when the build has none). */
  async function runShard(pullRequest: string, metaData: Record<string, string>) {
    const { stdout, stderr, exitCode, ...asked } = await runNode(
      dir => [join(scripts, "runner.node.ts"), "--quiet", `--exec-path=${join(dir, "no-such-bun")}`],
      {
        metaData,
        // In CI the shard that runs this test has EXPECTED_PLATFORM_OS, which makes a runner check its machine first.
        env: { BUILDKITE: "true", BUILDKITE_PULL_REQUEST: pullRequest, EXPECTED_PLATFORM_OS: undefined },
      },
    );
    // The runner read the list, and stopped where it looks for the bun to test.
    expect(stderr).toContain("Could not find executable:");
    expect(exitCode).toBe(1);
    return { ...asked, listLines: stdout.split("\n").filter(line => line.includes("PR file list")) };
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
      result: "unset",
    });
  });
});
