// What the rules of the React Compiler cost in ESLint: the same directories with the rules of eslint-plugin-react-hooks on and off.
//
//   bun cost-eslint.ts --modules=<node_modules> --work=<dir> [--rounds=3] [--node=node] <directory>..
//
// <node_modules> has eslint, eslint-plugin-react-hooks and @typescript-eslint/parser. Two configurations, with no other rule:
//   all on    all rules of the plugin but `rules-of-hooks` and `exhaustive-deps` are errors
//   all off   the same rules are off: what is left is ESLint, the parsers and the scopes
// ESLint lints only what is below its working directory, so that is the directory that is measured. Nothing of it but the files
// that are linted is read: the configuration is given with `-c`, and is in <work>. Needs Linux's `perf` and GNU `time`. The runs
// take turns; each number is the smallest of the rounds.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { options, table } from "./shared.ts";

const { flags, rest } = options(process.argv.slice(2));
if (rest.length === 0 || !flags.has("work") || !flags.has("modules")) {
  throw new Error("usage: bun cost-eslint.ts --modules=<node_modules> --work=<dir> <directory>..");
}
const modules = resolve(flags.get("modules")!);
const work = resolve(flags.get("work")!);
const rounds = Number(flags.get("rounds") ?? 3);
const node = flags.get("node") ?? "node";
mkdirSync(work, { recursive: true });

const configPath = (name: string) => join(work, `cost-eslint.${name.replaceAll(" ", "-")}.mjs`);
for (const [name, severity] of [
  ["all on", "error"],
  ["all off", "off"],
]) {
  writeFileSync(
    configPath(name),
    `import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(join(modules, "x.js"))});
const plugin = require("eslint-plugin-react-hooks");
const names = Object.keys(plugin.rules).filter(rule => rule !== "rules-of-hooks" && rule !== "exhaustive-deps");
export default [
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    plugins: { "react-hooks": plugin },
    rules: Object.fromEntries(names.map(rule => ["react-hooks/" + rule, ${JSON.stringify(severity)}])),
    languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  { files: ["**/*.{ts,tsx}"], languageOptions: { parser: require("@typescript-eslint/parser") } },
];
`,
  );
}

type Cell = {
  directory: string;
  config: string;
  files: number;
  messages: number;
  instructions: number;
  cpu: number;
  wall: number;
  rss: number;
};
const cells: Cell[] = rest.flatMap(path =>
  ["all on", "all off"].map(config => ({
    directory: resolve(path),
    config,
    files: 0,
    messages: 0,
    instructions: Infinity,
    cpu: Infinity,
    wall: Infinity,
    rss: Infinity,
  })),
);
const byRule = new Map<string, Map<string, number>>();

const perfOut = join(work, "cost-eslint.perf.txt");
const timeOut = join(work, "cost-eslint.time.txt");
for (let round = 0; round < rounds; round++) {
  for (const cell of cells) {
    const result = Bun.spawnSync({
      cmd: [
        ...["/usr/bin/time", "-f", "%e %M", "-o", timeOut],
        ...["perf", "stat", "-x,", "-e", "instructions:u,task-clock", "-o", perfOut, "--"],
        ...[node, join(modules, "eslint", "bin", "eslint.js"), "-c", configPath(cell.config), "-f", "json", "."],
      ],
      cwd: cell.directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = result.stdout.toString();
    if (!stdout.startsWith("[")) throw new Error(`exit ${result.exitCode}: ${result.stderr.toString().slice(0, 1000)}`);
    if (round === 0) {
      const report = JSON.parse(stdout) as { messages: { ruleId: string | null }[] }[];
      cell.files = report.length;
      for (const { messages } of report) {
        for (const { ruleId } of messages) {
          if (ruleId?.startsWith("react-hooks/") !== true) continue;
          cell.messages++;
          if (!byRule.has(ruleId)) byRule.set(ruleId, new Map());
          const counts = byRule.get(ruleId)!;
          counts.set(cell.directory, (counts.get(cell.directory) ?? 0) + 1);
        }
      }
    }
    for (const line of readFileSync(perfOut, "utf8").split("\n")) {
      const fields = line.split(",");
      if (fields[2]?.startsWith("instructions")) cell.instructions = Math.min(cell.instructions, Number(fields[0]));
      if (fields[2]?.startsWith("task-clock")) cell.cpu = Math.min(cell.cpu, Number(fields[0]));
    }
    const [wall, rss] = readFileSync(timeOut, "utf8").trim().split("\n").at(-1)!.split(" ").map(Number);
    cell.wall = Math.min(cell.wall, wall * 1000);
    cell.rss = Math.min(cell.rss, rss / 1024);
  }
}

const name = (directory: string) => directory.split("/").slice(-3).join("/");
console.log(
  table(
    ["Directory", "The rules", "Files", "Messages", "Instructions (millions)", "CPU (ms)", "Wall (ms)", "Max RSS (MB)"],
    cells.map(cell => [
      name(cell.directory),
      cell.config,
      cell.files,
      cell.messages,
      Math.round(cell.instructions / 1e6),
      Math.round(cell.cpu),
      Math.round(cell.wall),
      Math.round(cell.rss),
    ]),
  ),
);
console.log();
const directories = [...new Set(cells.map(cell => cell.directory))];
console.log(
  table(
    ["Directory", "Instructions, on / off", "CPU, on / off", "Instructions of the rules for each file (thousands)"],
    directories.map(directory => {
      const [on, off] = ["all on", "all off"].map(
        config => cells.find(cell => cell.directory === directory && cell.config === config)!,
      );
      return [
        name(directory),
        (on.instructions / off.instructions).toFixed(2),
        (on.cpu / off.cpu).toFixed(2),
        Math.round((on.instructions - off.instructions) / on.files / 1000),
      ];
    }),
  ),
);
console.log();
console.log(
  table(
    ["Rule", ...directories.map(name)],
    [...byRule]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([rule, counts]) => [rule, ...directories.map(directory => counts.get(directory) ?? 0)]),
  ),
);
