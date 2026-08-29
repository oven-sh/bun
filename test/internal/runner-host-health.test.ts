/**
 * scripts/runner.node.mjs prints a "Host health" group when the build artifact
 * download stalls, and in every job's header on a bare-metal agent.
 * getHostHealthSnapshot() in scripts/utils.mjs is the content of that group and
 * isBareMetalAgent() decides which agents get it in the header.
 */
import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import { getHostHealthSnapshot, isBareMetalAgent } from "../../scripts/utils.mjs";

describe("isBareMetalAgent", () => {
  test("a box registered by scripts/agent.mjs", () => {
    expect(isBareMetalAgent({ BUILDKITE_AGENT_META_DATA_EPHEMERAL: "false" })).toBe(true);
    expect(
      isBareMetalAgent({
        BUILDKITE_AGENT_META_DATA_EPHEMERAL: "false",
        BUILDKITE_AGENT_META_DATA_RELEASE_TIER: "latest",
        BUILDKITE_AGENT_META_DATA_OS: "darwin",
      }),
    ).toBe(true);
  });

  test("a cloud agent that disconnects after its job", () => {
    expect(isBareMetalAgent({ BUILDKITE_AGENT_META_DATA_EPHEMERAL: "true" })).toBe(false);
  });

  test("a darwin tart agent, which boots a fresh guest for every job", () => {
    expect(isBareMetalAgent({ BUILDKITE_AGENT_META_DATA_TART: "true" })).toBe(false);
    expect(
      isBareMetalAgent({ BUILDKITE_AGENT_META_DATA_EPHEMERAL: "false", BUILDKITE_AGENT_META_DATA_TART: "true" }),
    ).toBe(false);
  });

  test("outside Buildkite", () => {
    expect(isBareMetalAgent({})).toBe(false);
  });
});

describe("getHostHealthSnapshot", () => {
  test.skipIf(isWindows)("describes load, memory, and the process table", () => {
    const lines = getHostHealthSnapshot();
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines[0]).toMatch(/^up [\d.]+ h, load average: [\d.]+ [\d.]+ [\d.]+$/);
    expect(lines.find(line => line.startsWith("memory: "))).toMatch(/^memory: [\d.]+G total, /);
    expect(lines.find(line => line.startsWith("processes: "))).toMatch(/^processes: \d+ total, \d+ for \S+$/);
    expect(lines.find(line => line.startsWith("processes in an uninterruptible"))).toMatch(/: \d+$/);
  });

  test.skipIf(!isWindows)("has nothing to say on Windows", () => {
    expect(getHostHealthSnapshot()).toEqual([]);
  });
});
