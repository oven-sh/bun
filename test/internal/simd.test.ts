import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isASAN, isBuildKite, isCI, isDebug, isLinux, isMacOS, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { availableParallelism, cpus } from "node:os";
import { join, resolve } from "node:path";

// The runner is `src/simd/conformance`. It is only compiled into debug and canary builds.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

async function run(target: string | undefined, args: string[], build = bunExe(), files = {}) {
  // A build without the runner would run the tests in its working directory.
  using dir = tempDir("simd", files);
  await using proc = Bun.spawn({
    cmd: [build, "test", "--run-simd-tests", ...args],
    cwd: String(dir),
    env: { ...bunEnv, BUN_SIMD_TARGET: target },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const lines = stdout.trimEnd().split("\n");
  const values = (key: string) => lines.filter(it => it.startsWith(`${key}: `)).map(it => it.slice(key.length + 2));
  return { lines, values, exitCode };
}

const probe = hasRunner ? await run(undefined, ["probe"]) : undefined;
const baseline = isArm64 ? "neon" : "sse4";
// A program that is compiled for a better target has no portable copies.
const targets = probe?.values("target").filter(target => !target.startsWith("portable")) ?? [];
// The checksums have copies for these.
const further = isArm64 ? ["neon+dotprod", "neon+crc+aes"] : ["sse4+pclmulqdq", "avx2+avx512vl", "avx2+vpclmulqdq"];
const canRun = (limit: string) => {
  const [target, ...features] = limit.split("+");
  return targets.includes(target) && features.every(it => probe!.values("feature").includes(it));
};

describe.skipIf(!hasRunner)("bun_simd", () => {
  test("an instruction of each detected feature runs", () => {
    expect(probe!.values("feature")).toContain(isArm64 ? "neon" : "sse4.2");
    expect(targets.at(-1)).toBe(baseline);
    expect({ last: probe!.lines.at(-1), exitCode: probe!.exitCode }).toMatchObject({ exitCode: 0 });
  });

  test.skipIf(!isCI)("detects what every CI machine has", () => {
    const features = isArm64 ? ["lse", "aes", "dotprod"] : ["avx2", "bmi2", "aes", "pclmulqdq"];
    expect(probe!.values("feature")).toEqual(expect.arrayContaining(features));
  });

  test.skipIf(!isMacOS)("agrees with sysctl", () => {
    const [name, feature] = isArm64 ? ["hw.optional.arm.FEAT_I8MM", "i8mm"] : ["hw.optional.avx512f", "avx512f"];
    const { stdout } = Bun.spawnSync({ cmd: ["sysctl", "-n", name] });
    expect(probe!.values("feature").includes(feature)).toBe(stdout.toString().trim() === "1");
  });

  // An emulator shows the file of its host.
  test.skipIf(!isLinux || !isBuildKite || isArm64)("agrees with /proc/cpuinfo", () => {
    const flags = readFileSync("/proc/cpuinfo", "utf8").match(/^flags.*/m)![0];
    const has = (names: string) => names.split(" ").every(it => flags.split(" ").includes(it));
    const skx = "popcnt bmi1 bmi2 abm pclmulqdq avx2 fma f16c avx512f avx512bw avx512cd avx512dq avx512vl";
    expect([targets.includes("avx512_icl"), probe!.values("feature").includes("avx512bf16")]).toEqual([
      has(`${skx} avx512vbmi avx512_vbmi2 avx512_vnni avx512_bitalg avx512_vpopcntdq gfni vpclmulqdq`),
      has("avx2 fma f16c avx512f avx512bw avx512_bf16"),
    ]);
  });

  test.concurrent.each([
    ["", true],
    ["avx512_icl+avx512bf16", true],
    ["avx512_icl", false],
    ["avx2+avx512bf16", false],
  ])("zstd uses its kernels only with BF16, under the limit %j", async (limit, isAllowed) => {
    const { values, exitCode } = await run(limit, ["probe"]);
    expect(values("zstd")).toEqual([`[false, ${isAllowed && canRun("avx512_icl+avx512bf16")}]`]);
    expect(exitCode).toBe(0);
  });

  // It takes 1200 to put each short length at both ends of a page.
  const rounds = isDebug || isASAN ? "1200" : "10000";

  describe.each(targets)("%s returns what has been recorded", target => {
    test.concurrent.each(["..j", "j..m", "m..p", "p..w", "w..~"])("in the parts %s", async parts => {
      const { lines, exitCode } = await run(target, ["check-only", parts, rounds]);
      const byDefault = target === "avx512_skx" ? "avx2" : target;
      expect(lines).toEqual([`chosen: ${byDefault} ${target}`, `rounds: ${rounds}`]);
      expect(exitCode).toBe(0);
    });
  });

  // Without the feature, it would run the copy that `targets` covers.
  for (const limit of further) {
    test.concurrent.skipIf(!canRun(limit))(`${limit} returns what has been recorded`, async () => {
      const { lines, exitCode } = await run(limit, ["check-only", "checksums", rounds]);
      const [target] = limit.split("+");
      expect(lines).toEqual([`chosen: ${target} ${target}`, `rounds: ${rounds}`]);
      expect(exitCode).toBe(0);
    });
  }

  test.concurrent.each(["avx512_icl", "", "AVX2"])("%j leaves the best target", async target => {
    const { lines, exitCode } = await run(target, ["check", "3"]);
    const byDefault = targets.find(target => target !== "avx512_skx");
    expect(lines).toEqual([`chosen: ${byDefault} ${targets[0]}`, "rounds: 3"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent.each(["portable", `${baseline}+missing`])("%j picks the baseline", async limit => {
    const { lines, exitCode } = await run(limit, ["check", "3"]);
    expect(lines).toEqual([`chosen: ${baseline} ${baseline}`, "rounds: 3"]);
    expect(exitCode).toBe(0);
  });
});

// Prints tables and asserts nothing about them. See `getSimdBenchmarkStep()` in .buildkite/ci.ts.
describe.skipIf(!hasRunner || !process.env.BUN_SIMD_BENCHMARK)("benchmark", () => {
  const { BUN_SIMD_BENCHMARK_AGAINST: other, BUN_SIMD_BENCHMARK_FILTER: filter = "" } = process.env;

  async function times(...args: Parameters<typeof run>) {
    const { lines, exitCode } = await run(...args);
    expect(lines[0]).toEndWith(` ${args[0]!.split("+")[0]}`);
    expect(exitCode).toBe(0);
    const rows = lines.slice(1).map(line => line.split("\t"));
    const byName = new Map(rows.map(([name, ...times]) => [name, times.map(Number)]));
    expect(byName.size).toBe(rows.length);
    return byName;
  }

  function print(title: string, columns: string[], rows: Map<string, number[]>) {
    const line = (name: string, ...cells: string[]) =>
      (name.padEnd(64) + cells.map(it => it.padStart(14)).join("")).trimEnd();
    const text = (value: number | undefined, digits: number) => (Number.isFinite(value) ? value!.toFixed(digits) : "");
    const lines = Array.from(rows, ([name, [a, b]]) => line(name, text(a, 2), text(b, 2), text(b / a, 3)));
    const logs = Array.from(rows.values(), ([a, b]) => Math.log(b / a)).filter(Number.isFinite);
    const mean = Math.exp(logs.reduce((sum, it) => sum + it, 0) / logs.length);
    if (logs.length) lines.push(line("geometric mean", "", "", text(mean, 3)));
    console.log([line(title, ...columns), ...lines, ""].join("\n"));
  }

  test("machine", () => {
    console.log(`${availableParallelism()} x ${cpus()[0].model}\n${probe!.values("feature").join(" ")}\n`);
  });

  const builds = other ? [resolve(other), bunExe()] : [bunExe()];
  const turns = other ? 6 : 1;

  // Few kernels have a copy for avx512_skx.
  test.each([...targets.filter(target => target !== "avx512_skx"), ...further.filter(canRun)])(
    "kernels on %s",
    async target => {
      const js = require.resolve("typescript");
      const json = join(import.meta.dir, "../cli/install/migration/contoso-test/package-lock.json");
      const entrypoint = join(import.meta.dir, "../../bench/react-hello-world/react-hello-world.workerd.js");
      const { outputs } = await Bun.build({ entrypoints: [entrypoint], sourcemap: "external", external: ["*"] });
      const { mappings } = await outputs[0].sourcemap!.json();
      const only = filter || (further.includes(target) ? "32 " : "");
      const best = new Map<string, number[]>();
      for (let turn = 0; turn < turns; turn++) {
        const i = turn % builds.length;
        const rows = await times(target, ["bench", js, json, "mappings", only], builds[i], { mappings });
        expect(rows.size).toBeGreaterThan(0);
        for (const [name, time] of rows) {
          expect(time).toHaveLength(1);
          const row = best.getOrInsert(name, []);
          row[i] = Math.min(row[i] ?? Infinity, time[0]);
        }
      }
      print(`${target}, ns`, other ? ["that build", "this build", "ratio"] : [], best);
    },
    60_000 * turns,
  );

  test.each(targets.filter(target => target !== "avx512_skx"))(
    "end of a page on %s",
    async target => print(`${target}, ns`, ["mid page", "end of page", "ratio"], await times(target, ["edges"])),
    60_000,
  );

  test.each(targets.filter(target => target !== "avx512_skx"))(
    "first search after a pause on %s",
    async target => print(`${target}, ns with the clock`, [], await times(target, ["pauses"])),
    60_000,
  );

  test.each(targets)(
    "scalar code next to %s",
    async target => {
      for (const busy of [1, availableParallelism()]) {
        const [rows, ...others] = await Promise.all(Array.from({ length: busy }, () => times(target, ["clock"])));
        for (const other of others) {
          for (const [name, row] of other) row.forEach((time, i) => (rows.get(name)![i] += time));
        }
        print(`${target}, ${busy} busy, sum of ns per step`, ["alone", "with searches", "ratio"], rows);
      }
    },
    60_000,
  );
});
