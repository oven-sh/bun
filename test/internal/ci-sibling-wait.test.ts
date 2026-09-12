/**
 * Unit tests for the build-bun → build-cpp sibling poll in
 * scripts/build/ci.ts::waitForStepOutcome().
 *
 * Buildkite's `step get outcome` reports the last *completed* job, so an
 * earlier attempt that expired in the queue reads as `errored` even while a
 * retry is queued or running. The poll must consult `step get state` (the
 * step-level state: `ready`/`running`/`failing`/`finished`/…) and only give up
 * once that is terminal too. Build 85043's linux-aarch64-build-bun logged
 * `state=running` → `state=finished`, which is the vocabulary these fixtures
 * use.
 */
import { describe, expect, test } from "bun:test";
import { waitForStepOutcome, type StepGetResult } from "../../scripts/build/ci.ts";

type Read = string | { ok: false; err: string };
const fail = (err: string): Read => ({ ok: false, err });

/** Drive `waitForStepOutcome` through a canned sequence of `outcome`/`state` reads. */
function run(script: ReadonlyArray<{ outcome: Read; state: Read }>) {
  let i = 0;
  const get = (_stepKey: string, attr: "outcome" | "state"): StepGetResult => {
    const entry = script[Math.min(i, script.length - 1)]!;
    const v = entry[attr];
    // One poll is `outcome` then (if outcome was ok) `state`; advance after the
    // last read in the poll so both reads see the same entry.
    if (attr === "state" || (attr === "outcome" && typeof v !== "string")) i++;
    return typeof v === "string" ? { ok: true, out: v, err: "" } : { ok: false, out: "", err: v.err };
  };
  return waitForStepOutcome("linux-x64-build-cpp", { pollMs: 0, get });
}

describe.concurrent("waitForStepOutcome", () => {
  test("resolves once the sibling passes", async () => {
    await run([
      { outcome: "", state: "running" },
      { outcome: "passed", state: "finished" },
    ]);
  });

  test("keeps polling while a retry is queued after an earlier error", async () => {
    // Build 84838: attempt 1 expired (outcome=errored), attempt 2 sat in the
    // queue. The old outcome-only poll bailed at index 0.
    await run([
      { outcome: "errored", state: "ready" },
      { outcome: "errored", state: "ready" },
      { outcome: "errored", state: "running" },
      { outcome: "passed", state: "finished" },
    ]);
  });

  test("keeps polling through state=failing", async () => {
    // `failing` is a documented non-terminal step state (a job failed but the
    // step has not settled); a retry can still turn it around.
    await run([
      { outcome: "errored", state: "failing" },
      { outcome: "errored", state: "failing" },
      { outcome: "errored", state: "running" },
      { outcome: "passed", state: "finished" },
    ]);
  });

  test("keeps polling through an unknown state value", async () => {
    // A state we have not enumerated must not be mistaken for terminal; the
    // 60 min deadline still bounds the wait.
    await run([
      { outcome: "errored", state: "limiting" },
      { outcome: "errored", state: "limiting" },
      { outcome: "passed", state: "finished" },
    ]);
  });

  test("tolerates the gap between one attempt finishing and its retry appearing", async () => {
    // A retry job is created ~1s after its predecessor ends, so one poll can
    // land on state=finished before the next attempt takes it back to ready.
    await run([
      { outcome: "errored", state: "finished" },
      { outcome: "errored", state: "ready" },
      { outcome: "passed", state: "finished" },
    ]);
  });

  test("throws once the sibling is terminally failed with no retry in flight", async () => {
    await expect(
      run([
        { outcome: "hard_failed", state: "finished" },
        { outcome: "hard_failed", state: "finished" },
      ]),
    ).rejects.toThrow("linux-x64-build-cpp hard_failed");
  });

  test("falls back to outcome when state is unavailable", async () => {
    // A successful-but-empty state must not mask a real failure.
    await expect(
      run([
        { outcome: "errored", state: "" },
        { outcome: "errored", state: "" },
      ]),
    ).rejects.toThrow("linux-x64-build-cpp errored");
  });

  test("treats a failed state read as non-terminal", async () => {
    // `outcome` read in the same poll succeeded, so the agent is up; a flaky
    // `state` read must not count as a terminal observation.
    await run([
      { outcome: "errored", state: fail("502 Bad Gateway") },
      { outcome: "errored", state: fail("502 Bad Gateway") },
      { outcome: "errored", state: "ready" },
      { outcome: "passed", state: "finished" },
    ]);
  });

  test("retries a transient agent error on outcome", async () => {
    await run([
      { outcome: fail("transient 502"), state: "n/a" },
      { outcome: "passed", state: "finished" },
    ]);
  });
});
