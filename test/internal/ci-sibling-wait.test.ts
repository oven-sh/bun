/**
 * Unit tests for the build-bun → build-cpp sibling poll in
 * scripts/build/ci.ts::waitForStepOutcome().
 *
 * The poll runs inside CI's rust-and-link step, so it can only be exercised by
 * putting a fake `buildkite-agent` on PATH that plays back a canned sequence of
 * `step get outcome` / `step get state` responses. The regression these tests
 * pin down: Buildkite's `outcome` attribute reports the last *completed* job,
 * so an earlier attempt that expired in the queue reads as `errored` even while
 * a retry is scheduled or running. The poll must look at `state` to tell the
 * two apart.
 */
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { waitForStepOutcome } from "../../scripts/build/ci.ts";

/**
 * Install a fake `buildkite-agent` that serves `step get outcome|state` from
 * `script[i]` on the i-th poll (clamped to the last entry), and run `fn` with
 * it on PATH. `waitForStepOutcome` issues one `outcome` read then one `state`
 * read per poll, so each script entry is consumed once per poll.
 */
async function withFakeAgent<T>(script: Array<{ outcome: string; state: string }>, fn: () => Promise<T>): Promise<T> {
  using dir = tempDir("fake-bk-agent", {
    "script.json": JSON.stringify(script),
    // The real binary is Go; this stub only needs to honour
    // `step get <attr> --step <key>` and count polls.
    "buildkite-agent": `#!/usr/bin/env bash
set -euo pipefail
attr="\${3:-}"
n=0
[ -f "$AGENT_DIR/calls" ] && n=$(cat "$AGENT_DIR/calls")
# One poll = outcome then state; advance the script cursor on state so both
# reads in a poll see the same entry.
if [ "$attr" = "state" ]; then
  echo $((n+1)) > "$AGENT_DIR/calls"
fi
node -e '
  const s = require(process.env.AGENT_DIR + "/script.json");
  const i = Math.min(+process.argv[1], s.length - 1);
  process.stdout.write(s[i][process.argv[2]] ?? "");
' "$n" "$attr"
`,
  });
  chmodSync(join(String(dir), "buildkite-agent"), 0o755);
  const prevPath = process.env.PATH;
  const prevDir = process.env.AGENT_DIR;
  process.env.PATH = `${dir}:${prevPath}`;
  process.env.AGENT_DIR = String(dir);
  try {
    return await fn();
  } finally {
    process.env.PATH = prevPath;
    if (prevDir === undefined) delete process.env.AGENT_DIR;
    else process.env.AGENT_DIR = prevDir;
  }
}

// The fake agent is a bash script; the Windows CI lane never runs the
// rust-and-link poll anyway (all build steps are linux-hosted).
describe.skipIf(isWindows)("waitForStepOutcome", () => {
  test("resolves once the sibling passes", async () => {
    await withFakeAgent(
      [
        { outcome: "", state: "running" },
        { outcome: "passed", state: "passed" },
      ],
      () => waitForStepOutcome("linux-x64-build-cpp", 5),
    );
  });

  test("keeps polling while a retry is queued after an earlier error", async () => {
    // Build 84838: attempt 1 expired (outcome=errored), attempt 2 sat in the
    // queue (state=scheduled). The old outcome-only poll bailed at index 0.
    await withFakeAgent(
      [
        { outcome: "errored", state: "scheduled" },
        { outcome: "errored", state: "scheduled" },
        { outcome: "errored", state: "running" },
        { outcome: "passed", state: "passed" },
      ],
      () => waitForStepOutcome("windows-x64-build-cpp", 5),
    );
  });

  test("tolerates the gap between one attempt finishing and its retry appearing", async () => {
    // A retry job is created ~1s after its predecessor ends, so one poll can
    // land on a terminal state before the next attempt is scheduled.
    await withFakeAgent(
      [
        { outcome: "errored", state: "expired" },
        { outcome: "errored", state: "scheduled" },
        { outcome: "passed", state: "passed" },
      ],
      () => waitForStepOutcome("darwin-x64-build-cpp", 5),
    );
  });

  test("throws once the sibling is terminally failed with no retry in flight", async () => {
    const err = await withFakeAgent(
      [
        { outcome: "hard_failed", state: "failed" },
        { outcome: "hard_failed", state: "failed" },
      ],
      () =>
        waitForStepOutcome("linux-x64-build-cpp", 5).then(
          () => null,
          e => e as Error,
        ),
    );
    expect(err).not.toBeNull();
    expect(String(err)).toContain("linux-x64-build-cpp hard_failed");
  });

  test("falls back to outcome when state is unavailable", async () => {
    // `step get state` predates some agent versions returning it; an empty
    // state must not mask a real failure.
    const err = await withFakeAgent(
      [
        { outcome: "errored", state: "" },
        { outcome: "errored", state: "" },
      ],
      () =>
        waitForStepOutcome("linux-x64-build-cpp", 5).then(
          () => null,
          e => e as Error,
        ),
    );
    expect(err).not.toBeNull();
    expect(String(err)).toContain("errored");
  });
});
