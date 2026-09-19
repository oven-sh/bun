/**
 * scripts/runner.node.mjs calls rebootDarwinAgentIfOutOfSockets() (scripts/utils.mjs) before
 * it runs tests. macOS leaks kernel TCP sockets from job to job on the bare-metal agents, and
 * past a limit the host can no longer run the network tests, so the job reboots the host and
 * lets Buildkite retry it on another agent. A reboot is only safe on those agents, only where
 * the job is retried, and only for a leak: sockets the previous job just closed leave the
 * count on their own.
 */
import { describe, expect, spyOn, test } from "bun:test";
import {
  getDarwinLeakedSocketLimit,
  ignoreTerminationSignals,
  rebootDarwinAgentIfOutOfSockets,
} from "../../scripts/utils.mjs";

const GiB = 2 ** 30;

const bareMetalAgent = {
  BUILDKITE: "true",
  BUILDKITE_AGENT_META_DATA_EPHEMERAL: "false",
  BUILDKITE_AGENT_META_DATA_RELEASE_TIER: "latest",
};

/** Reads return `counts` in order, then the last one forever. Every side effect lands in `calls`. */
function fakeHost(options: {
  os?: string;
  release?: string;
  env?: Record<string, string | undefined>;
  totalMemory?: number;
  counts: (number | undefined)[];
  rebootStarts?: boolean;
  loggedInUsers?: number | string;
}) {
  const { os = "darwin", release = "25.6.0", env = bareMetalAgent, totalMemory = 8 * GiB } = options;
  const { counts, rebootStarts = true, loggedInUsers = 0 } = options;
  const calls: string[] = [];
  let reads = 0;
  return {
    calls,
    host: {
      hostname: "darwin-arm64-hardtack",
      os,
      release,
      env,
      totalMemory,
      readPcbCount: () => counts[Math.min(reads++, counts.length - 1)],
      loggedInUsers: () => loggedInUsers,
      reboot: () => (calls.push("reboot"), rebootStarts),
      annotate: (content: string) => void calls.push(`annotate ${content.trim()}`),
      ignoreSignals: () => (calls.push("ignore signals"), () => void calls.push("restore signals")),
      sleep: async (ms: number) => void calls.push(`sleep ${ms}`),
    },
  };
}

async function run(options: Parameters<typeof fakeHost>[0]) {
  const { host, calls } = fakeHost(options);
  const silenced = (["log", "warn", "group"] as const).map(method =>
    spyOn(console, method).mockImplementation(() => {}),
  );
  try {
    await rebootDarwinAgentIfOutOfSockets(host);
  } finally {
    for (const spy of silenced) spy.mockRestore();
  }
  return calls;
}

/** What darwin-arm64-hardtack (8 GB) held when every job on it failed. */
const leaked = 64_728;
const overLimit = "annotate `darwin-arm64-hardtack` holds 64728 leaked kernel TCP sockets (limit 40000) and ";
const notRebooted =
  overLimit +
  "did not reboot when a test job asked it to. Its network fails at about 1.6 times the limit. Reboot it by hand.";
const someoneLoggedIn =
  overLimit +
  "was not rebooted because someone is logged in. Its network fails at about 1.6 times the limit. " +
  "It needs a reboot when they are done.";

test("the limit is half of the 10,000 sockets per GiB that macOS can leak", () => {
  expect([8, 16, 64].map(gib => getDarwinLeakedSocketLimit(gib * GiB))).toEqual([40_000, 80_000, 320_000]);
});

test("ignoreTerminationSignals() silences the listeners a process had and then puts them back", () => {
  // process.emit() calls the listeners without sending a signal, so the test runner is never at risk.
  const signals = ["SIGTERM", "SIGHUP", "SIGINT"] as const;
  const heard: string[] = [];
  const listeners = signals.map(signal => [signal, () => void heard.push(signal)] as const);
  const before = signals.map(signal => process.listenerCount(signal));
  for (const [signal, listener] of listeners) process.on(signal, listener);
  try {
    const restore = ignoreTerminationSignals();
    for (const signal of signals) process.emit(signal);
    expect(heard).toEqual([]);
    // One listener each: with none, the signal would end the process.
    expect(signals.map(signal => process.listenerCount(signal))).toEqual([1, 1, 1]);

    restore();
    for (const signal of signals) process.emit(signal);
    expect(heard).toEqual(["SIGTERM", "SIGHUP", "SIGINT"]);
  } finally {
    for (const [signal, listener] of listeners) process.removeListener(signal, listener);
  }
  expect(signals.map(signal => process.listenerCount(signal))).toEqual(before);
});

describe("rebootDarwinAgentIfOutOfSockets", () => {
  test.each([
    ["a Linux agent", { os: "linux", release: "6.8.0-1021-aws" }],
    ["macOS 15, whose kernel has no cap on TCP memory", { release: "24.6.0" }],
    ["a macOS machine that is not a Buildkite agent", { env: { ...bareMetalAgent, BUILDKITE: undefined } }],
    ["a tart agent, which has no ephemeral tag", { env: { BUILDKITE: "true" } }],
    ["an ephemeral agent", { env: { ...bareMetalAgent, BUILDKITE_AGENT_META_DATA_EPHEMERAL: "true" } }],
    [
      "the beta tier, whose jobs are not retried",
      { env: { ...bareMetalAgent, BUILDKITE_AGENT_META_DATA_RELEASE_TIER: "beta" } },
    ],
  ])("leaves %s alone", async (_, where) => {
    expect(await run({ ...where, counts: [leaked] })).toEqual([]);
  });

  test("runs the tests on a bare-metal macOS agent under its limit", async () => {
    expect(await run({ counts: [39_999] })).toEqual([]);
    expect(await run({ counts: [leaked], totalMemory: 16 * GiB })).toEqual([]);
  });

  test("runs the tests when sysctl has no answer", async () => {
    expect(await run({ counts: [undefined] })).toEqual([]);
  });

  test("waits for the sockets the previous job closed to leave the count", async () => {
    expect(await run({ counts: [56_000, 55_500, 30_000] })).toEqual(["sleep 5000", "sleep 5000"]);
  });

  test("reboots when the count stays over the limit, and does not exit on SIGTERM while it waits", async () => {
    const calls = await run({ counts: [leaked] });
    // 45 seconds outlast the 30 a closed socket is counted for.
    expect(calls.slice(0, 9)).toEqual(Array(9).fill("sleep 5000"));
    // Signals are ignored before the shutdown is asked for: no window in which this process
    // exits by itself and the job is recorded as an ordinary failure. The real reboot ends
    // the process during the sleep. What follows it is the case where the host stayed up.
    expect(calls.slice(9)).toEqual(["ignore signals", "reboot", "sleep 300000", "restore signals", notRebooted]);
  });

  test("does not reboot under someone who is logged in, and says so without naming them", async () => {
    const who = "1 currently logged in users:\n- administrator on ttys001 from 100.64.0.7";
    const calls = await run({ counts: [leaked], loggedInUsers: who });
    // No "ignore signals" and no "reboot": nothing that cannot be undone happens.
    expect(calls.slice(9)).toEqual([someoneLoggedIn]);
    expect(calls.join("\n")).not.toContain("100.64.0.7");
  });

  test("says so in an annotation, and runs the tests, when the reboot does not start", async () => {
    const calls = await run({ counts: [leaked], rebootStarts: false });
    expect(calls.slice(9)).toEqual(["ignore signals", "reboot", "restore signals", notRebooted]);
  });
});
