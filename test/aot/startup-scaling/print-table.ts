import { rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram } from "./build-program";
import { folderName, generateProgram, kinds, scenarios, useEverything } from "./generate-program";
import { measureStartup, type Measurement } from "./measure-startup";

const options: Record<string, string> = {};
const kindNames: string[] = [];
for (const argument of process.argv.slice(2)) {
  const option = /^--([a-z]+)(?:=(.*))?$/.exec(argument);
  if (option) options[option[1]] = option[2] ?? "1";
  else kindNames.push(argument);
}
const bun = options.bun ?? process.execPath;
const usedCount = Number(options.used ?? 100);
const counts = (options.counts ?? "1000,100000").split(",").map(Number);
const work = options.work ?? join(tmpdir(), `startup-scaling-${process.pid}`);
const scenarioNames = options.scenarios?.split(",") ?? [...scenarios, useEverything, ...kinds.filter(kind => kind.name !== "built-in modules").map(kind => `use ${kind.name}`)];
const env = { ...process.env, BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1" };
const together = "together";
const allKindNames = kindNames.length ? kindNames : kinds.map(kind => kind.name);

function findKind(name: string) {
  const kind = kinds.find(kind => kind.name === name);
  if (!kind) throw new Error(`unknown kind "${name}"; the kinds are: ${kinds.map(kind => kind.name).join(", ")}`);
  return kind;
}

async function printRows(kindName: string, count: number) {
  const unusedKinds = kindName === together ? allKindNames.map(findKind) : [findKind(kindName)];
  const folder = join(work, `${kindName === together ? together : folderName(unusedKinds[0])}-${count}`);
  rmSync(folder, { recursive: true, force: true });
  const unused = unusedKinds.map(kind => ({ kind, count: kind.isSlowToCompile && kindName === together ? Math.ceil(count / 5) : count }));
  const build = await buildProgram(bun, folder, generateProgram(usedCount ? kinds.filter(kind => kind.name !== "built-in modules") : [], usedCount, unused), env, options.flags?.split(","));
  if (build.error) return void console.log([kindName, count, "BUILD FAILED", JSON.stringify(build.error.slice(-500))].join("\t"));
  for (const scenario of scenarioNames) {
    try {
      const measurements: Measurement[] = [];
      for (let run = 0; run < Number(options.runs ?? 3); run++) measurements.push(await measureStartup({ command: [build.executable, scenario], env, forcePtrace: !!options.ptrace }));
      const least = (select: (measurement: Measurement) => number) => Math.min(...measurements.map(select));
      console.log(
        [kindName, count, scenario, least(m => m.instructions), least(m => m.allThreadsInstructions ?? NaN), least(m => m.privateBytes), least(m => m.residentBytes), statSync(build.executable).size, build.seconds.toFixed(1), measurements[0].counter].join("\t"),
      );
    } catch (error) {
      console.log([kindName, count, scenario, "FAILED", String(error).slice(0, 300)].join("\t"));
    }
  }
  if (!options.keep) rmSync(folder, { recursive: true, force: true });
}

const cells = counts.toSorted((a, b) => b - a).flatMap(count => (options.together ? [together] : allKindNames).map(name => [name, count] as const));
await Promise.all(
  Array.from({ length: Number(options.jobs ?? 4) }, async () => {
    for (let cell = cells.shift(); cell; cell = cells.shift()) await printRows(...cell);
  }),
);
if (!options.keep) rmSync(work, { recursive: true, force: true });
