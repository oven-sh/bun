// If port exhaustion occurs, these tests fail: fetch() rejects with a connect error.
// If a socket never closes, the fixture runs into its deadline and these tests fail on its counts.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isDebug, isMacOS } from "harness";
import { join } from "node:path";

// Since we bumped MAX_CONNECTIONS to 4, we should halve the threshold on macOS.
const PORT_EXHAUSTION_THRESHOLD = isMacOS ? 8 * 1024 : 16 * 1024;

const batchSize = 48;
// A debug build needs about 25 s for one case at twice the threshold, so it stays below it. No CI lane runs one.
const batches = Math.ceil((isDebug ? 2 * 1024 : PORT_EXHAUSTION_THRESHOLD * 2) / batchSize);
const connections = batches * batchSize;

type CloseMethod = "end" | "shutdown" | "terminate";

// One fetch-tcp-stress-fixture.ts process for each case: the cases run at the
// same time, and each one measures only its own file descriptors.
const cases: [name: string, afterWrite: CloseMethod, afterFetch: CloseMethod | "none"][] = [
  ["shutdown after timeout", "end", "none"],
  ["close after TCP fin", "shutdown", "end"],
  ["shutdown then terminate", "shutdown", "terminate"],
  // The same as "shutdown after timeout": the two have had one body since #11512.
  ["gently close", "end", "none"],
];

// Fails on the macOS CI hosts only (#14514).
test.todoIf(isCI && isMacOS).concurrent.each(cases)(
  "%s",
  async (_, afterWrite, afterFetch) => {
    const deadline = 26_000;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "fetch-tcp-stress-fixture.ts"),
        afterWrite,
        afterFetch,
        String(batches),
        String(batchSize),
        String(deadline),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      // A fixture whose JS thread is stuck cannot act on its deadline, and the
      // runner does not kill the process of a concurrent test that times out.
      timeout: deadline + 2_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const { maxFD, ...counts } = JSON.parse(stdout || "{}");
    expect({ stderr, signalCode: proc.signalCode, exitCode, counts }).toEqual({
      stderr: "",
      signalCode: null,
      exitCode: 0,
      counts: {
        // The server closes before fetch() has a response to parse.
        fetches: { ECONNRESET: connections },
        served: connections,
        closed: connections,
        serverErrors: [],
      },
    });
    expect(maxFD.atEnd).toBeLessThan(maxFD.afterFirstBatch + 10);
  },
  // The default, 5 s, is too short on the slower lanes.
  30_000,
);
