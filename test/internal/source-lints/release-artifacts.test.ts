/**
 * The files of a release are named in four places. A name that only one of them has is a release step that fails on
 * main or a release branch, where alone it runs, or a package that is published without its binary:
 *
 * - .buildkite/ci.ts decides which builds there are and which zips the steps behind them ask for. It can't be imported
 *   (it generates the pipeline on import), so it is read as text.
 * - scripts/build/ci.ts names the zips that a build uploads.
 * - .buildkite/scripts/upload-release.ts fetches them by name and puts them into the release.
 * - packages/bun-release/src/platform.ts names the zip that each package on npm is made of.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { artifacts, getBaselineAlias } from "../../../.buildkite/scripts/upload-release.ts";
import { platforms } from "../../../packages/bun-release/src/platform.ts";
import { computeBunTriplet } from "../../../scripts/build/ci.ts";
import type { Config } from "../../../scripts/build/config.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const ciScript = readFileSync(join(repoRoot, ".buildkite", "ci.ts"), "utf8");
const sorted = (names: string[]) => [...names].sort();

type Target = { os: string; arch: string; abi?: string; profile?: string };

const matrix = /^const (?:bunPlatforms|buildPlatforms): Platform\[\] = \[\n([\s\S]*?)^\];/m.exec(ciScript);
if (matrix === null) throw new Error("the build matrix was not found in .buildkite/ci.ts");
const field = (entry: string, name: string) => new RegExp(`\\b${name}: "([^"]+)"`).exec(entry)?.[1];
const targets: Target[] = (
  matrix[1]
    .split("\n")
    .filter(line => !line.trim().startsWith("//"))
    .join("\n")
    .match(/\{[^}]*\}/g) ?? []
)
  .map(entry => ({
    os: field(entry, "os")!,
    arch: field(entry, "arch")!,
    abi: field(entry, "abi"),
    profile: field(entry, "profile"),
  }))
  // A build with a profile of its own, like asan, is in no release.
  .filter(target => target.profile === undefined);

const source = /^function getTargetTriplet\(platform: Target\): string (\{[\s\S]*?^\})/m.exec(ciScript);
if (source === null) throw new Error("getTargetTriplet was not found in .buildkite/ci.ts");
const getTargetTriplet = new Function("platform", source[1]) as (platform: Target) => string;

const fetched = artifacts.map(zip => zip.slice(0, -".zip".length));

test("upload-release.ts fetches the zips that the builds of ci.ts upload, and no other", () => {
  // Where each release build is made more than once, under a profile each.
  const multiplied = /^const buildPlatforms: Platform\[\] = bunPlatforms\.flatMap\(([\s\S]*?)^\);/m.exec(ciScript);
  const profiles = [undefined, ...[...(multiplied?.[1] ?? "").matchAll(/profile: "(\w+)" as const/g)].map(m => m[1])];
  const triplets = profiles.flatMap(profile => targets.map(target => getTargetTriplet({ ...target, profile })));

  expect(targets.length).toBeGreaterThanOrEqual(8);
  expect(sorted(fetched)).toEqual(sorted(triplets.flatMap(triplet => [triplet, `${triplet}-profile`])));
});

test("ci.ts asks for a build's zips by the name that scripts/build/ci.ts gives them", () => {
  expect(targets.map(target => computeBunTriplet(target as Config))).toEqual(targets.map(getTargetTriplet));
});

test("every package on npm is made of a zip of the release", () => {
  const aliases = artifacts.flatMap(zip => getBaselineAlias(zip)?.slice(0, -".zip".length) ?? []);
  const released = [...fetched, ...aliases];
  expect(platforms.map(platform => platform.bin).filter(bin => !released.includes(bin))).toEqual([]);
});
