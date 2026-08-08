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
import { rmSync } from "node:fs";
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
  // path regardless of where the test runs.
  rmSync(pipelinePath, { force: true });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(BUILDKITE|GITHUB_)/.test(name) && name !== "CI"),
  );
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
  const unbounded = rules.filter(rule => typeof rule.limit !== "number" || rule.limit < 1 || rule.limit > 2);
  expect(unbounded).toEqual([]);
}, 90_000);
