import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isASAN, isCI, isDebug, isMacOS, tempDir } from "harness";
import { availableParallelism, cpus } from "node:os";
import { join } from "node:path";

// The runner is `src/simd/conformance`. It is only compiled into debug and canary builds.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

async function run(...args: (string | number)[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--run-simd-tests", ...args.map(String)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const lines = stdout.trimEnd().split("\n");
  const values = (key: string) => lines.filter(it => it.startsWith(`${key}: `)).map(it => it.slice(key.length + 2));
  return { lines, values, exitCode };
}

const probe = hasRunner ? await run("probe") : undefined;
const baseline = isArm64 ? "neon" : "sse4";
// A program that is compiled for a better target has no portable copies.
const targets = probe?.values("target").filter(target => !target.startsWith("portable")) ?? [];

describe.skipIf(!hasRunner)("bun_simd", () => {
  test("an instruction of each detected feature runs", () => {
    expect(probe!.values("feature")).toContain(isArm64 ? "neon" : "sse4.2");
    expect(targets.at(-1)).toBe(baseline);
    expect({ last: probe!.lines.at(-1), exitCode: probe!.exitCode }).toMatchObject({ exitCode: 0 });
  });

  test.skipIf(!isCI)("detects what every CI machine has", () => {
    const features = isArm64 ? ["lse", "aes", "dotprod"] : ["avx2", "bmi2", "aes"];
    expect(probe!.values("feature")).toEqual(expect.arrayContaining(features));
  });

  test.skipIf(!isMacOS)("agrees with sysctl", () => {
    const [name, feature] = isArm64 ? ["hw.optional.arm.FEAT_I8MM", "i8mm"] : ["hw.optional.avx512f", "avx512f"];
    const { stdout } = Bun.spawnSync({ cmd: ["sysctl", "-n", name] });
    expect(probe!.values("feature").includes(feature)).toBe(stdout.toString().trim() === "1");
  });

  test.concurrent.each(targets)("%s matches Highway", async target => {
    const rounds = isDebug || isASAN ? 60 : 10_000;
    const { lines, exitCode } = await run("check", target, 1, rounds);
    const byDefault = target === "avx512_skx" ? "avx2" : target;
    expect(lines).toEqual([`chosen: ${byDefault} ${target}`, `rounds: ${rounds}`]);
    expect(exitCode).toBe(0);
  });

  test("a limit above the CPU picks its best target", async () => {
    const { values, exitCode } = await run("check", "avx512_icl", 2, 1);
    expect(values("chosen")).toEqual([`${targets.find(target => target !== "avx512_skx")} ${targets[0]}`]);
    expect(exitCode).toBe(0);
  });

  test("a limit below the build picks the baseline", async () => {
    const { values, exitCode } = await run("check", "portable", 3, 1);
    expect(values("chosen")).toEqual([`${baseline} ${baseline}`]);
    expect(exitCode).toBe(0);
  });
});

// Prints tables and asserts nothing about them. `getSimdBenchmarkStep()` in .buildkite/ci.ts runs it.
describe.skipIf(!hasRunner || !process.env.BUN_SIMD_BENCHMARK)("benchmark", () => {
  async function times(...args: string[]) {
    const { lines, exitCode } = await run(...args);
    expect(exitCode).toBe(0);
    return lines.slice(1).map(line => {
      const [name, first, second] = line.split("\t");
      return { name, first: +first, second: +second };
    });
  }

  function print(title: string, columns: [string, string], rows: Awaited<ReturnType<typeof times>>) {
    const line = (name: string, ...cells: string[]) => name.padEnd(48) + cells.map(it => it.padStart(14)).join("");
    const ratio = (row: (typeof rows)[number]) => row.second / row.first;
    const mean = Math.exp(rows.reduce((sum, row) => sum + Math.log(ratio(row)), 0) / rows.length);
    const body = rows.map(row => line(row.name, row.first.toFixed(2), row.second.toFixed(2), ratio(row).toFixed(3)));
    console.log(
      [line(title, ...columns, "ratio"), ...body, line("geometric mean", "", "", mean.toFixed(3)), ""].join("\n"),
    );
  }

  test("machine", () => {
    console.log(`${availableParallelism()} x ${cpus()[0].model}\n${probe!.values("feature").join(" ")}\n`);
  });

  // Few kernels have a copy for avx512_skx.
  test.each(targets.filter(target => target !== "avx512_skx"))(
    "kernels on %s",
    async target => {
      const js = require.resolve("typescript");
      const json = join(import.meta.dir, "../cli/install/migration/contoso-test/package-lock.json");
      const entrypoint = join(import.meta.dir, "../../bench/react-hello-world/react-hello-world.workerd.js");
      const { outputs } = await Bun.build({ entrypoints: [entrypoint], sourcemap: "external", external: ["*"] });
      using dir = tempDir("simd", { mappings: (await outputs[0].sourcemap!.json()).mappings });
      print(
        `${target}, ns`,
        ["Highway", "Rust"],
        await times("bench", target, js, json, join(String(dir), "mappings")),
      );
      print(`${target}, ns`, ["mid page", "end of page"], await times("edges", target));
    },
    60_000,
  );

  test.each(targets.filter(target => target !== "avx512_skx"))(
    "first search after a pause on %s",
    async target => print(`${target}, ns with the clock`, ["Highway", "Rust"], await times("pauses", target)),
    60_000,
  );

  test.each(targets)(
    "scalar code next to %s",
    async target => {
      for (const busy of [1, availableParallelism()]) {
        const [rows, ...others] = await Promise.all(Array.from({ length: busy }, () => times("clock", target)));
        for (const other of others) {
          other.forEach(({ first, second }, i) => ((rows[i].first += first), (rows[i].second += second)));
        }
        print(`${target}, ${busy} busy, sum of ns per step`, ["alone", "with searches"], rows);
      }
    },
    60_000,
  );
});
