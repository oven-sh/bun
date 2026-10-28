// A type error stops `bun build --compile --aot` wherever it stands in code that runs; an error in code that nothing reaches does not.
// type-error-positions.test.ts asks that of every kind of place, one small program each. This asks it of real programs: it inserts
// `__hit((1 as number).nope)` (TS2339) before a statement or at the start of an arrow function's body somewhere in a program under
// test/aot/programs, runs the result in plain Bun to see whether that place runs (`__hit` prints a marker), and if it does, the
// build has to fail with TS2339.
//
//   bun test test/aot/type-errors-in-reached-code                      40 programs, 2 places each, chosen by a hash of their paths
//   AOT_FUZZ_PROGRAMS=3000 AOT_FUZZ_SEED=7 bun test test/aot/type-errors-in-reached-code
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { withPackedPrograms } from "./generate";
import { unsupported } from "./run-programs";

const programCount = Number(process.env.AOT_FUZZ_PROGRAMS) || 40;
const placesPerProgram = Number(process.env.AOT_FUZZ_MUTANTS_PER_PROGRAM) || 2;
const seed = Number(process.env.AOT_FUZZ_SEED) || 1;
const marker = "@@reached";
const helper = `\nfunction __hit<T>(x: T): T { (globalThis as any).console.log("${marker}"); return x; }\n`;
const bad = "__hit((1 as number).nope)";

function mulberry32(state: number) {
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function singleFilePrograms(folder: string, into: string[] = []) {
  const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  if (entries.some(entry => entry.isFile() && entry.name.startsWith("main."))) return into;
  const names = new Set(entries.map(entry => entry.name));
  for (const entry of entries) {
    if (entry.isDirectory()) singleFilePrograms(join(folder, entry.name), into);
    else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !names.has(entry.name.slice(0, -3) + ".json")
    )
      into.push(join(folder, entry.name));
  }
  return into;
}

function insertError(source: string, random: () => number): string {
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  const insert = (at: number, text: string) => source.slice(0, at) + text + source.slice(at);
  const statements = [...source.matchAll(/(?<=[;{}] )(?=(?:return |const |let |if \(|for \(|[a-z_$][\w$.]*\())/g)];
  const arrowBodies = [...source.matchAll(/=> (?=[\w(\["`])/g)];
  if (random() < 0.5 && statements.length) return insert(pick(statements).index, bad + "; ");
  if (arrowBodies.length) {
    const arrow = pick(arrowBodies);
    return insert(arrow.index + arrow[0].length, bad + " ?? ");
  }
  return source;
}

async function run(cmd: string[], cwd: string, timeout: number) {
  await using spawned = Bun.spawn({ cmd, cwd, env: bunEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout });
  const [stdout, stderr] = await Promise.all([spawned.stdout.text(), spawned.stderr.text(), spawned.exited]);
  return stdout + stderr;
}

test.skipIf(!!unsupported)(
  `a type error in code that runs stops the build: ${programCount} programs`,
  async () => {
    using root = tempDir("aot-type-errors-in-reached-code", {});
    const kept = join(import.meta.dir, "programs");
    const { paths: programs, textOf } = withPackedPrograms(kept, singleFilePrograms(kept), /(?<!\.d)\.ts$/, [".json"]);
    const jobs = programs
      .map(path => ({ path, hash: Number(Bun.hash.crc32(seed + ":" + path.slice(import.meta.dir.length + 1))) }))
      .sort((a, b) => a.hash - b.hash)
      .slice(0, programCount);
    const missed: { from: string; source: string }[] = [];
    let reached = 0;
    let next = 0;
    const worker = async (id: number) => {
      const folder = join(String(root), String(id));
      mkdirSync(folder);
      while (next < jobs.length) {
        const { path, hash } = jobs[next++];
        const random = mulberry32(hash);
        const source = textOf(path);
        // `// @ts-ignore` and the like silence the inserted error too.
        if (/@ts-(ignore|expect-error|nocheck)/.test(source)) continue;
        for (let place = 0; place < placesPerProgram; place++) {
          const changed = insertError(source, random);
          if (changed === source) continue;
          writeFileSync(join(folder, "main.ts"), changed + helper);
          if (!(await run([bunExe(), "run", "./main.ts"], folder, 30_000)).includes(marker)) continue;
          reached++;
          const said = await run(
            [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "./compiled"],
            folder,
            120_000,
          );
          if (!/error: TS2339/.test(said))
            missed.push({ from: path.slice(import.meta.dir.length + 1), source: changed });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, availableParallelism() >> 1) }, (_, id) => worker(id)));
    expect(missed).toEqual([]);
    expect(reached).toBeGreaterThan(programCount / 4);
  },
  Math.max(600_000, programCount * placesPerProgram * 4_000),
);
