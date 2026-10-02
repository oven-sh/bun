/**
 * scripts/runner.node.ts calls checkDarwinAgentSockets() (scripts/agent.ts) before it
 * runs tests. macOS leaks kernel TCP sockets from job to job on the bare-metal agents. The job
 * prints the count, and past a limit macOS 26 can no longer run the network tests, so the job
 * can reboot the machine and let Buildkite retry it on another agent. A reboot is only safe
 * when it is turned on, on those agents, where the job is retried, and for a leak: sockets the
 * previous job just closed leave the count on their own.
 */
import { describe, expect, spyOn, test } from "bun:test";
import {
  checkDarwinAgentSockets,
  getDarwinLeakedSocketLimit,
  ignoreTerminationSignals,
  type DarwinAgentHost,
} from "../../scripts/agent.ts";

const GiB = 2 ** 30;

const bareMetalAgent = {
  BUILDKITE: "true",
  BUILDKITE_AGENT_META_DATA_EPHEMERAL: "false",
  BUILDKITE_AGENT_META_DATA_RELEASE_TIER: "latest",
};
const rebootTurnedOn = { ...bareMetalAgent, BUN_RUNNER_REBOOT_DARWIN_AGENT: "1" };

/** From `netstat -s -p tcp` on darwin-arm64-hardtack. */
const netstat = `tcp:
\t4234664 connection requests
\t2653037 connection accepts
\t605109 retransmit timeouts
\t\t287 connections dropped by rexmit timeout
`;

interface Scenario {
  os?: string;
  release?: string;
  env?: Record<string, string | undefined>;
  totalMemory?: number;
  uptime?: number;
  /** What `sysctl -n net.inet.tcp.pcbcount` prints: these in order, then the last one forever. */
  counts: (number | undefined)[];
  rebootStarts?: boolean;
  loggedInUsers?: number | string;
}

/** Runs the check on a fake machine. `calls` is every side effect in order, `printed` the job log. */
async function run(scenario: Scenario) {
  const { os = "darwin", release = "25.6.0", env = rebootTurnedOn, totalMemory = 8 * GiB, uptime = 79_000 } = scenario;
  const { counts, rebootStarts = true, loggedInUsers = 0 } = scenario;
  const calls: string[] = [];
  const printed: string[] = [];
  let reads = 0;
  const host: DarwinAgentHost = {
    hostname: "darwin-arm64-hardtack",
    os,
    release,
    env,
    totalMemory,
    uptime,
    command(command) {
      if (command[0] === "sysctl") {
        const count = counts[Math.min(reads++, counts.length - 1)];
        return count === undefined ? undefined : `${count}\n`;
      }
      if (command[0] === "netstat") {
        return netstat;
      }
      calls.push(command.join(" "));
      return rebootStarts ? "" : undefined;
    },
    loggedInUsers: () => loggedInUsers,
    annotate: content => void calls.push(`annotate ${content.trim()}`),
    group: () => {},
    ignoreSignals: () => (calls.push("ignore signals"), () => void calls.push("restore signals")),
    sleep: async ms => void calls.push(`sleep ${ms}`),
  };
  const print = (...args: unknown[]) => void printed.push(args.join(" "));
  const spies = [spyOn(console, "log").mockImplementation(print), spyOn(console, "warn").mockImplementation(print)];
  try {
    await checkDarwinAgentSockets(host);
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return { calls, printed };
}

/** What darwin-arm64-hardtack (8 GB) held when every job on it failed. */
const leaked = 64_728;
const counters = (count: number, hours = "21.9") =>
  `Up ${hours} h. TCP sockets held by the kernel: ${count}. ` +
  "TCP since boot: 4234664 connection requests, 605109 retransmit timeouts.";
const overLimit =
  "`darwin-arm64-hardtack` holds 64728 leaked kernel TCP sockets (limit 20075). " +
  "macOS drops TCP data on it when the tests take the count past 65075.";
const settled = Array(9).fill("sleep 5000");

test("the limit leaves room for 45,000 sockets under 80% of the TCP memory cap", () => {
  // The cap is 1/32 of RAM at 3.3 KB per socket: 81,349 sockets on 8 GiB. socket() failed at about 81,300.
  expect([8, 16].map(gib => getDarwinLeakedSocketLimit(gib * GiB))).toEqual([20_075, 85_150]);
  expect(getDarwinLeakedSocketLimit(4 * GiB)).toBeLessThan(0);
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

describe("checkDarwinAgentSockets", () => {
  test.each<[string, Partial<Scenario>]>([
    ["a Linux agent", { os: "linux", release: "6.8.0-1021-aws" }],
    ["a macOS machine that is not a Buildkite agent", { env: { ...rebootTurnedOn, BUILDKITE: undefined } }],
    ["a tart agent, which has no ephemeral tag", { env: { BUILDKITE: "true", BUN_RUNNER_REBOOT_DARWIN_AGENT: "1" } }],
    ["an ephemeral agent", { env: { ...rebootTurnedOn, BUILDKITE_AGENT_META_DATA_EPHEMERAL: "true" } }],
  ])("does not look at %s", async (_, where) => {
    expect(await run({ ...where, counts: [leaked] })).toEqual({ calls: [], printed: [] });
  });

  test.each<[string, Partial<Scenario>]>([
    ["macOS 14, whose kernel has no cap on TCP memory", { release: "23.6.0", totalMemory: 64 * GiB }],
    [
      "the beta tier, whose jobs are not retried",
      { env: { ...rebootTurnedOn, BUILDKITE_AGENT_META_DATA_RELEASE_TIER: "beta" } },
    ],
    ["a machine too small for a reboot to help", { totalMemory: 4 * GiB }],
  ])("prints the counters and does nothing else on %s", async (_, where) => {
    expect(await run({ ...where, counts: [leaked] })).toEqual({ calls: [], printed: [counters(leaked)] });
  });

  test("runs the tests on a bare-metal macOS 26 agent under its limit", async () => {
    expect(await run({ counts: [20_074] })).toEqual({ calls: [], printed: [counters(20_074)] });
    expect(await run({ counts: [leaked], totalMemory: 16 * GiB })).toEqual({ calls: [], printed: [counters(leaked)] });
  });

  test("runs the tests when sysctl has no answer", async () => {
    expect(await run({ counts: [undefined] })).toEqual({ calls: [], printed: [] });
    expect((await run({ counts: [leaked, undefined] })).calls).toEqual(["sleep 5000"]);
  });

  test("waits for the sockets the previous job closed to leave the count", async () => {
    expect((await run({ counts: [56_000, 55_500, 19_000] })).calls).toEqual(["sleep 5000", "sleep 5000"]);
  });

  test("only says that the machine is over its limit when the reboot is not turned on", async () => {
    // No wait either: the 45 seconds only matter before a reboot.
    expect(await run({ counts: [leaked], env: bareMetalAgent })).toEqual({
      calls: [],
      printed: [
        counters(leaked),
        "darwin-arm64-hardtack is over its limit of 20075 leaked kernel TCP sockets (a socket closed in the last " +
          "30 seconds counts too). A test job reboots such a machine when the job has BUN_RUNNER_REBOOT_DARWIN_AGENT=1.",
      ],
    });
  });

  test("reboots when it is turned on, and does not exit on SIGTERM while it waits", async () => {
    const { calls } = await run({ counts: [leaked] });
    // 45 seconds of samples first: they outlast the 30 a closed socket is counted for.
    // Signals are ignored before the shutdown is asked for: no window in which this process
    // exits by itself and the job is recorded as an ordinary failure. The real reboot ends
    // the process during the sleep. What follows it is the case where the machine stayed up.
    expect(calls).toEqual([
      ...settled,
      "ignore signals",
      "sudo -n shutdown -r now",
      "sleep 300000",
      "restore signals",
      `annotate ${overLimit} It did not reboot when a test job asked it to. Reboot it by hand.`,
    ]);
  });

  test("says so in an annotation, and runs the tests, when the reboot does not start", async () => {
    const { calls } = await run({ counts: [leaked], rebootStarts: false });
    expect(calls).toEqual([
      ...settled,
      "ignore signals",
      "sudo -n shutdown -r now",
      "restore signals",
      `annotate ${overLimit} It did not reboot when a test job asked it to. Reboot it by hand.`,
    ]);
  });

  test("does not reboot under someone who is logged in, and does not name them in the annotation", async () => {
    const who = "1 currently logged in users:\n- administrator on ttys001 from 100.64.0.7";
    const { calls } = await run({ counts: [leaked], loggedInUsers: who });
    // No "ignore signals" and no shutdown: nothing that cannot be undone happens.
    expect(calls).toEqual([
      ...settled,
      `annotate ${overLimit} It was not rebooted because someone is logged in. It needs a reboot when they are done.`,
    ]);
  });

  test("does not reboot a machine that booted less than an hour ago", async () => {
    // It cannot have leaked this much, so the count or the limit is wrong and every job would reboot it again.
    const { calls, printed } = await run({ counts: [leaked], uptime: 3599 });
    expect(calls).toEqual([
      ...settled,
      `annotate ${overLimit} It was not rebooted because it booted less than an hour ago. The count or the limit is wrong.`,
    ]);
    expect(printed[0]).toBe(counters(leaked, "1.0"));
  });
});
