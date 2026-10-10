// What the rules of the React Compiler cost in oxlint: the same directories with the rules on and off.
//
//   bun cost.ts --oxlint=<path> --work=<dir> [--rounds=5] [--threads=1,default] <directory>..
//
// Three configurations with `plugins: ["react"]` and the categories as they are by default:
//   all on      the 22 rules are errors
//   by default  nothing said about them: the 12 that are in `correctness` run
//   all off     the 22 rules are off; the other rules of the plugin run as by default
// The directories are only read: the configurations are in <work>, which is also the working directory. Needs Linux's `perf`
// and GNU `time`. The runs take turns; each number is the smallest of the rounds.
//
// `--oxlint` may be a command that takes oxlint's arguments: --oxlint="/path/to/tool subcommand".

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { byFile, options, oxlint, oxlintBinary, RULE_NAMES, table } from "./shared.ts";

const { flags, rest } = options(process.argv.slice(2));
if (rest.length === 0 || !flags.has("work"))
  throw new Error("usage: bun cost.ts --oxlint=<path> --work=<dir> <directory>..");
const command = oxlintBinary(flags);
const work = resolve(flags.get("work")!);
const rounds = Number(flags.get("rounds") ?? 5);
const threadCounts = (flags.get("threads") ?? "1,default").split(",");
mkdirSync(work, { recursive: true });

const configs = [
  ["all on", { plugins: ["react"], rules: Object.fromEntries(RULE_NAMES.map(rule => [rule, "error"])) }],
  ["by default", { plugins: ["react"] }],
  ["all off", { plugins: ["react"], rules: Object.fromEntries(RULE_NAMES.map(rule => [rule, "off"])) }],
] as const;
const configPath = (name: string) => join(work, `cost.${name.replaceAll(" ", "-")}.json`);
for (const [name, config] of configs) writeFileSync(configPath(name), JSON.stringify(config, null, 2) + "\n");

type Cell = {
  directory: string;
  config: string;
  threads: string;
  files: number;
  diagnostics: number;
  ofTheRules: number;
  instructions: number;
  cpu: number;
  wall: number;
  rss: number;
};

const argsOf = (cell: Pick<Cell, "directory" | "config" | "threads">) => [
  "-c",
  configPath(cell.config),
  ...(cell.threads === "default" ? [] : [`--threads=${cell.threads}`]),
  cell.directory,
];

const cells: Cell[] = [];
const byRule = new Map<string, Map<string, number>>();
for (const directory of rest.map(path => resolve(path))) {
  for (const [config] of configs) {
    // What is reported does not depend on the threads: one run that is not measured.
    const { report } = oxlint(command, work, argsOf({ directory, config, threads: threadCounts[0] }));
    let ofTheRules = 0;
    for (const found of byFile(report).values()) {
      for (const diagnostic of found) {
        if (diagnostic.rule === null || !RULE_NAMES.includes(diagnostic.rule)) continue;
        ofTheRules++;
        if (config !== "all on") continue;
        let counts = byRule.get(diagnostic.rule);
        if (counts === undefined) byRule.set(diagnostic.rule, (counts = new Map()));
        counts.set(directory, (counts.get(directory) ?? 0) + 1);
      }
    }
    for (const threads of threadCounts) {
      cells.push({
        directory,
        config,
        threads,
        files: report.number_of_files,
        diagnostics: report.diagnostics.length,
        ofTheRules,
        instructions: Infinity,
        cpu: Infinity,
        wall: Infinity,
        rss: Infinity,
      });
    }
  }
}

const perfOut = join(work, "cost.perf.txt");
const timeOut = join(work, "cost.time.txt");
for (let round = 0; round < rounds; round++) {
  for (const cell of cells) {
    const result = Bun.spawnSync({
      cmd: [
        ...["/usr/bin/time", "-f", "%e %M", "-o", timeOut],
        ...["perf", "stat", "-x,", "-e", "instructions:u,task-clock", "-o", perfOut, "--"],
        ...command.split(" "),
        ...["-f", "json"],
        ...argsOf(cell),
      ],
      cwd: work,
      stdout: "pipe",
      stderr: "pipe",
    });
    const files = /"number_of_files": *(\d+)/.exec(result.stdout.toString().slice(-400))?.[1];
    if (Number(files) !== cell.files) {
      throw new Error(`exit ${result.exitCode}, ${files} files: ${result.stderr.toString().slice(0, 1000)}`);
    }
    for (const line of readFileSync(perfOut, "utf8").split("\n")) {
      const fields = line.split(",");
      if (fields[2]?.startsWith("instructions")) cell.instructions = Math.min(cell.instructions, Number(fields[0]));
      if (fields[2]?.startsWith("task-clock")) cell.cpu = Math.min(cell.cpu, Number(fields[0]) / 1000);
    }
    const [wall, rss] = readFileSync(timeOut, "utf8").trim().split("\n").at(-1)!.split(" ").map(Number);
    cell.wall = Math.min(cell.wall, wall);
    cell.rss = Math.min(cell.rss, rss / 1024);
  }
}

const name = (directory: string) => directory.split("/").slice(-3).join("/");
console.log(
  table(
    [
      ...["Directory", "The 22 rules", "Threads", "Files", "Diagnostics", "Of the 22 rules"],
      ...["Instructions (millions)", "CPU (ms)", "Wall (ms)", "Max RSS (MB)"],
    ],
    cells.map(cell => [
      name(cell.directory),
      cell.config,
      cell.threads,
      cell.files,
      cell.diagnostics,
      cell.ofTheRules,
      Math.round(cell.instructions / 1e6),
      Math.round(cell.cpu * 1000),
      Math.round(cell.wall * 1000),
      Math.round(cell.rss),
    ]),
  ),
);

const directories = [...new Set(cells.map(cell => cell.directory))];
console.log();
console.log(
  table(
    [
      "Directory",
      "Threads",
      "Instructions, on / off",
      "CPU, on / off",
      "Wall, on / off",
      "Instructions for each file (thousands)",
    ],
    directories.flatMap(directory =>
      threadCounts.map(threads => {
        const find = (config: string) =>
          cells.find(cell => cell.directory === directory && cell.threads === threads && cell.config === config)!;
        const [on, off] = [find("all on"), find("all off")];
        return [
          name(directory),
          threads,
          (on.instructions / off.instructions).toFixed(2),
          (on.cpu / off.cpu).toFixed(2),
          (on.wall / off.wall).toFixed(2),
          Math.round((on.instructions - off.instructions) / on.files / 1000),
        ];
      }),
    ),
  ),
);
console.log();
console.log(
  table(
    ["Rule", ...directories.map(directory => basename(directory))],
    RULE_NAMES.map(rule => [rule, ...directories.map(directory => byRule.get(rule)?.get(directory) ?? 0)]),
  ),
);
