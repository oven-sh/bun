/**
 * scripts/runner.node.mjs calls rebootDarwinAgentIfOutOfSockets() (scripts/utils.mjs) before
 * it runs tests. macOS leaks kernel TCP sockets from job to job on the bare-metal agents, and
 * past a limit the host can no longer run the network tests, so the job reboots the host and
 * lets Buildkite retry it on another agent. A reboot is only safe on those agents, and only
 * for a leak: sockets the previous job just closed leave the count on their own.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { getDarwinLeakedSocketLimit, rebootDarwinAgentIfOutOfSockets } from "../../scripts/utils.mjs";

const GiB = 2 ** 30;

const bareMetalAgent = {
  BUILDKITE: "true",
  BUILDKITE_AGENT_META_DATA_EPHEMERAL: "false",
  BUILDKITE_AGENT_PID: "357",
};

/** Reads return `counts` in order, then the last one forever. Every side effect lands in `calls`. */
function fakeHost(options: {
  os?: string;
  release?: string;
  env?: Record<string, string | undefined>;
  totalMemory?: number;
  counts: (number | undefined)[];
  rebootStarts?: boolean;
  killThrows?: boolean;
}) {
  const { os = "darwin", release = "25.6.0", env = bareMetalAgent, totalMemory = 8 * GiB } = options;
  const { counts, rebootStarts = true, killThrows = false } = options;
  const calls: string[] = [];
  let reads = 0;
  return {
    calls,
    host: {
      os,
      release,
      env,
      totalMemory,
      readPcbCount: () => counts[Math.min(reads++, counts.length - 1)],
      reboot: () => (calls.push("reboot"), rebootStarts),
      kill(pid: number, signal: string) {
        calls.push(`kill ${pid} ${signal}`);
        if (killThrows) throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      },
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

test("the limit is half of the 10,000 sockets per GiB that macOS can leak", () => {
  expect([8, 16, 64].map(gib => getDarwinLeakedSocketLimit(gib * GiB))).toEqual([40_000, 80_000, 320_000]);
});

describe("rebootDarwinAgentIfOutOfSockets", () => {
  test.each([
    ["a Linux agent", { os: "linux", release: "6.8.0-1021-aws" }],
    ["macOS 15, whose kernel has no cap on TCP memory", { release: "24.6.0" }],
    ["a macOS machine that is not a Buildkite agent", { env: { ...bareMetalAgent, BUILDKITE: undefined } }],
    ["a tart agent, which has no ephemeral tag", { env: { BUILDKITE: "true", BUILDKITE_AGENT_PID: "357" } }],
    ["an ephemeral agent", { env: { ...bareMetalAgent, BUILDKITE_AGENT_META_DATA_EPHEMERAL: "true" } }],
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

  test("reboots and stops the agent when the count stays over the limit", async () => {
    const calls = await run({ counts: [leaked] });
    // 45 seconds outlast the 30 a closed socket is counted for.
    expect(calls.slice(0, 9)).toEqual(Array(9).fill("sleep 5000"));
    // The reboot comes first: the agent's cancel kills this process.
    expect(calls.slice(9)).toEqual(["reboot", "kill 357 SIGQUIT", "sleep 300000"]);
  });

  test("does not stop the agent when the reboot did not start", async () => {
    const calls = await run({ counts: [leaked], rebootStarts: false });
    expect(calls.filter(call => !call.startsWith("sleep"))).toEqual(["reboot"]);
  });

  test("waits for the reboot when the agent cannot be signaled", async () => {
    const calls = await run({ counts: [leaked], killThrows: true });
    expect(calls.slice(9)).toEqual(["reboot", "kill 357 SIGQUIT", "sleep 300000"]);
  });

  test.each([undefined, "", "abc", "0", "1", "-357"])("signals nothing when BUILDKITE_AGENT_PID is %p", async pid => {
    const calls = await run({ counts: [leaked], env: { ...bareMetalAgent, BUILDKITE_AGENT_PID: pid } });
    expect(calls.filter(call => !call.startsWith("sleep"))).toEqual(["reboot"]);
  });
});
