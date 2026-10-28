// The sampling profiler's tier breakdown has a row for compiled code: a sample whose top frame is a compiled function counts as "AOT".
// Plain Bun has no such row.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isBuildKite, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./run-programs";
import { test as testCompiled } from "./supported";

// The inner loop is int32 arithmetic with no calls, so nearly every sample has its pc in hot() itself.
const source = `import { profile } from "bun:jsc";

function hot(): number {
  const deadline = Date.now() + 300;
  let sum = 0;
  while (Date.now() < deadline) for (let i = 0; i < 1_000_000; i++) sum = (sum + (i ^ (sum >>> 3))) | 0;
  return sum;
}

const { bytecodes, stackTraces } = profile(hot);
const categories = new Set<string>();
for (const trace of stackTraces.traces) for (const frame of trace.frames) if (frame.name === "hot") categories.add(frame.category);
console.log(JSON.stringify({ bytecodes, categories: [...categories].sort() }));
`;

const env = { ...bunEnv, BUN_JSC_samplingProfilerTopBytecodesCount: "1" };
const interpreterAndJITTiers = ["LLInt", "Baseline", "DFG", "FTL"];

function parseReport(run: Awaited<ReturnType<typeof spawned>>) {
  expect({ stderr: run.stderr, exitCode: run.exitCode, signal: run.signal }).toEqual({
    stderr: expect.any(String),
    exitCode: 0,
    signal: null,
  });
  const { bytecodes, categories } = JSON.parse(run.stdout) as { bytecodes: string; categories: string[] };
  const [breakdown, hottest = ""] = bytecodes.split("Hottest bytecodes");
  return {
    tiers: Object.fromEntries(
      Array.from(breakdown.matchAll(/^(.+): +(\d+) +\(/gm), ([, tier, count]): [string, number] => [
        tier,
        Number(count),
      ]),
    ),
    hottest: Array.from(hottest.matchAll(/^ *\d+ +'(.*)'$/gm), ([, description]) => description),
    categories,
  };
}

testCompiled.todoIf(isBuildKite && isWindows)(
  "samples of a compiled function count as AOT",
  async () => {
    using dir = tempDir("aot-sampling-profiler-tiers", { "main.ts": source });
    const cwd = String(dir);
    const executable = join(cwd, isWindows ? "program.exe" : "program");
    built(await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], cwd, bunEnv));

    const { tiers, hottest, categories } = parseReport(await spawned([executable], cwd, env));
    expect(tiers.AOT).toBeGreaterThan(0);
    expect(interpreterAndJITTiers.map(tier => tiers[tier])).toEqual([0, 0, 0, 0]);
    expect(hottest).toEqual(["hot#<nil>:None:<nil>"]);
    expect(categories).toEqual(["AOT"]);
  },
  120_000,
);

test.todoIf(isBuildKite && isWindows)(
  "plain Bun prints no AOT row",
  async () => {
    using dir = tempDir("aot-sampling-profiler-tiers", { "main.ts": source });
    const cwd = String(dir);

    const { tiers, hottest, categories } = parseReport(await spawned([bunExe(), "main.ts"], cwd, env));
    expect(tiers.AOT).toBeUndefined();
    expect(interpreterAndJITTiers.reduce((samples, tier) => samples + tiers[tier], 0)).toBeGreaterThan(0);
    expect(hottest).toEqual([expect.stringMatching(/^hot#/)]);
    expect(categories).not.toBeEmpty();
    expect(categories.filter(category => !interpreterAndJITTiers.includes(category))).toEqual([]);
  },
  30_000,
);
