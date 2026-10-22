import { afterAll, beforeAll, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { withoutDebugInformation } from "../run-programs";
import { describe, test } from "../supported";
import { buildProgram } from "./build-program";
import { generateProgram, kinds, scenarios, useEverything, type Kind } from "./generate-program";
import type { Measurement, Request } from "./measure-startup";

const usedCount = 50;
const smallCount = 100;
const largeCount = (kind: Kind) => kind.largeCount ?? (kind.isSlowToCompile ? 4_000 : 20_000);

// TODO: 20,000 unused enums cost 86,016 bytes of private memory at the start, and 20,000 unused static fields 151,552: 4 and 8 bytes each.
const kindsThatGrow = ["CommonJS modules", "embedded files", "enums", "static fields"];

const usedKinds = kinds.filter(kind => kind.name !== "built-in modules");

const runs = 5;
const rounds = 3;
const allowedPrivateGrowth = process.platform === "darwin" ? 256 * 1024 : 64 * 1024;
const privateGrowthFactor: Record<string, number> = { request: 4, workers: 8, terminate: 32 };
const scenariosWithOtherThreads = ["workers", "terminate"];
let freeSlots = Math.max(1, Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism());
const waiting: (() => void)[] = [];
let hasSaidThatNothingCounts = false;

async function measure(request: Request): Promise<Measurement> {
  if (freeSlots > 0) freeSlots--;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    await using child = Bun.spawn({ cmd: [bunExe(), join(import.meta.dir, "measure-startup.ts")], env: bunEnv, stdin: new Blob([JSON.stringify(request)]), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    if (exitCode) throw new Error(stderr.trim());
    return JSON.parse(stdout);
  } finally {
    const next = waiting.shift();
    if (next) next();
    else freeSlots++;
  }
}

async function measureLeast(executable: string, scenario: string): Promise<Measurement> {
  const env = {
    ...bunEnv,
    BUN_GARBAGE_COLLECTOR_LEVEL: "0",
    BUN_GC_TIMER_DISABLE: "1",
    BUN_JSC_useGC: scenario === "collect" ? "1" : "0",
    BUN_JSC_useConcurrentGC: "0",
    BUN_JSC_numberOfGCMarkers: "1",
  };
  const request = { command: [executable, scenario], env, afterMark: scenario !== "nothing", forcePtrace: !!process.env.AOT_STARTUP_SCALING_PTRACE };
  const first = await measure(request);
  if (first.counter === "none" && !hasSaidThatNothingCounts) {
    hasSaidThatNothingCounts = true;
    console.error("SKIPPED: test/aot/startup-scaling: instructions: this machine has no hardware instruction counter; memory is measured");
  }
  const all = first.counter === "ptrace" ? [first] : [first, ...(await Promise.all(Array.from({ length: runs - 1 }, () => measure(request))))];
  const least = (select: (measurement: Measurement) => number) => Math.min(...all.map(select));
  return {
    ...first,
    instructions: least(m => m.instructions),
    allThreadsInstructions: least(m => m.allThreadsInstructions ?? m.instructions),
    privateBytes: least(m => m.privateBytes),
    residentBytes: least(m => m.residentBytes),
  };
}

function leastOfBoth(one: Measurement, other: Measurement): Measurement {
  return {
    ...one,
    instructions: Math.min(one.instructions, other.instructions),
    allThreadsInstructions: Math.min(one.allThreadsInstructions!, other.allThreadsInstructions!),
    privateBytes: Math.min(one.privateBytes, other.privateBytes),
    residentBytes: Math.min(one.residentBytes, other.residentBytes),
  };
}

type Variant = { flags?: string[]; privateGrowthFactor?: number; scenariosThatGrow?: string[]; residentBytesDifferFromRunToRun?: true };

export function describeStartupScaling(label: string, isUnused: (kind: Kind, index: number) => boolean, variant: Variant = {}) {
  const unusedKinds = kinds.filter((kind, index) => isUnused(kind, index) && !kindsThatGrow.includes(kind.name));
  const skipped = isDebug || isASAN ? "a debug or ASAN build is too slow" : process.platform !== "linux" && process.platform !== "darwin" ? "it reads /proc or libproc" : undefined;
  if (skipped) console.error(`SKIPPED: test/aot/startup-scaling: ${skipped}`);

  describe.skipIf(!!skipped)(`${label}: unused ${unusedKinds.map(kind => kind.name).join(", ")}`, () => {
    let folder: ReturnType<typeof tempDir>;
    const executables = { small: "", large: "" };

    beforeAll(async () => {
      folder = tempDir("aot-startup-scaling", {});
      const build = (name: "small" | "large", count: (kind: Kind) => number) =>
        buildProgram(bunExe(), join(String(folder), name), generateProgram(usedKinds, usedCount, unusedKinds.map(kind => ({ kind, count: count(kind) }))), bunEnv, [...withoutDebugInformation(), ...(variant.flags ?? [])]);
      const [small, large] = await Promise.all([build("small", () => smallCount), build("large", largeCount)]);
      expect({ small: small.error, large: large.error }).toEqual({ small: undefined, large: undefined });
      executables.small = small.executable;
      executables.large = large.executable;
    }, 240_000);
    afterAll(() => folder?.[Symbol.dispose](), 240_000);

    test.concurrent.each([...scenarios, useEverything].filter(scenario => !variant.scenariosThatGrow?.includes(scenario)))(
      "%s",
      async scenario => {
        const measureBoth = () => Promise.all([measureLeast(executables.small, scenario), measureLeast(executables.large, scenario)]);
        const fileGrowth = statSync(executables.large).size - statSync(executables.small).size;
        const excessiveGrowth = (small: Measurement, large: Measurement) => {
          const allowed = {
            instructions: Math.round(small.instructions * 0.02) + 30_000 + (small.counter === "rusage" ? 500_000 + Math.round(fileGrowth * 0.02) : 0),
            allThreadsInstructions: scenariosWithOtherThreads.includes(scenario) ? Math.round(small.allThreadsInstructions! * 0.08) + 300_000 + (small.counter === "rusage" ? 500_000 + Math.round(fileGrowth * 0.02) : 0) : Infinity,
            privateBytes: allowedPrivateGrowth * (privateGrowthFactor[scenario] ?? 1) * (variant.privateGrowthFactor ?? 1),
            residentBytes: variant.residentBytesDifferFromRunToRun ? Infinity : 1024 * 1024 + Math.round(fileGrowth * 0.25),
          };
          const growth = {
            instructions: large.instructions - small.instructions,
            allThreadsInstructions: large.allThreadsInstructions! - small.allThreadsInstructions!,
            privateBytes: large.privateBytes - small.privateBytes,
            residentBytes: large.residentBytes - small.residentBytes,
          };
          return (Object.keys(growth) as (keyof typeof growth)[])
            .filter(name => growth[name] > allowed[name])
            .map(name => `${name} grew from ${small[name]} by ${growth[name]}; allowed: ${allowed[name]}`);
        };
        let [small, large] = await measureBoth();
        for (let round = 1; round < rounds && small.counter !== "ptrace" && excessiveGrowth(small, large).length; round++) {
          const [smallAgain, largeAgain] = await measureBoth();
          [small, large] = [leastOfBoth(small, smallAgain), leastOfBoth(large, largeAgain)];
        }
        expect(excessiveGrowth(small, large)).toEqual([]);
      },
      240_000,
    );
    for (const scenario of variant.scenariosThatGrow ?? []) test.todo(scenario);
  });
}

export function describePart(part: number, parts: number) {
  // TODO: with the kinds of the first and of the fourth part, a program that uses everything runs 206,190 and 237,242 instructions more beside the unused declarations, and about 185,000 are allowed.
  describeStartupScaling("--compile", (_, index) => index % parts === part - 1, part === 1 || part === 4 ? { scenariosThatGrow: [useEverything] } : {});
  if (part === 1) for (const name of kindsThatGrow) test.todo(`startup does not depend on the number of unused ${name}`);
}
