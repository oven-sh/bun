/**
 * .buildkite/ci.mjs schedules the darwin aarch64 test lanes by `release-tier`
 * (one job per tier on every build), and the tart hosts provisioned by
 * scripts/darwin-ci are the fleet behind those tags: each host bakes one guest
 * image per release in its config and runs an agent per image, tagged with that
 * image's release and tier, and the command hook boots the image named by the
 * agent's release tag. This keeps the three in step. When the config only
 * carried a macOS 15 image, every tart agent was `previous`, the `latest` lane
 * had two bare boxes for the whole PR stream, and its shards expired unrun.
 *
 * Configure-time only: ci.mjs is read as text (importing it would generate a
 * pipeline) and nothing here talks to tart or launchd.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { concurrentGuests, tartAgentConfig } from "../../../scripts/darwin-ci/lib/agent.ts";
import {
  agentGuestRelease,
  config,
  guestBase,
  guestImage,
  releaseTier,
} from "../../../scripts/darwin-ci/lib/config.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const guests = config.tart.guests;

/**
 * Every `release-tier` that ci.mjs puts a darwin aarch64 job on: the
 * testPlatforms entries and the traceOrderTargets host. Commented-out lanes
 * (darwin x64 today) do not count.
 */
function tiersScheduledByCi(): string[] {
  const tiers = new Set<string>();
  for (const line of readFileSync(join(repoRoot, ".buildkite", "ci.mjs"), "utf8").split("\n")) {
    if (line.trimStart().startsWith("//")) continue;
    if (!/os:\s*"darwin"/.test(line) || !/arch:\s*"aarch64"/.test(line)) continue;
    for (const [, tier] of line.matchAll(/\btier:\s*"([a-z]+)"/g)) tiers.add(tier);
  }
  return [...tiers].sort();
}

/** The `release=<N>` tag from a baked agent config, as buildkite-agent hands it to hooks. */
function releaseTagOf(agentConfig: string): string {
  const tags = agentConfig.match(/^tags="([^"]*)"$/m)?.[1] ?? "";
  return (
    tags
      .split(",")
      .find(tag => tag.startsWith("release="))
      ?.slice("release=".length) ?? ""
  );
}

describe("scripts/darwin-ci serves every darwin release-tier that .buildkite/ci.mjs schedules", () => {
  test("a guest image is configured for each tier ci.mjs targets", () => {
    const scheduled = tiersScheduledByCi();
    // The latest lane is the one that was missing; it doubles as a guard that the
    // ci.mjs scan above still finds the darwin entries at all.
    expect(scheduled).toContain("latest");

    const served = new Set(guests.map(({ release }) => releaseTier(release)));
    expect(scheduled.filter(tier => !served.has(tier))).toEqual([]);
  });

  test("each configured guest bakes from its own base to its own image", () => {
    const images = guests.map(({ release }) => guestImage(release));
    expect(new Set(images).size).toBe(images.length);

    // main.ts resolves bases through guestBase(); a release nobody configured needs an explicit --base
    expect(guests.map(({ release }) => guestBase(release))).toEqual(guests.map(({ base }) => base));
    const unconfigured = Math.max(...guests.map(({ release }) => release)) + 1;
    expect(guestBase(unconfigured)).toBeUndefined();
  });

  test("the default agents per image fit the guests a host can run at once", () => {
    // install-agent refuses anything larger, so a default that did not fit would leave every host unprovisionable
    const releases = guests.map(({ release }) => release);
    expect(concurrentGuests({ releases, spawn: config.tart.spawn })).toBeLessThanOrEqual(config.tart.maxGuests);
  });

  test("each image's agents are tagged with its release and tier, and the hook boots that image", () => {
    for (const { release } of guests) {
      const agentConfig = tartAgentConfig({ release, spawn: 1, token: "token", home: "/Users/ci" });
      expect(agentConfig).toContain(`name="%hostname-tart-${release}-%spawn"`);
      expect(agentConfig).toContain(`queue=${config.queue},`);
      expect(agentConfig).toContain(`release=${release},release-tier=${releaseTier(release)},`);

      // hooks/command.ts boots guestImage(agentGuestRelease(env)); bake.ts produced guestImage(release)
      const hookEnv = { BUILDKITE_AGENT_META_DATA_RELEASE: releaseTagOf(agentConfig) };
      expect(agentGuestRelease(hookEnv)).toBe(release);
    }
  });

  test("the hook refuses an agent whose release tag is missing or not a macOS major", () => {
    expect(agentGuestRelease({})).toBeUndefined();
    expect(agentGuestRelease({ BUILDKITE_AGENT_META_DATA_RELEASE: "" })).toBeUndefined();
    expect(agentGuestRelease({ BUILDKITE_AGENT_META_DATA_RELEASE: "latest" })).toBeUndefined();
    expect(agentGuestRelease({ BUILDKITE_AGENT_META_DATA_RELEASE: "26" })).toBe(26);
  });
});
