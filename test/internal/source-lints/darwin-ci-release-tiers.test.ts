/**
 * .buildkite/ci.mjs schedules the darwin aarch64 test lanes by `release-tier`
 * (one job per tier on every build), and the tart hosts provisioned by
 * scripts/darwin-ci are the fleet behind those tags: each host bakes one guest
 * image per release in its config and runs an agent per image, tagged with that
 * image's release and tier, and the command hook boots the image named by the
 * agent's release tag. This keeps the three in step, including when a new macOS
 * moves the `latest` lane's release in ci.mjs. When the config only carried a
 * macOS 15 image, every tart agent was `previous`, the `latest` lane had two
 * bare boxes for the whole PR stream, and its shards expired unrun.
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

type Lane = { tier: string; release: number };

/**
 * Every darwin aarch64 lane ci.mjs schedules by `release-tier`: the
 * testPlatforms entries and the traceOrderTargets host, each written as one
 * `{ os: "darwin", arch: "aarch64", release: "N", tier: "..." }` line.
 * Commented-out lanes (darwin x64 today) do not count.
 */
function darwinLanesInCi(): Lane[] {
  const lanes: Lane[] = [];
  for (const line of readFileSync(join(repoRoot, ".buildkite", "ci.mjs"), "utf8").split("\n")) {
    if (line.trimStart().startsWith("//")) continue;
    if (!/os:\s*"darwin"/.test(line) || !/arch:\s*"aarch64"/.test(line)) continue;
    const tier = line.match(/\btier:\s*"([a-z]+)"/)?.[1];
    if (tier) lanes.push({ tier, release: Number(line.match(/\brelease:\s*"(\d+)"/)?.[1]) });
  }
  return lanes;
}

function unique<T extends string | number>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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
  test("the configured guest images serve exactly the tiers ci.mjs targets", () => {
    const scheduled = unique(darwinLanesInCi().map(({ tier }) => tier));
    // The latest lane is the one that was missing; it doubles as a guard that the
    // ci.mjs scan above still finds the darwin entries at all.
    expect(scheduled).toContain("latest");

    // Exact equality in both directions: a tier with no image starves its lane,
    // and an image for a tier with no lane takes one of the host's two guest
    // slots (config.tart.maxGuests) away from a lane that needs it.
    expect(unique(guests.map(({ release }) => releaseTier(release)))).toEqual(scheduled);
  });

  test("the latest guest is the macOS release ci.mjs pins on the latest lane", () => {
    // getTestBunStep() passes the lane's `release` as EXPECTED_PLATFORM_RELEASE on
    // darwin aarch64 latest, and runner.node.mjs fails the job on any other macOS
    // major; bake.ts guarantees bun-ci-<N> really is macOS N. Previous lanes float.
    const pinned = unique(
      darwinLanesInCi()
        .filter(({ tier }) => tier === "latest")
        .map(({ release }) => release),
    );
    const latestGuests = unique(
      guests.map(({ release }) => release).filter(release => releaseTier(release) === "latest"),
    );
    expect(latestGuests).toEqual(pinned);
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

  test("the hook refuses an agent whose release tag is missing or not numeric", () => {
    expect(agentGuestRelease({})).toBeUndefined();
    expect(agentGuestRelease({ BUILDKITE_AGENT_META_DATA_RELEASE: "" })).toBeUndefined();
    expect(agentGuestRelease({ BUILDKITE_AGENT_META_DATA_RELEASE: "latest" })).toBeUndefined();
    expect(agentGuestRelease({ BUILDKITE_AGENT_META_DATA_RELEASE: "26" })).toBe(26);
  });
});
