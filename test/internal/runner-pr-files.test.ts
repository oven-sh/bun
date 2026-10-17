/**
 * A Buildkite build asks GitHub once for the files of its pull request: the
 * pipeline step (.buildkite/ci.ts) does, and stores the list in the build's
 * meta-data. A test shard (scripts/runner.node.ts) only reads that list. A
 * build has about 160 shards and they share one token, so shards that ask
 * GitHub themselves spend the token's hourly quota for the builds that follow.
 *
 * The first half starts the real runner with `buildkite-agent` replaced by a
 * shell script on PATH (the build's meta-data is a directory, and every call
 * is logged) and fetch() replaced by a preload that logs what it is asked and
 * answers with a file list. `--exec-path` names a file that does not exist, so
 * the runner stops as soon as it has read the list.
 *
 * The second half is about getSecret() in scripts/buildkite.ts: a secret it
 * fetches must not be written to process.env, because every child process
 * inherits that, the tests the runner starts included.
 *
 * Shell-script fakes don't resolve as executables on Windows, hence the skip.
 * Each case loads the scripts in a fresh process, which takes a few seconds in
 * a debug build, hence the timeouts.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

const fakeFetch = `
import { appendFileSync } from "node:fs";
import { join } from "node:path";

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  appendFileSync(join(import.meta.dir, "fetch.log"), url + " " + new Headers(init?.headers).get("authorization") + "\\n");
  return Response.json([
    { filename: "test/js/bun/changed.test.ts", status: "modified" },
    { filename: "test/js/bun/added.test.ts", status: "added" },
  ]);
};
`;

const readLines = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : []);

interface Fakes {
  /** The build's meta-data: a file per key. */
  metaData?: Record<string, string>;
  env?: Record<string, string | undefined>;
}

/** Runs bun with `args` and the fakes in place, and reports what it asked them for. */
async function runWithFakes(args: (dir: string) => string[], { metaData = {}, env = {} }: Fakes) {
  using dir = tempDir("runner-pr-files", {
    "bin/buildkite-agent": fakeAgent,
    "bin/gh": fakeGh,
    // The runner reads kernel.core_pattern on Linux and rejects a piped one.
    "bin/sysctl": "#!/bin/sh\necho core\n",
    "fetch.ts": fakeFetch,
    "meta-data": metaData,
  });
  const bin = join(String(dir), "bin");
  for (const name of ["buildkite-agent", "gh", "sysctl"]) {
    chmodSync(join(bin, name), 0o755);
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", join(String(dir), "fetch.ts"), ...args(String(dir))],
    env: {
      ...bunEnv,
      PATH: `${bin}:${bunEnv.PATH}`,
      // Whoever runs this test may have either in the environment.
      GITHUB_TOKEN: undefined,
      TEST_REPORTING_API: undefined,
      ...env,
    },
    cwd: String(dir),
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

describe.skipIf(isWindows)("a test shard on Buildkite", () => {
  /** Starts the runner as a shard of a build for pull request `pullRequest` ("false" when the build has none). */
  async function runShard(pullRequest: string, metaData: Record<string, string>) {
    const { stdout, stderr, exitCode, ...asked } = await runWithFakes(
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

  test.concurrent(
    "reads the PR file list that the pipeline step stored",
    async () => {
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
    },
    30_000,
  );

  // The pipeline step stores nothing when its query fails (GitHub answers 403
  // once the token's quota is spent) or finds no files.
  test.concurrent(
    "does not ask GitHub when the pipeline step stored no list",
    async () => {
      expect(await runShard("45177", {})).toEqual({
        calls: ["buildkite-agent meta-data get pr-all-files"],
        requests: [],
        listLines: ["- No PR file list in build meta-data: changed tests do not run first"],
      });
    },
    30_000,
  );

  test.concurrent(
    "looks for no list when the build is not for a pull request",
    async () => {
      expect(await runShard("false", {})).toEqual({ calls: [], requests: [], listLines: [] });
    },
    30_000,
  );
});

describe.skipIf(isWindows)("getSecret", () => {
  /**
   * Runs `body`, the statements of an async function, with scripts/buildkite.ts
   * imported as `buildkite`. `inherited(name)` is what a child process finds in
   * its environment under `name`.
   */
  async function runScript(body: string, env: Record<string, string>) {
    const script = `
      import { spawnSync } from "node:child_process";
      import * as buildkite from ${JSON.stringify(join(scripts, "buildkite.ts"))};
      const inherited = name => spawnSync("sh", ["-c", 'printf %s "\${' + name + '-unset}"'], { encoding: "utf8" }).stdout;
      console.log(JSON.stringify(await (async () => { ${body} })()));
    `;
    const { stdout, stderr, exitCode, ...asked } = await runWithFakes(() => ["-e", script], { env });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return { ...asked, result: JSON.parse(stdout) };
  }

  test.concurrent(
    "fetches a secret once and does not pass it on to child processes",
    async () => {
      expect(
        await runScript(
          `const fetched = [buildkite.getSecret("TEST_REPORTING_API"), buildkite.getSecret("TEST_REPORTING_API")];
           const fromEnvironment = buildkite.getSecret("CI_QUEUE_PROBE_TOKEN");
           return { fetched, fromEnvironment, inherited: inherited("TEST_REPORTING_API") };`,
          { BUILDKITE: "true", CI_QUEUE_PROBE_TOKEN: "set-by-the-environment" },
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
    },
    30_000,
  );

  // Off Buildkite, getJson() sends GitHub the token that `gh auth token` prints.
  test.concurrent(
    "asks gh for the GitHub token once and does not pass it on to child processes",
    async () => {
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
    },
    30_000,
  );
});
