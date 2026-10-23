import { readTrimTable } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { join } from "node:path";

import { loadFeatures, serializeFeatureModel } from "../../../scripts/build/trim/features.ts";
import { describeMeasurement, findProfileFailures } from "../../../scripts/build/trim/profiles.ts";
import type { FeatureModel, Profile, ProfileMeasurement } from "../../../scripts/build/trim/types.ts";
import { abc } from "./toy-graph.ts";
import { skipNotice } from "./toy-program.ts";

const modelWith = (...profiles: Profile[]): FeatureModel => ({ ...abc, profiles });
const hello: Profile = { name: "hello", features: [], minimumCutRatio: { elf: 80, macho: 50 } };
const measured = (
  removedBytes: number,
  fileBytesSaved: number,
  more: Partial<ProfileMeasurement> = {},
): ProfileMeasurement => ({
  profile: "hello",
  removedBytes,
  fileBytesSaved,
  uncutReason: undefined,
  ...more,
});

describe("findProfileFailures", () => {
  test("passes at the ratio and above it", () => {
    expect(findProfileFailures(modelWith(hello), "elf", [measured(1000, 800)])).toEqual([]);
    expect(findProfileFailures(modelWith(hello), "elf", [measured(1000, 1000)])).toEqual([]);
  });

  test("fails below the ratio, also by less than a percent", () => {
    expect(findProfileFailures(modelWith(hello), "elf", [measured(1000, 799)])).toEqual([
      "profile hello: 79% of the removed bytes leave the file, and src/trim/features/profiles.def sets a minimum of 80% for elf",
    ]);
    expect(findProfileFailures(modelWith(hello), "elf", [measured(1000, 0)])).toEqual([
      "profile hello: 0% of the removed bytes leave the file, and src/trim/features/profiles.def sets a minimum of 80% for elf",
    ]);
  });

  test("asks for the ratio of the format that is linked", () => {
    expect(findProfileFailures(modelWith(hello), "macho", [measured(1000, 799)])).toEqual([]);
    expect(findProfileFailures(modelWith(hello), "macho", [measured(1000, 499)])).toEqual([
      "profile hello: 49% of the removed bytes leave the file, and src/trim/features/profiles.def sets a minimum of 50% for macho",
    ]);
  });

  test("a format without a ratio passes whatever leaves the file", () => {
    expect(findProfileFailures(modelWith(hello), "coff", [measured(1000, 0)])).toEqual([]);
  });

  test("a ratio of 0 passes whatever leaves the file", () => {
    expect(
      findProfileFailures(modelWith({ ...hello, minimumCutRatio: { elf: 0 } }), "elf", [measured(1000, 0)]),
    ).toEqual([]);
  });

  test("a profile without a measurement fails", () => {
    expect(findProfileFailures(modelWith(hello), "elf", [])).toEqual(["profile hello has no measurement"]);
    expect(findProfileFailures(modelWith(hello), "elf", [measured(1000, 1000, { profile: "other" })])).toEqual([
      "profile hello has no measurement",
    ]);
  });

  test("a profile that removes nothing fails, also for a format without a ratio", () => {
    expect(findProfileFailures(modelWith(hello), "elf", [measured(0, 0)])).toEqual(["profile hello removes nothing"]);
    expect(findProfileFailures(modelWith(hello), "coff", [measured(0, 0)])).toEqual(["profile hello removes nothing"]);
  });

  test("failures come in the order of the profiles", () => {
    const server: Profile = { name: "server", features: ["A"], minimumCutRatio: { elf: 50 } };
    const tool: Profile = { name: "tool", features: ["B"], minimumCutRatio: { elf: 50 } };
    expect(
      findProfileFailures(modelWith(hello, server, tool), "elf", [
        measured(0, 0, { profile: "tool" }),
        measured(100, 90),
        measured(100, 10, { profile: "server" }),
      ]),
    ).toEqual([
      "profile server: 10% of the removed bytes leave the file, and src/trim/features/profiles.def sets a minimum of 50% for elf",
      "profile tool removes nothing",
    ]);
  });

  test("a model without profiles has no failure", () => {
    expect(findProfileFailures(modelWith(), "elf", [measured(0, 0)])).toEqual([]);
  });
});

describe("describeMeasurement", () => {
  test("prints both sizes and the whole percent that leaves the file", () => {
    expect(describeMeasurement(measured(61_200_000, 58_900_000))).toBe(
      "hello: 61.20 MB removed, 58.90 MB from the file (96%)",
    );
  });

  test("adds why the rest was not cut", () => {
    expect(describeMeasurement(measured(1_000_000, 500_000, { uncutReason: "BudgetSpent" }))).toBe(
      "hello: 1.00 MB removed, 0.50 MB from the file (50%) (BudgetSpent)",
    );
  });

  test("prints no percent where nothing was removed", () => {
    expect(describeMeasurement(measured(0, 0))).toBe("hello: 0.00 MB removed, 0.00 MB from the file");
  });
});

function hasTrimTable(executable: string): boolean {
  try {
    readTrimTable(executable);
    return true;
  } catch {
    return false;
  }
}

const canMeasure = hasTrimTable(bunExe());
if (!canMeasure)
  skipNotice("profiles.test.ts", "this Bun has no trim table: the case that measures the profiles does not run");

test.skipIf(!canMeasure)(
  "profiles.ts measures every profile in the Bun it is given, in an environment that sets nothing for it",
  async () => {
    const root = join(import.meta.dir, "..", "..", "..");
    const model = loadFeatures(root);
    using dir = tempDir("trim-profiles", { "removable-features.json": serializeFeatureModel(model) });
    const { BUN_GARBAGE_COLLECTOR_LEVEL, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING, ...env } = bunEnv;
    const format = isMacOS ? "macho" : isWindows ? "coff" : "elf";
    const script = join(root, "scripts", "build", "trim", "profiles.ts");
    await using proc = Bun.spawn({
      cmd: [bunExe(), script, bunExe(), join(String(dir), "removable-features.json"), format],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const lines = stdout.trimEnd().split("\n");
    expect(lines.map(line => line.slice(0, line.indexOf(":")))).toEqual(model.profiles.map(profile => profile.name));
    for (const line of lines)
      expect(line).toMatch(/^[a-z0-9-]+: \d+\.\d\d MB removed, \d+\.\d\d MB from the file \(\d+%\)/);
  },
  120_000,
);
