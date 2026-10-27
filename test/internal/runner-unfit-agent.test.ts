/**
 * A test-bun job downloads the build with `buildkite-agent artifact download` before it runs a
 * test (getExecPathFromBuildkite in scripts/runner.node.ts). When the download times out, the
 * machine failed and not the commit. The runner then makes sure that a retry cannot come back
 * to that machine (quarantineBuildkiteAgent in scripts/buildkite.ts) and exits with the status
 * that the step retries (unfitAgentRetry). When it cannot make sure of that, the job fails as
 * it did before, because the queue would retry it on the same agent.
 *
 * The runner and the pipeline generator run under Node.js, as in CI, from a scratch directory
 * that links to scripts/ and test/. Both write next to where they are (release/ and
 * .buildkite/ci.json), and neither writes under those two directories before it is done here.
 * The only `buildkite-agent` on the runner's PATH is a script that records its arguments.
 * Buildkite runs this file with the real agent on PATH and the job's token in the environment,
 * so the runner under test gets neither.
 */
import { describe, expect, test } from "bun:test";
import { isWindows, nodeExeAtLeast, tempDir } from "harness";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { hostname } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { unfitAgentRetry } from "../../scripts/buildkite.ts";

const repoRoot = join(import.meta.dir, "..", "..");
/** scripts/agent.ts refuses an older Node.js. */
const node = nodeExeAtLeast("24.2.0");

async function run(cmd: string[], options: { cwd?: string; env: Record<string, string | undefined> }) {
  await using proc = Bun.spawn({ cmd, ...options, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const fakeAgent = `#!/bin/sh
echo "$*" >> "$CALLS"
case "$1" in
  artifact)
    [ "$DOWNLOAD" = hangs ] && exec sleep 30
    echo "not a zip" > "$4/bun.zip"
    exit 1 ;;
  pause)
    case "$PAUSE" in
      refused) echo "401 Unauthorized" >&2; exit 1 ;;
      killed) kill -KILL $$ ;;
      hangs) exec sleep 30 ;;
    esac ;;
  annotate) cat > "$CALLS.annotation" ;;
  meta-data) [ "$2" = set ] ;;
esac
`;

// The runner gives the download two minutes and `buildkite-agent pause` thirty seconds. A job
// here does not wait that long for a fake agent that never answers.
const shortWaits = `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

if (process.env.DOWNLOAD === "hangs") {
  const { setTimeout } = globalThis;
  globalThis.setTimeout = (callback, ms, ...args) => setTimeout(callback, ms >= 120_000 ? 1 : ms, ...args);
}
if (process.env.PAUSE === "hangs") {
  const { spawnSync } = childProcess;
  childProcess.spawnSync = (command, args, options) =>
    spawnSync(command, args, args?.[0] === "pause" && options.timeout ? { ...options, timeout: 100 } : options);
  syncBuiltinESMExports();
}
`;

/** Runs a job on an agent with these variables, and returns what the runner did once the download had ended. */
async function runJob(agent: Record<string, string>) {
  using dir = tempDir("runner-unfit-agent", {
    "bin/buildkite-agent": fakeAgent,
    // On Linux the runner asks for kernel.core_pattern and refuses a pipe.
    "bin/sysctl": "#!/bin/sh\necho core\n",
    "bin/unzip": "#!/bin/sh\nexit 9\n",
    "short-waits.mjs": shortWaits,
    "calls": "",
  });
  const root = String(dir);
  for (const name of ["buildkite-agent", "sysctl", "unzip"]) {
    chmodSync(join(root, "bin", name), 0o755);
  }
  for (const name of ["scripts", "test"]) {
    symlinkSync(join(repoRoot, name), join(root, name));
  }

  const { stderr, exitCode } = await run(
    [
      node!,
      "--preserve-symlinks",
      "--preserve-symlinks-main",
      "--import",
      pathToFileURL(join(root, "short-waits.mjs")).href,
      join(root, "scripts", "runner.node.ts"),
      "--quiet",
      "--step=build-step",
    ],
    {
      env: {
        PATH: join(root, "bin") + delimiter + process.env.PATH,
        CALLS: join(root, "calls"),
        DOWNLOAD: "hangs",
        PAUSE: "accepted",
        BUILDKITE: "true",
        BUILDKITE_BUILD_URL: "https://buildkite.example/builds/1",
        BUILDKITE_JOB_ID: "job",
        BUILDKITE_LABEL: "macOS - test-bun",
        BUILDKITE_AGENT_NAME: "agent-1",
        BUILDKITE_AGENT_ID: "agent-id",
        BUILDKITE_RETRY_COUNT: "0",
        // Where a real buildkite-agent would send its requests, if one ran after all.
        BUILDKITE_AGENT_ENDPOINT: "http://127.0.0.1:1/v3",
        BUILDKITE_AGENT_ACCESS_TOKEN: "none",
        ...agent,
      },
    },
  );
  const calls = readFileSync(join(root, "calls"), "utf8")
    .split("\n")
    .filter(call => call && !call.startsWith("artifact download ") && !call.startsWith("meta-data get "));
  const annotation = existsSync(join(root, "calls.annotation"))
    ? readFileSync(join(root, "calls.annotation"), "utf8")
    : null;
  return { stderr, calls, annotation, exitCode };
}

const timedOut = "buildkite-agent artifact download timed out after 120s for step 'build-step'";
const asBefore = `Error: ${timedOut}. Refusing to continue with a partial download (would silently fall back to the wrong binary).`;

const paused = "the agent is paused until its host reboots or a person resumes it";
const oneJobMachine = "its machine runs no other job";
const oneJobGuest = "its guest runs no other job";
const details = (quarantine: string) => `${timedOut}.\nHost ${hostname()}, agent agent-1 (agent-id): ${quarantine}.`;

const pause = `pause --note ${timedOut} (https://buildkite.example/builds/1#job). Resume the agent if its host is healthy. --timeout-in-minutes 1440`;
const pauseFailed = (cause: string) =>
  `buildkite-agent pause failed (${cause}): a retry would come back to this agent, so the job fails`;

/** What a job does when the step runs it again on another machine. */
const retriedElsewhere = (quarantine: string, calls: string[] = []) => ({
  says: [details(quarantine), "Exit status 75 asks Buildkite to run the job on another machine."],
  calls: [
    ...calls,
    "annotate --append --style warning --context unfit-agent --priority 3",
    "meta-data set reported-job 1",
  ],
  annotation:
    `<details><summary><a><code>unfit agent</code></a> - ${timedOut.replaceAll("'", "&#039;")}` +
    ` on <a href="https://buildkite.example/builds/1#job">macOS</a></summary>\n\n` +
    `\`\`\`terminal\n${details(quarantine)}\n\`\`\`\n\n</details>\n\n`,
  exitCode: unfitAgentRetry.exit_status,
});
/** What a job does when it fails as it did before. */
const fails = (says: string[] = [], calls: string[] = []) => ({
  says: [asBefore, ...says],
  calls,
  annotation: null,
  exitCode: 1,
});

const cloud = { BUILDKITE_AGENT_META_DATA_EPHEMERAL: "true" };
const tart = { BUILDKITE_AGENT_META_DATA_TART: "true", BUILDKITE_AGENT_META_DATA_RELEASE: "26" };
const bareMetal = (release: string, tier = "latest") => ({
  BUILDKITE_AGENT_META_DATA_EPHEMERAL: "false",
  BUILDKITE_AGENT_META_DATA_RELEASE: release,
  BUILDKITE_AGENT_META_DATA_RELEASE_TIER: tier,
});
/** The pipeline lets a job pause its agent. */
const pauseOn = { BUN_RUNNER_PAUSE_UNFIT_AGENT: "1" };
const mini = { ...bareMetal("26"), ...pauseOn };

describe.skipIf(isWindows || !node)("a job whose build download times out", () => {
  test.concurrent.each([
    ["pauses a bare-metal mac on macOS 26, then exits 75", mini, retriedElsewhere(paused, [pause])],
    ["exits 75 on a cloud agent and does not pause it", cloud, retriedElsewhere(oneJobMachine)],
    ["exits 75 on a tart agent and does not pause it", tart, retriedElsewhere(oneJobGuest)],
    [
      "fails as before when it is a retry, and pauses no second agent",
      { ...mini, BUILDKITE_RETRY_COUNT: "1" },
      fails(),
    ],
    ["fails as before on a cloud agent when it is a retry", { ...cloud, BUILDKITE_RETRY_COUNT: "1" }, fails()],
    ["fails as before where the pipeline does not turn the pause on", bareMetal("26"), fails()],
    [
      "fails as before where the pipeline turns the pause off",
      { ...bareMetal("26"), BUN_RUNNER_PAUSE_UNFIT_AGENT: "0" },
      fails(),
    ],
    ["fails as before on a bare-metal mac on an older macOS", { ...bareMetal("15", "previous"), ...pauseOn }, fails()],
    ["fails as before on the one box of the beta tier", { ...bareMetal("27", "beta"), ...pauseOn }, fails()],
    [
      "fails as before on a mac that scripts/agent.ts did not tag",
      { BUILDKITE_AGENT_META_DATA_RELEASE: "26", ...pauseOn },
      fails(),
    ],
    ["fails as before outside Buildkite", { ...mini, BUILDKITE: "false" }, fails()],
    [
      "fails as before when Buildkite refuses the pause",
      { ...mini, PAUSE: "refused" },
      fails([pauseFailed("exit code 1"), "401 Unauthorized"], [pause]),
    ],
    [
      "fails as before when the pause is killed",
      { ...mini, PAUSE: "killed" },
      fails([pauseFailed("SIGKILL")], [pause]),
    ],
    [
      "fails as before when the pause does not return",
      { ...mini, PAUSE: "hangs" },
      fails([pauseFailed("spawnSync buildkite-agent ETIMEDOUT")], [pause]),
    ],
  ])("%s", async (_, agent, { says, ...expected }) => {
    const { stderr, ...job } = await runJob(agent);
    for (const line of says) expect(stderr).toContain(line);
    expect(job).toEqual(expected);
  });

  // The commit or the pipeline is why this job has no build, and every agent would fail it alike.
  test.concurrent("leaves the agent alone when the download fails in another way", async () => {
    const { stderr, ...job } = await runJob({ ...mini, DOWNLOAD: "breaks" });
    expect(stderr).toContain("Command exited with code 9: unzip");
    expect(job).toEqual({ calls: [], annotation: null, exitCode: 1 });
  });
});

describe.skipIf(isWindows || !node)("the pipeline", () => {
  interface Rule {
    exit_status?: number | string;
    signal_reason?: string;
  }
  interface Step {
    key: string;
    steps?: Step[];
    retry?: { automatic?: Rule[] | false };
  }

  test.concurrent("retries the exit status of the runner on each test-bun step, and on no other step", async () => {
    using dir = tempDir("runner-unfit-agent-pipeline", {});
    const root = String(dir);
    mkdirSync(join(root, ".buildkite"));
    copyFileSync(join(repoRoot, ".buildkite", "ci.ts"), join(root, ".buildkite", "ci.ts"));
    symlinkSync(join(repoRoot, "scripts"), join(root, "scripts"));
    // The generator reads the options of a build from its commit message. It asks GitHub for the
    // canary revision unless the build is of a pull request.
    const env = {
      PATH: process.env.PATH,
      HOME: root,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REPOSITORY: "oven-sh/bun",
      GITHUB_SHA: "0000000000000000000000000000000000000000",
      GITHUB_REF_NAME: "1/merge",
      GITHUB_HEAD_REF: "a-branch",
    };
    for (const cmd of [
      ["git", "init", "--quiet", "--initial-branch=main"],
      ["git", "commit", "--quiet", "--allow-empty", "--message=a commit"],
      [node!, "--preserve-symlinks", "--preserve-symlinks-main", join(root, ".buildkite", "ci.ts")],
    ]) {
      const { stdout, stderr, exitCode } = await run(cmd, { cwd: root, env });
      if (exitCode !== 0) throw new Error(`${cmd.join(" ")} exited with ${exitCode}:\n${stdout}\n${stderr}`);
    }

    const pipeline = JSON.parse(readFileSync(join(root, ".buildkite", "ci.json"), "utf8")) as { steps: Step[] };
    const steps = pipeline.steps.flatMap(step => step.steps ?? [step]);
    const rules = steps.flatMap(({ key, retry }) => (retry?.automatic || []).map(rule => ({ key, ...rule })));

    const testBun = steps.map(({ key }) => key).filter(key => key.endsWith("-test-bun"));
    expect(testBun.length).toBeGreaterThan(1);
    expect(rules.filter(rule => rule.exit_status === 75)).toEqual(testBun.map(key => ({ key, ...unfitAgentRetry })));

    // A rule that names an exit status and no signal reason also matches `cancel`, which is what a job killed
    // by `timeout_in_minutes` records: every timed-out shard is then run again, to time out again.
    expect(rules.filter(rule => "exit_status" in rule && !("signal_reason" in rule))).toEqual([
      // A step of seconds that reports, and never times out.
      { key: "binary-size", exit_status: "*", limit: 2 },
    ]);
    // The runner exits with 1, 2 or 3 when no other machine would do better.
    expect(unfitAgentRetry).toEqual({ exit_status: 75, signal_reason: "none", limit: 1 });
  });
});
