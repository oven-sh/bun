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
import { expect, spyOn, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { artifacts, getBaselineAlias, getCanaryLabel } from "../../../.buildkite/scripts/upload-release.ts";
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

// As `cmake -E tar cf --format=zip` writes one: the header in front of the data of a file has zeros for its CRC-32 and
// its sizes, which follow the data, and only the central directory at the end has them for a reader that starts there.
function makeStreamedZip(entries: Record<string, Buffer>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const crc = Bun.hash.crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x8, 6);
    header.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(data.length, 8);
    descriptor.writeUInt32LE(data.length, 12);
    local.push(header, Buffer.from(name), data, descriptor);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x8, 8);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    // An extra field, as cmake writes for the times of a file.
    entry.writeUInt16LE(9, 30);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, Buffer.from(name), Buffer.alloc(9));
    offset += 30 + name.length + data.length + 16;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 3, 8);
  end.writeUInt16LE(central.length / 3, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test("the label of a file of the canary names the commit, and the size and the CRC-32 of its executable", () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const files = [...artifacts, ...artifacts.flatMap(zip => getBaselineAlias(zip) ?? [])];
  const executables = new Map(
    files.map((zip, i) => {
      const folder = zip.slice(0, -".zip".length);
      const name = `${folder.endsWith("-profile") ? "bun-profile" : "bun"}${zip.includes("windows") ? ".exe" : ""}`;
      return [zip, { path: `${folder}/${name}`, data: Buffer.alloc(1000 + i, `the executable of ${zip}`) }];
    }),
  );
  using dir = tempDir("canary-labels", {
    ...Object.fromEntries(
      files.map(zip => {
        const { path, data } = executables.get(zip)!;
        const folder = path.slice(0, path.indexOf("/") + 1);
        // A real zip is far longer than the end of it that is read for the directory.
        const map = zip === "bun-linux-aarch64.zip" ? Buffer.alloc(2 * 1024 * 1024, "a map") : Buffer.from("a map");
        // Between a folder and files that the zip of a profile build has too.
        const entries = { [folder]: Buffer.alloc(0), [`${path}.map`]: map, [path]: data };
        return [zip, makeStreamedZip({ ...entries, [`${folder}linker.order`]: Buffer.from("an order") })];
      }),
    ),
    "bun-linux-x64-musl-profile.zip": makeStreamedZip({ "bun-linux-x64-musl-profile/bun": Buffer.from("not it") }),
    "bun-darwin-x64.zip": "not a zip",
    // A directory that starts in front of the end that is read.
    "bun-freebsd-x64.zip": makeStreamedZip({
      ...Object.fromEntries(Array.from({ length: 12_000 }, (_, i) => [`${i}`.padStart(60, "0"), Buffer.alloc(0)])),
      "bun-freebsd-x64/bun": Buffer.from("behind them"),
    }),
  });

  expect(files.length).toBe(36);
  const unreadable = ["bun-linux-x64-musl-profile.zip", "bun-darwin-x64.zip", "bun-freebsd-x64.zip"];
  using warn = spyOn(console, "warn").mockImplementation(() => {});
  expect(files.map(zip => getCanaryLabel(join(String(dir), zip), commit))).toEqual(
    files.map(zip => {
      const { data } = executables.get(zip)!;
      const crc32 = Bun.hash.crc32(data).toString(16).padStart(8, "0");
      return unreadable.includes(zip) ? `${zip} (${commit})` : `${zip} (${commit} ${data.length} ${crc32})`;
    }),
  );
  // The publish says which labels name no executable.
  const warned = warn.mock.calls.map(
    ([message]) => /Cannot find the executable in .*[\\/]([^\\/]+\.zip):/.exec(message)?.[1],
  );
  expect(warned.sort()).toEqual(unreadable.sort());
});
