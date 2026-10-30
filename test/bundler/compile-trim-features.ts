import { builtinFeatureUses, readTrimTable } from "bun:internal-for-testing";
import { bunEnv, bunExe, tempDir, tempDirWithBunTypes } from "harness";
import { join } from "node:path";
import { guardFeatureOf } from "../../scripts/build/trim/builtin-uses";
import {
  loadFeatures,
  narrowestTrimFeature,
  type FeatureModel,
  type FeatureName,
  type TrimFeature,
} from "../../scripts/build/trim/features";
import type { TrimTable } from "../../scripts/build/trim/table";
import type { BuiltinEntry } from "../../scripts/build/trim/types";

export const repositoryRoot: string = join(import.meta.dir, "..", "..");

export function tempDirForAotBuilds(
  basename: string,
  files: Record<string, string>,
): ReturnType<typeof tempDirWithBunTypes> {
  return tempDirWithBunTypes(basename, { "tsconfig.json": `{ "compilerOptions": { "types": ["bun"] } }`, ...files });
}

// CI tests a Bun with symbols and debug information. They are in sections that no loader maps, and an executable gets a copy of them.
export function getMappedSegments(file: Buffer): Buffer[] {
  const isElf64 = file.length >= 64 && file.readUInt32BE(0) === 0x7f454c46 && file[4] === 2 && file[5] === 1;
  if (!isElf64) return [file];
  const [headers, headerSize, count] = [
    Number(file.readBigUInt64LE(0x20)),
    file.readUInt16LE(0x36),
    file.readUInt16LE(0x38),
  ];
  return Array.from({ length: count }, (_, index) => headers + index * headerSize)
    .filter(at => file.readUInt32LE(at) === 1)
    .map(at =>
      file.subarray(
        Number(file.readBigUInt64LE(at + 8)),
        Number(file.readBigUInt64LE(at + 8) + file.readBigUInt64LE(at + 32)),
      ),
    );
}

export const model: FeatureModel = loadFeatures(repositoryRoot);
export const builtinEntries: BuiltinEntry[] = builtinFeatureUses();
export const isModule = ({ kind }: BuiltinEntry): boolean => kind === "Module";
export const isNamedFromGlobalObject = ({ kind, hasHiddenRoot }: BuiltinEntry): boolean =>
  !hasHiddenRoot && kind !== "Module" && kind !== "InternalModule" && kind !== "NativeBinding";

function readTableOfThisBun(): TrimTable | undefined {
  try {
    return readTrimTable(bunExe());
  } catch (error) {
    if (String((error as Error).message).includes("this build of Bun doesn't support --trim")) return undefined;
    throw error;
  }
}

const table: TrimTable | undefined = readTableOfThisBun();
export const canTrim: boolean = table !== undefined;

/** What a build with --trim says. */
export function probeTrim(): { stderr: string; exitCode: number } {
  using probe = tempDir("compile-trim-probe", { "hello.ts": 'console.log("hello world");' });
  const probed = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "--trim", "hello.ts", "--outfile", "hello"],
    cwd: String(probe),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { stderr: probed.stderr.toString(), exitCode: probed.exitCode };
}

const featuresByKey = new Map<string, FeatureName>();
for (const { name } of model.features) {
  const key = name.toLowerCase();
  const other = featuresByKey.get(key);
  if (other !== undefined)
    throw new Error(`src/trim/features declares ${other} and ${name}, which differ only in case`);
  featuresByKey.set(key, name);
}

export function findFeature(spelling: string): FeatureName | undefined {
  return featuresByKey.get(spelling.replaceAll(/[-_]/g, "").toLowerCase());
}

export function featureNamed(spelling: string): FeatureName {
  const feature = findFeature(spelling);
  if (feature === undefined) throw new Error(`src/trim/features declares no feature named ${spelling}`);
  return feature;
}

export function featureOf(builtinOrModule: string): FeatureName {
  const feature = builtinEntries
    .filter(each => each.path === builtinOrModule)
    .map(guardFeatureOf)
    .find(each => each !== undefined);
  if (feature === undefined) throw new Error(`no feature implements ${builtinOrModule}`);
  return feature;
}

export function textOf(feature: FeatureName): string {
  const found = model.features.find(each => each.name === feature);
  if (found === undefined) throw new Error(`src/trim/features declares no feature named ${feature}`);
  return found.text;
}

export function saysFeatureWasRemoved(stderr: string, feature: FeatureName): boolean {
  if (stderr.includes(`--trim removed ${textOf(feature)} from this executable`)) return true;
  // One of Bun's own modules may catch the error and put its message into one of its own: util.inspect into an AssertionError, inspector.open() into the line that Node prints.
  if (stderr.includes(`rror: ${textOf(feature)} was removed by --trim because your code never uses it by name.`))
    return true;
  // A native function of one of Bun's own modules has no path that a program could write. The message names what to allow.
  const [, publicName] =
    / was removed by --trim because your code never uses it by name\..* To keep it, add "([\w-]+)" to compile\.trim\.allow\b/.exec(
      stderr,
    ) ?? [];
  if (model.trimFeatures.some(each => each.name === publicName && each.features.includes(feature))) return true;
  const [, builtin] = /^\w*rror: (\S+) was removed by --trim\b.*\n\s*code: "ERR_FEATURE_REMOVED"/m.exec(stderr) ?? [];
  // Compiled code that knows which built-in it calls names its path. The function object that stays behind knows its own name only.
  return builtinEntries.some(
    entry =>
      (entry.path === builtin || entry.path.endsWith("." + builtin)) && entry.uses.some(use => use.feature === feature),
  );
}

export function withoutFeatures(features: readonly FeatureName[]): string[] {
  return features.length === 0 ? [] : [`--trim-without=${features.join(",")}`];
}

function pathsGuardedBy(features: readonly FeatureName[], isWanted: (entry: BuiltinEntry) => boolean): string[] {
  return builtinEntries
    .filter(each => {
      const feature = guardFeatureOf(each);
      return isWanted(each) && feature !== undefined && features.includes(feature);
    })
    .map(each => each.path);
}

export function builtinsOf(features: readonly FeatureName[]): string[] {
  return pathsGuardedBy(features, isNamedFromGlobalObject);
}

export function modulesOf(features: readonly FeatureName[]): string[] {
  return pathsGuardedBy(features, isModule);
}

// Bun.sql and its like load a module of Bun's own when they are first read.
export function modulesLoadedFor(features: readonly FeatureName[]): string[] {
  return pathsGuardedBy(features, each => isModule(each) || each.kind === "InternalModule");
}

export interface TrimFeatureDetails extends TrimFeature {
  modules: string[];
}

export const trimFeatures: TrimFeatureDetails[] = model.trimFeatures.map(each => ({
  ...each,
  modules: modulesOf(each.features),
}));

export function trimFeatureNamed(name: string): TrimFeatureDetails {
  const found = trimFeatures.find(each => each.name === name);
  if (found === undefined) throw new Error(`src/trim/features declares no trim feature named ${name}`);
  return found;
}

export function narrowestNameOf(feature: FeatureName): string | undefined {
  return narrowestTrimFeature(model, feature)?.name;
}

if (table !== undefined && table.featuresHash !== model.hash)
  throw new Error("this Bun was linked with another list of features than src/trim/features");

const featuresByIndex = new Map(model.features.map(each => [each.index, each.name]));

function nameOf(index: number): FeatureName {
  const name = featuresByIndex.get(index);
  if (name === undefined) throw new Error(`src/trim/features declares no feature with index ${index}`);
  return name;
}

// Which features keep the bytes at an address of this Bun in an executable without `removed`. Undefined: nothing takes them along.
export function featuresThatKeep(address: number, removed: readonly FeatureName[]): FeatureName[] | undefined {
  const range = table?.ranges.find(({ start, end }) => start <= address && address < end);
  return range && table!.sets[range.set]!.map(nameOf).filter(name => !removed.includes(name));
}

// Where the bytes that go with `feature` are in this Bun, given the features that were removed from an executable.
export function describeBytesRemovedWith(feature: FeatureName, removedIndexes: readonly number[]): string {
  if (table === undefined) return "this Bun has no trim table";
  const { ranges, sets } = table;
  const removed = new Set(removedIndexes);
  const goesWithFeature = (set: number) => sets[set]!.some(index => nameOf(index) === feature);
  const bytesOfSet = new Map<number, { cuttable: number; fillOnly: number }>();
  const holes: { bytes: number; bytesOfFeature: number; end: number }[] = [];
  let isNextToHole = false;
  for (const { start, end, set, canBeCut } of ranges) {
    const bytesOfFeature = goesWithFeature(set) ? end - start : 0;
    if (bytesOfFeature > 0) {
      const bytes = bytesOfSet.getOrInsert(set, { cuttable: 0, fillOnly: 0 });
      bytes[canBeCut ? "cuttable" : "fillOnly"] += bytesOfFeature;
    }
    const isInHole = canBeCut && sets[set]!.every(index => removed.has(index));
    const last = holes.at(-1);
    if (isInHole && isNextToHole && last!.end === start) {
      last!.bytes += end - start;
      last!.bytesOfFeature += bytesOfFeature;
      last!.end = end;
    } else if (isInHole) holes.push({ bytes: end - start, bytesOfFeature, end });
    isNextToHole = isInHole;
  }
  holes.sort((a, b) => b.bytes - a.bytes);
  return [
    ...[...bytesOfSet]
      .sort(([, a], [, b]) => b.cuttable + b.fillOnly - a.cuttable - a.fillOnly)
      .slice(0, 12)
      .map(([set, { cuttable, fillOnly }]) => {
        const kept = sets[set]!.filter(index => !removed.has(index)).map(nameOf);
        return `${cuttable} bytes that can be cut and ${fillOnly} that can only be filled go with ${sets[set]!.map(nameOf).join(", ")}; kept: ${kept.join(", ") || "none"}`;
      }),
    `${holes.length} holes`,
    ...holes.flatMap(({ bytes, bytesOfFeature }, index) =>
      bytesOfFeature > 0
        ? [`hole ${index + 1} by size: ${bytes} bytes, ${bytesOfFeature} of them go with ${feature}`]
        : [],
    ),
  ].join("\n");
}

const enteredFromCommandLine = new Set(
  model.features.filter(each => each.enteredFrom === "command-line").map(each => each.index),
);

export const requirements: { feature: FeatureName; required: FeatureName }[] = (table?.edges ?? [])
  .filter(({ from, strength }) => strength !== "RecoverableGuard" && !enteredFromCommandLine.has(from))
  .map(({ from, to }) => ({ feature: nameOf(from), required: nameOf(to) }));

export const followedRequirements: { name: string; requiredName: string }[] = (table?.edges ?? [])
  .filter(({ strength, isFollowed }) => isFollowed && strength !== "RecoverableGuard")
  .flatMap(({ from, to }) => {
    const name = narrowestNameOf(nameOf(from));
    const requiredName = narrowestNameOf(nameOf(to));
    return name !== undefined && requiredName !== undefined && name !== requiredName ? [{ name, requiredName }] : [];
  });

function findNameRemovedWith(chosen: TrimFeatureDetails[]): string | undefined {
  const removed = new Set(chosen.flatMap(each => each.features));
  for (const { features } of chosen) {
    for (const { feature, required } of requirements) {
      if (!features.includes(required) || removed.has(feature)) continue;
      const other = narrowestNameOf(feature);
      if (other !== undefined && !chosen.some(each => each.name === other)) return other;
    }
  }
  return undefined;
}

export function removedOnlyWith(name: string): string[] {
  const chosen = [trimFeatureNamed(name)];
  for (let other = findNameRemovedWith(chosen); other !== undefined; other = findNameRemovedWith(chosen)) {
    chosen.push(trimFeatureNamed(other));
  }
  return chosen.slice(1).map(each => each.name);
}
