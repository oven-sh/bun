/**
 * scripts/runner.node.mjs runs the test files of the packages listed in
 * test/vendor.json after the shard's own test files. It used to throw as soon
 * as one vendor failed to clone (github stalls now and then), which ended the
 * shard before its first test. Setting a vendor up (checkout, install, build)
 * is now a sequence of steps the runner retries and reports like test files,
 * and a step that keeps failing skips only its vendor.
 *
 * The runner takes the repository root from its own location: it reads
 * test/vendor.json there and clones into vendor/ there. So each case runs a
 * copy of it from a temporary repository layout that has one test file of its
 * own and a vendor.json pointing at `upstream`, a local git repository. The
 * copy runs under node, as in CI, with bunExe() as the bun under test.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

// The runner and the files it imports relative to itself. The `bun test`
// processes it spawns read leaksan.supp from <cwd>/test/.
const runnerFiles = [
  "scripts/runner.node.mjs",
  "scripts/utils.mjs",
  "scripts/p-limit.mjs",
  "scripts/yocto-queue.mjs",
  "test/docker/prestart-map.mjs",
  "test/leaksan.supp",
];

const passingTest = `
  import { expect, test } from "bun:test";
  test("passes", () => expect(1).toBe(1));
`;

const node = nodeExe();
const git = Bun.which("git");

const env = {
  ...bunEnv,
  // The copy has to take the runner's local code paths: no docker
  // coordinator, no buildkite-agent, and --retries defaults to 0.
  CI: undefined,
  BUILDKITE: undefined,
  GITHUB_ACTIONS: undefined,
  GIT_AUTHOR_NAME: "runner test",
  GIT_AUTHOR_EMAIL: "runner@example.com",
  GIT_COMMITTER_NAME: "runner test",
  GIT_COMMITTER_EMAIL: "runner@example.com",
};

/**
 * The repository the vendors point at. Tag `1.0.0` builds and has a passing
 * test; tag `bad-build`, which is also the branch head that a clone checks
 * out, fails to build. So a vendor pinned to `1.0.0` passes only if the runner
 * checks the tag out.
 */
let upstreamDir: ReturnType<typeof tempDir> | undefined;
let upstream: string;

async function runGit(...args: string[]): Promise<void> {
  await using proc = Bun.spawn({
    cmd: [git!, "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
    cwd: upstream,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} exited with ${exitCode}:\n${stdout}${stderr}`);
}

const packageJson = (build: string) => JSON.stringify({ name: "upstream", scripts: { build } });

beforeAll(async () => {
  if (!node || !git) return;
  upstreamDir = tempDir("runner-vendor-upstream", {
    "package.json": packageJson("echo built"),
    "test/ok.test.ts": passingTest,
  });
  upstream = String(upstreamDir);
  await runGit("init", "--quiet");
  await runGit("add", ".");
  await runGit("commit", "--quiet", "--message", "builds");
  await runGit("tag", "1.0.0");
  writeFileSync(join(upstream, "package.json"), packageJson("exit 1"));
  await runGit("commit", "--quiet", "--all", "--message", "does not build");
  await runGit("tag", "bad-build");
});

afterAll(() => upstreamDir?.[Symbol.dispose]());

type Vendor = { package: string; tag: string; repository?: string; testPath?: string };

/** A repository layout holding the runner copy, one test file and the given vendor.json. */
function makeRepo(vendors: Vendor[], leftovers: Record<string, string> = {}) {
  return tempDir("runner-vendor", {
    ...Object.fromEntries(runnerFiles.map(file => [file, readFileSync(join(repoRoot, file))])),
    "test/smoke.test.ts": passingTest,
    "test/vendor.json": JSON.stringify(vendors.map(vendor => ({ repository: upstream, ...vendor }))),
    ...leftovers,
  });
}

/** Runs the runner copy in `repo`. Returns the steps it logged, in order, and its exit code. */
async function runRunner(repo: string) {
  await using proc = Bun.spawn({
    cmd: [node!, join(repo, "scripts", "runner.node.mjs"), `--exec-path=${bunExe()}`, "--vendor=true", "--quiet"],
    cwd: repo,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The runner logs "[n/total] <title>" when it starts a step and
  // "[n/total] <title> - <error>" when the step fails.
  const steps = Bun.stripANSI(stdout)
    .split("\n")
    .map(line => /^\s*\[\d+\/\d+\] (.*)$/.exec(line)?.[1])
    .filter((step): step is string => step !== undefined);
  if (steps.length === 0) throw new Error(`the runner ran no step:\n${stdout}${stderr}`);
  return { steps, exitCode };
}

describe.skipIf(!node || !git)("runner.node.mjs vendors", () => {
  test.concurrent("a vendor that cannot be cloned fails on its own, after the shard's own tests", async () => {
    using repo = makeRepo([{ package: "gone", tag: "1.0.0", repository: join(upstream, "does-not-exist") }]);

    expect(await runRunner(String(repo))).toEqual({
      steps: ["test/smoke.test.ts", "vendor/gone", expect.stringMatching(/^vendor\/gone - git clone: code /)],
      exitCode: 1,
    });
  });

  test.concurrent("a failed checkout removes its directory, so that a retry clones anew", async () => {
    // A vendor directory that an interrupted earlier attempt left behind.
    using repo = makeRepo([{ package: "torn", tag: "1.0.0" }], { "vendor/torn/.git": "not a repository" });

    expect(await runRunner(String(repo))).toEqual({
      steps: ["test/smoke.test.ts", "vendor/torn", expect.stringMatching(/^vendor\/torn - git fetch: code /)],
      exitCode: 1,
    });
    expect(existsSync(join(String(repo), "vendor", "torn"))).toBe(false);
  });

  test.concurrent("a tag without the test directory fails the checkout step", async () => {
    using repo = makeRepo([{ package: "layout", tag: "1.0.0", testPath: "spec" }]);

    expect(await runRunner(String(repo))).toEqual({
      steps: ["test/smoke.test.ts", "vendor/layout", "vendor/layout - no test directory 'spec' at 1.0.0"],
      exitCode: 1,
    });
    expect(existsSync(join(String(repo), "vendor", "layout"))).toBe(false);
  });

  test.concurrent("a vendor that fails to build is reported and the next vendor still runs", async () => {
    // Vendors run in package name order.
    using repo = makeRepo([
      { package: "a-bad-build", tag: "bad-build" },
      { package: "b-good", tag: "1.0.0" },
    ]);

    expect(await runRunner(String(repo))).toEqual({
      steps: [
        "test/smoke.test.ts",
        "vendor/a-bad-build",
        "vendor/a-bad-build/package.json",
        "vendor/a-bad-build (bun run build)",
        "vendor/a-bad-build (bun run build) - code 1",
        "vendor/b-good",
        "vendor/b-good/package.json",
        "vendor/b-good (bun run build)",
        "vendor/b-good/test/ok.test.ts",
      ],
      exitCode: 1,
    });
  });

  test.concurrent("a vendor is checked out at its tag, installed, built, and its tests run", async () => {
    using repo = makeRepo([{ package: "good", tag: "1.0.0" }]);

    expect(await runRunner(String(repo))).toEqual({
      steps: [
        "test/smoke.test.ts",
        "vendor/good",
        "vendor/good/package.json",
        "vendor/good (bun run build)",
        "vendor/good/test/ok.test.ts",
      ],
      exitCode: 0,
    });
  });
});
