import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { columns, rows, type Column, type Row } from "./rows";

const here = import.meta.dir;

const { values: options } = parseArgs({
  options: {
    bun: { type: "string" },
    released: { type: "string" },
    ceiling: { type: "string" },
    modules: { type: "string", multiple: true },
    "typed-modules": { type: "string", multiple: true },
    sources: { type: "string", multiple: true },
    work: { type: "string" },
    out: { type: "string" },
    cores: { type: "string", default: "0" },
    rows: { type: "string" },
    columns: { type: "string" },
    starts: { type: "string", default: "3" },
    windows: { type: "string", default: "5" },
    "window-milliseconds": { type: "string", default: "400" },
    "warm-up-milliseconds": { type: "string", default: "3000" },
    "warm-up-turns": { type: "string", default: "50" },
    "build-only": { type: "boolean", default: false },
    "no-build": { type: "boolean", default: false },
    table: { type: "string" },
  },
});

interface Cell {
  row: string;
  workload: string;
  column: string;
  failed?: boolean;
  starts: number;
  void: boolean;
  guests: number;
  answer: string;
  bytes: number;
  millisecondsATurn: number;
  spread: number;
  firstTurnMilliseconds: number;
  instructionsATurn: number;
  cyclesATurn: number;
  cpuMillisecondsATurn: number;
  peakRssMB: number;
  privateDirtyMB: number;
  executableBytes: number;
  codeBytes: number | null;
  accesses: string | null;
}

function median(numbers: number[]): number {
  const sorted = numbers.toSorted((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function parseCores(text: string): number[] {
  return text.split(",").flatMap(part => {
    const [first, last = first] = part.split("-").map(Number);
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  });
}

function selected<T extends { name: string }>(all: T[], names: string | undefined): T[] {
  if (!names) return all;
  return names.split(",").map(name => {
    const found = all.find(each => each.name === name);
    if (!found) throw new Error(`${name} is none of ${all.map(each => each.name).join(", ")}`);
    return found;
  });
}

const environment = { ...process.env, NODE_ENV: "production", BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1", NO_COLOR: "1" };

function findInstalled(name: string): string {
  for (const modules of options.modules ?? []) if (existsSync(join(modules, name, "package.json"))) return join(modules, name);
  throw new Error(`${name} is installed in none of ${(options.modules ?? []).join(", ")}`);
}

function findTyped(name: string): string | undefined {
  return [join(here, "packages"), ...(options["typed-modules"] ?? [])].map(folder => join(folder, name)).find(folder => existsSync(join(folder, "package.json")) && readFileSync(join(folder, "package.json"), "utf8").includes('"aot"'));
}

function versionOf(folder: string): string {
  return JSON.parse(readFileSync(join(folder, "package.json"), "utf8")).version;
}

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
}

function withoutTypedFiles(folder: string): void {
  const described = join(folder, "package.json");
  const text = JSON.parse(readFileSync(described, "utf8"), (key, value) => (key === "aot" ? undefined : value));
  writeFileSync(described, JSON.stringify(text, null, 2));
  for (const name of readdirSync(folder, { recursive: true }) as string[]) if (name.endsWith(".aot.ts")) rmSync(join(folder, name));
}

function sourcesOf(name: string): string {
  const found = (options.sources ?? []).find(each => each.startsWith(`${name}=`));
  if (!found) throw new Error(`--sources ${name}=<the folder with its package.json and src> is needed`);
  return found.slice(name.length + 1);
}

function buildLibrary(row: Row, library: NonNullable<Row["libraries"]>[number]): string {
  const folder = join(options.work!, row.name, `library-${library.name}`);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const sources = sourcesOf(library.name);
  for (const name of readdirSync(sources)) if (name === "src" || name === "LICENSE" || name === "README.md" || /^(package|tsconfig.*)\.json$/.test(name)) cpSync(join(sources, name), join(folder, name), { recursive: true });
  for (const [path, text] of Object.entries(library.added ?? {})) writeFileSync(join(folder, path), text);
  linkModules(join(folder, "node_modules"));
  rmSync(join(folder, "node_modules", library.name), { recursive: true, force: true });
  const built = Bun.spawnSync([options.bun!, "compile", "--library", ...library.entryPoints, ...(library.flags ?? [])], { cwd: folder, env: environment });
  writeFileSync(join(folder, "library.build.txt"), built.stdout.toString() + built.stderr.toString());
  if (built.exitCode !== 0) throw new Error(`${library.name}: bun compile --library ended with ${built.exitCode}\n${built.stderr.toString().slice(-2000)}`);
  return join(folder, "dist");
}

function linkModules(target: string): void {
  mkdirSync(target, { recursive: true });
  for (const modules of (options.modules ?? []).toReversed()) {
    for (const name of readdirSync(modules)) {
      if (name.startsWith(".")) continue;
      const names = name.startsWith("@") ? readdirSync(join(modules, name)).map(inner => `${name}/${inner}`) : [name];
      for (const each of names) {
        rmSync(join(target, each), { recursive: true, force: true });
        link(join(modules, each), join(target, each));
      }
    }
  }
}

type Variant = "as-installed" | "rebuilt" | "typed";

function layFolder(row: Row, variant: Variant, libraries: Map<string, string>): string {
  const typed = variant === "typed";
  const folder = join(options.work!, row.name, variant);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(join(folder, "node_modules"), { recursive: true });
  for (const name of ["programs", "turns.ts", "tsconfig.json"]) cpSync(join(here, name), join(folder, name), { recursive: true });

  linkModules(join(folder, "node_modules"));
  if (variant !== "as-installed") {
    for (const [name, dist] of libraries) {
      rmSync(join(folder, "node_modules", name), { recursive: true, force: true });
      cpSync(dist, join(folder, "node_modules", name), { recursive: true });
      if (!typed) withoutTypedFiles(join(folder, "node_modules", name));
    }
  }
  for (const name of row.ownPackages ?? []) {
    cpSync(join(here, "packages", name), join(folder, "node_modules", name), { recursive: true });
    if (!typed) withoutTypedFiles(join(folder, "node_modules", name));
  }
  if (typed) {
    for (const name of hasTypes(row) ? (row.typedPackages ?? []) : []) {
      const [installed, from, target] = [findInstalled(name), findTyped(name)!, join(folder, "node_modules", name)];
      if (versionOf(from) !== versionOf(installed)) throw new Error(`${name}: ${from} is ${versionOf(from)}, ${versionOf(installed)} is installed`);
      rmSync(target, { recursive: true, force: true });
      cpSync(realpathSync(installed), target, { recursive: true });
      cpSync(from, target, { recursive: true });
    }
  }
  return folder;
}

function bunOf(column: Column): string | undefined {
  return column.bun === "released" ? options.released : column.bun === "ceiling" ? options.ceiling : options.bun;
}

function executableOf(row: Row, column: Column): string {
  return join(options.work!, row.name, `${row.name}.${column.name}`);
}

function codeBytesOf(executable: string): number | null {
  if (!existsSync(`${executable}.report.json`)) return null;
  const found = /"codeBytes":\s*(\d+)/.exec(readFileSync(`${executable}.report.json`, "utf8"));
  return found ? Number(found[1]) : null;
}

function hasTypes(row: Row): boolean {
  return packagesOf(row).length > 0 && (row.typedPackages ?? []).every(name => findTyped(name));
}

function packagesOf(row: Row): string[] {
  return [...(row.typedPackages ?? []), ...(row.ownPackages ?? []), ...(row.libraries ?? []).map(library => library.name), ...(row.typedSources ? [row.name] : [])];
}

function countARun(row: Row, column: Column, folder: string): string {
  const executable = `${executableOf(row, column)}.counting`;
  const counts = `${executable}.counts.txt`;
  const built = Bun.spawnSync([bunOf(column)!, ...column.command, "--aot-count-branches", ...(row.flags ?? []), ...(row.typedFlags ?? []), `./programs/${row.entry}`, "--outfile", executable], { cwd: folder, env: environment });
  if (built.exitCode !== 0) throw new Error(`${row.name} ${column.name}: the counting build ended with ${built.exitCode}\n${built.stderr.toString().slice(-2000)}`);
  writeFileSync(counts, "");
  for (const workload of row.workloads) {
    const ran = Bun.spawnSync([executable, ...workload.arguments, "300", "50", "2", "100"], {
      cwd: folder,
      env: { ...environment, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: `${counts}.one` },
      stdin: "ignore",
    });
    if (ran.exitCode !== 0) throw new Error(`${row.name} ${workload.name}: the counting run ended with ${ran.exitCode}`);
    writeFileSync(counts, readFileSync(counts, "utf8") + readFileSync(`${counts}.one`, "utf8"));
  }
  rmSync(executable);
  return counts;
}

function build(row: Row, column: Column, folders: Record<string, string>): void {
  const bun = bunOf(column)!;
  const executable = executableOf(row, column);
  const folder = folders[column.typed ? "typed" : column.rebuilt ? "rebuilt" : "as-installed"];
  const whatIf: Record<string, string> = {};
  if (column.withoutTestsThatNeverFail) {
    whatIf.STB_COUNTS = countARun(row, column, folder);
    if (column.withoutTestsThatNeverFail === "in the packages") whatIf.STB_MODULES = packagesOf(row).map(name => `/${name}/`).join(",");
  }
  const report = column.command.includes("--no-aot") || column.command[0] !== "compile" ? [] : [`--aot-report=${executable}.report.json`];
  const built = Bun.spawnSync([bun, ...column.command, ...report, ...(row.flags ?? []), ...(column.typed ? (row.typedFlags ?? []) : []), `./programs/${row.entry}`, "--outfile", executable], {
    cwd: folder,
    env: { ...environment, ...whatIf },
  });
  const log = built.stdout.toString() + built.stderr.toString();
  writeFileSync(`${executable}.build.txt`, log);
  if (built.exitCode !== 0) throw new Error(`${row.name} ${column.name}: the build ended with ${built.exitCode}\n${log.slice(-2000)}`);
  const notes = log.split("\n").filter(line => /without (its |their )?types|^Dependencies:|^STB:/.test(line));
  console.log(`built ${row.name} ${column.name}: ${statSync(executable).size} B${notes.map(note => `\n    ${note.slice(0, 200)}`).join("")}`);
  if (column.typed && !row.typedSources && !JSON.parse(readFileSync(`${executable}.report.json`, "utf8")).statistics.TypedVersionsUsed)
    throw new Error(`${row.name} ${column.name}: no file under an "aot" condition was compiled`);
}

function busyTicks(core: number): number {
  const line = readFileSync("/proc/stat", "utf8").split("\n").find(each => each.startsWith(`cpu${core} `))!;
  const fields = line.split(/\s+/).slice(1).map(Number);
  return fields[0] + fields[1] + fields[2];
}

function busiestOn(core: number): string {
  const listed = Bun.spawnSync(["ps", "-eo", "psr,pcpu,pid,comm", "--sort=-pcpu", "--no-headers"]).stdout.toString().split("\n");
  return listed.map(line => line.trim().split(/\s+/)).filter(fields => Number(fields[0]) === core).slice(0, 2).map(fields => `${fields[3]} (${fields[2]})`).join(", ") || "nobody who is still there";
}

function processTicks(pid: number): number {
  const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
  return Number(fields[11]) + Number(fields[12]);
}

function kilobytes(text: string, key: string): number {
  return Number(new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(text)?.[1] ?? 0);
}

async function* linesOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let pending = "";
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      yield pending.slice(0, end);
      pending = pending.slice(end + 1);
    }
  }
}

interface Start {
  answer: string;
  bytes: number;
  guests: number;
  millisecondsATurn: number;
  firstTurnMilliseconds: number;
  instructionsATurn: number;
  cyclesATurn: number;
  cpuMillisecondsATurn: number;
  peakRssMB: number;
  privateDirtyMB: number;
}

async function start(row: Row, workload: string[], column: Column, core: number): Promise<Start> {
  const scratch = join(options.work!, `lane-${core}`);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const control = join(scratch, "control");
  const acknowledged = join(scratch, "acknowledged");
  Bun.spawnSync(["mkfifo", control, acknowledged]);
  const controlFile = openSync(control, "r+");
  const acknowledgedFile = openSync(acknowledged, "r+");
  const tell = (word: string) => {
    writeSync(controlFile, `${word}\n`);
    readSync(acknowledgedFile, new Uint8Array(16));
  };

  const counted = join(scratch, "counted");
  const child = Bun.spawn(
    [
      "perf", "stat", "-x,", "-o", counted, "-D", "-1", "--control", `fifo:${control},${acknowledged}`,
      "-e", "instructions:u,cycles:u,task-clock",
      "--", "taskset", "-c", String(core), executableOf(row, column), ...workload,
      options["warm-up-milliseconds"]!, options["warm-up-turns"]!, options.windows!, options["window-milliseconds"]!,
    ],
    { cwd: scratch, env: { ...environment, WTF_numberOfProcessorCores: "1" }, stdin: "pipe", stdout: "pipe", stderr: Bun.file(join(scratch, "errors")) },
  );
  const lines = linesOf(child.stdout);
  const next = async () => {
    const line = await lines.next();
    if (line.done) throw new Error(`${row.name} ${workload.join(" ")} ${column.name}: it ended early (${await child.exited})`);
    return JSON.parse(line.value);
  };

  const { pid } = await next();
  tell("enable");
  const ticksBefore = [busyTicks(core), processTicks(pid)];
  const began = Bun.nanoseconds();
  child.stdin.write("go\n");
  child.stdin.flush();
  const result = await next();
  const elapsedTicks = ((Bun.nanoseconds() - began) / 1e9) * 100;
  const guests = Math.max(0, (busyTicks(core) - ticksBefore[0] - (processTicks(pid) - ticksBefore[1])) / elapsedTicks);
  tell("disable");

  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
  child.stdin.write("end\n");
  child.stdin.end();
  await child.exited;
  closeSync(controlFile);
  closeSync(acknowledgedFile);

  if (result.answer !== result.lastAnswer) throw new Error(`${row.name} ${workload.join(" ")} ${column.name}: the last answer is not the first`);
  const counts = Object.fromEntries(
    readFileSync(counted, "utf8").split("\n").filter(line => line.includes(",")).map(line => [line.split(",")[2].split(":")[0], Number(line.split(",")[0])]),
  );
  return {
    answer: result.answer,
    bytes: result.bytes,
    guests,
    millisecondsATurn: result.millisecondsATurn.reduce((sum: number, each: number) => sum + each, 0) / result.millisecondsATurn.length,
    firstTurnMilliseconds: result.firstTurnMilliseconds,
    instructionsATurn: counts["instructions"] / result.turns,
    cyclesATurn: counts["cycles"] / result.turns,
    cpuMillisecondsATurn: counts["task-clock"] / result.turns,
    peakRssMB: kilobytes(status, "VmHWM") / 1024,
    privateDirtyMB: kilobytes(rollup, "Private_Dirty") / 1024,
  };
}

async function measure(row: Row, workload: { name: string; arguments: string[] }, chosen: Column[], core: number): Promise<Cell[]> {
  const starts = new Map<string, Start[]>(chosen.map(column => [column.name, []]));
  const failed = new Set<string>();
  for (let round = 0; round < Number(options.starts); round++) {
    for (let index = 0; index < chosen.length; index++) {
      const column = chosen[(index + round) % chosen.length];
      if (failed.has(column.name)) continue;
      try {
        let one = await start(row, workload.arguments, column, core);
        for (let again = 0; again < 3 && one.guests > 0.01; again++) {
          console.error(`${row.name} ${workload.name} ${column.name}: ${(one.guests * 100).toFixed(0)}% of core ${core} went to ${busiestOn(core)}: once more`);
          one = await start(row, workload.arguments, column, core);
        }
        starts.get(column.name)!.push(one);
      } catch (error) {
        failed.add(column.name);
        console.error(String(error));
      }
    }
  }
  return chosen.flatMap(column => {
    const all = starts.get(column.name)!;
    if (failed.has(column.name)) return { row: row.name, workload: workload.name, column: column.name, failed: true } as Cell;
    const clean = all.filter(each => each.guests <= 0.01);
    const kept = clean.length ? clean : all;
    const executable = executableOf(row, column);
    const times = kept.map(each => each.millisecondsATurn);
    return {
      row: row.name,
      workload: workload.name,
      column: column.name,
      starts: kept.length,
      void: clean.length < Math.min(3, all.length),
      guests: Math.max(...all.map(each => each.guests)),
      answer: all[0].answer,
      bytes: all[0].bytes,
      millisecondsATurn: median(times),
      spread: (Math.max(...times) - Math.min(...times)) / median(times),
      firstTurnMilliseconds: median(kept.map(each => each.firstTurnMilliseconds)),
      instructionsATurn: median(all.map(each => each.instructionsATurn)),
      cyclesATurn: median(kept.map(each => each.cyclesATurn)),
      cpuMillisecondsATurn: median(kept.map(each => each.cpuMillisecondsATurn)),
      peakRssMB: median(all.map(each => each.peakRssMB)),
      privateDirtyMB: median(all.map(each => each.privateDirtyMB)),
      executableBytes: statSync(executable).size,
      codeBytes: codeBytesOf(executable),
      accesses: /^Dependencies: (.*)$/m.exec(readFileSync(`${executable}.build.txt`, "utf8"))?.[1] ?? null,
    };
  });
}

function against(value: number, base: number): string {
  const change = (value / base - 1) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function printTable(cells: Cell[]): void {
  const groups = Map.groupBy(cells, cell => `${cell.row} ${cell.workload}`);
  for (const [name, group] of groups) {
    const base = group[0];
    const wrong = group.filter(cell => !cell.failed && cell.answer !== base.answer).map(cell => cell.column);
    console.log(`\n### ${name} (${base.bytes} bytes an answer)\n`);
    console.log(`| column | ms a turn | | instructions a turn | | cycles a turn | first turn ms | peak RSS MB | private dirty MB | code B | executable B | |`);
    console.log(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const cell of group) {
      if (cell.failed) {
        console.log(`| ${cell.column} | VOID: IT DID NOT FINISH |`);
        continue;
      }
      const remarks = [cell.void ? "VOID: guests on its core" : "", wrong.includes(cell.column) ? "VOID: ANOTHER ANSWER" : "", cell.spread > 0.03 ? `starts ${(cell.spread * 100).toFixed(0)}% apart` : ""];
      console.log(
        `| ${cell.column} | ${cell.millisecondsATurn.toPrecision(4)} | ${against(cell.millisecondsATurn, base.millisecondsATurn)} | ${Math.round(cell.instructionsATurn).toLocaleString("en-US")} | ${against(cell.instructionsATurn, base.instructionsATurn)} | ${Math.round(cell.cyclesATurn).toLocaleString("en-US")} | ${cell.firstTurnMilliseconds.toPrecision(3)} | ${cell.peakRssMB.toFixed(1)} | ${cell.privateDirtyMB.toFixed(1)} | ${cell.codeBytes?.toLocaleString("en-US") ?? "-"} | ${cell.executableBytes.toLocaleString("en-US")} | ${remarks.filter(Boolean).join("; ")} |`,
      );
    }
  }
}

if (options.table) {
  printTable(readFileSync(options.table, "utf8").trim().split("\n").map(line => JSON.parse(line)));
  process.exit(0);
}

if (!options.bun || !options.work) throw new Error("--bun and --work are needed; see README.md");
options.work = resolve(options.work);
const chosenRows = selected(rows, options.rows);
const columnsOf = (row: Row) => selected(columns, options.columns).filter(column => bunOf(column) && (!column.typed || hasTypes(row)) && (!column.only || column.only(row)));

if (!options["no-build"]) {
  for (const row of chosenRows) {
    const libraries = new Map((row.libraries ?? []).map(library => [library.name, buildLibrary(row, library)]));
    const folders = Object.fromEntries((["as-installed", "rebuilt", "typed"] as const).map(variant => [variant, layFolder(row, variant, libraries)]));
    for (const column of columnsOf(row)) build(row, column, folders);
  }
}

if (!options["build-only"]) {
  const jobs = chosenRows.flatMap(row => row.workloads.map(workload => ({ row, workload })));
  const cells: Cell[][] = new Array(jobs.length);
  let taken = 0;
  await Promise.all(
    parseCores(options.cores!).map(async core => {
      while (taken < jobs.length) {
        const index = taken++;
        cells[index] = await measure(jobs[index].row, jobs[index].workload, columnsOf(jobs[index].row), core);
        console.error(`measured ${jobs[index].row.name} ${jobs[index].workload.name} on core ${core}`);
      }
    }),
  );
  const all = cells.flat();
  if (options.out) writeFileSync(options.out, all.map(cell => JSON.stringify(cell)).join("\n") + "\n");
  printTable(all);
}
