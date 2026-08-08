/**
 * Guards the automatic-retry invariants of the generated Buildkite pipeline
 * (.buildkite/ci.mjs).
 *
 * A Buildkite retry rule that names an `exit_status` but no `signal_reason`
 * defaults signal_reason to "*", which matches `cancel` — the reason a
 * `timeout_in_minutes` kill records. Such a rule re-queues every timed-out
 * shard just to time out again: a blanket `exit_status: 255` rule shipped in
 * #32072 and burned ~670 automatic retries across ~200 builds before #34684
 * scoped it out. `bk pipeline validate` cannot catch this (the broken rule is
 * schema-valid), so this test parses the emitted YAML and asserts the
 * invariant on every step, including hand-written stanzas outside getRetry().
 */
import { expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const pipelinePath = join(repoRoot, ".buildkite", "ci.yml");

/** One automatic-retry rule, tagged with the step it came from. */
interface RetryRule {
  stepKey: string;
  exit_status?: number | string;
  signal_reason?: string;
  limit?: number;
}

function collectRules(steps: unknown, rules: RetryRule[] = []): RetryRule[] {
  if (!Array.isArray(steps)) return rules;
  for (const step of steps as Record<string, any>[]) {
    if (step.group) collectRules(step.steps, rules);
    const automatic = step.retry?.automatic;
    if (Array.isArray(automatic)) {
      for (const rule of automatic) {
        rules.push({ stepKey: step.key ?? step.label ?? "<unknown>", ...rule });
      }
    }
  }
  return rules;
}

test("every automatic retry rule in the generated pipeline is scoped by signal_reason", async () => {
  // Generate the pipeline exactly as CI does, onto a clean slate so a broken
  // generator cannot pass against a stale ci.yml from an earlier run.
  // CI-detection env vars are dropped so the generator takes its plain local
  // path regardless of where the test runs. Outside CI the only network the
  // generator touches is getCanaryRevision()'s two GitHub API calls, which
  // degrade gracefully to revision 1 on any error; answering them locally
  // with 404 (non-retryable in scripts/utils.mjs curl()) keeps the test off
  // the network and fast instead of riding curl's multi-second retry backoff.
  rmSync(pipelinePath, { force: true });
  try {
    await using github = Bun.serve({
      port: 0,
      fetch: () => new Response("{}", { status: 404 }),
    });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^(BUILDKITE|GITHUB_)/.test(name) && name !== "CI"),
    );
    env.GITHUB_API_URL = String(github.url);
    await using proc = Bun.spawn({
      cmd: ["node", join(repoRoot, ".buildkite", "ci.mjs")],
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      console.error(`ci.mjs exited ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    expect(exitCode).toBe(0);

    // Outside CI the generator takes the commit message and branch from the
    // checkout's actual git state, and a HEAD subject carrying [skip ci] /
    // [no ci] legitimately produces no pipeline at all. That cannot happen
    // where this lint gates (GitHub skips push workflows for such commits,
    // and PR / merge-queue HEADs are synthetic merge commits), so treat it
    // as a clean local no-op instead of a confusing missing-file failure.
    if (stdout.includes("Generated pipeline is empty")) {
      console.warn("HEAD's commit message skips CI entirely; nothing to lint.");
      return;
    }
    expect(existsSync(pipelinePath)).toBe(true);

    const pipeline = Bun.YAML.parse(await Bun.file(pipelinePath).text()) as {
      steps: unknown;
    };
    const rules = collectRules(pipeline.steps);
    // A refactor that drops retry stanzas entirely must fail here, not pass
    // vacuously.
    expect(rules.length).toBeGreaterThan(0);

    // binary-size deliberately retries on any exit status: it is a
    // seconds-long reporting step, not a 45-minute test shard, so a wasted
    // retry costs nothing. Pin its exact shape so the exemption cannot
    // silently widen.
    const allowlisted = rules.filter(rule => rule.stepKey === "binary-size");
    expect(allowlisted).toEqual([{ stepKey: "binary-size", exit_status: "*", limit: 2 }]);

    const unscoped = rules.filter(
      rule => rule.stepKey !== "binary-size" && "exit_status" in rule && !("signal_reason" in rule),
    );
    expect(unscoped).toEqual([]);

    // Retries hold an agent for up to the full step timeout; keep them bounded.
    const unbounded = rules.filter(
      rule => typeof rule.limit !== "number" || !Number.isInteger(rule.limit) || rule.limit < 1 || rule.limit > 2,
    );
    expect(unbounded).toEqual([]);
  } finally {
    // The generated file is this test's artifact; leave the checkout as it
    // was found whether the assertions passed or failed.
    rmSync(pipelinePath, { force: true });
  }
});
