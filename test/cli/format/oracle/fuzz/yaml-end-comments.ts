// Makes YAML documents with comments after their last value, at every indentation, and compares what `bun fmt` prints
// for each with what Prettier prints, or oxfmt in its flavor. The documents nest block mappings and sequences, with
// sequences at the column of their key too, explicit keys, keys with a tag or an anchor, every kind of value last, and
// roots that are indented. Which comments belong to the document and which to a node is decided in
// `take_end_comments` and `attach_comment` of `src/format/yaml/ast.rs`.
//
//   bun yaml-end-comments.ts --command="bun fmt" --prettier=<directory with node_modules/prettier>
//     [--oxfmt=<directory with node_modules/.bin/oxfmt>]  use the oxfmt flavor and compare with oxfmt
//     [--count=1000] [--seed=1] [--show=10]
//
// No expected output is stored. The same seed makes the same texts.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const flags = new Map<string, string>();
for (const argument of process.argv.slice(2)) {
  const [, name, value = "true"] = /^--([\w-]+)(?:=(.*))?$/s.exec(argument) ?? [];
  if (!name) throw new Error(`what is ${argument}?`);
  flags.set(name, value);
}
const command = (flags.get("command") ?? "bun fmt").split(" ");
const count = Number(flags.get("count") ?? 1000);
const show = Number(flags.get("show") ?? 10);
const oxfmt = flags.has("oxfmt") ? resolve(flags.get("oxfmt")!, "node_modules/.bin/oxfmt") : null;
const prettier = await import(resolve(flags.get("prettier") ?? ".", "node_modules/prettier/index.mjs"));

let seed = Number(flags.get("seed") ?? 1);
const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = <T>(choices: T[]) => choices[Math.floor(random() * choices.length)];
const chance = (probability: number) => random() < probability;

const blanks = (indent: number) => " ".repeat(indent);
const properties = () => pick(["", "", "", "!!str ", "&n ", "!!str &n ", "&n !!str "]);
const scalar = (indent: number) =>
  pick([
    "1",
    "x",
    '"q"',
    "[1, 2]",
    "{ a: 1 }",
    "*n",
    `|\n${blanks(indent + 2)}text`,
    `>-\n${blanks(indent + 2)}folded`,
    `|\n${blanks(indent + 2)}text\n${blanks(indent + 2)}more`,
  ]);

/** The lines of a mapping whose keys are at `indent`. */
function mapping(indent: number, depth: number): string[] {
  const lines: string[] = [];
  const size = 1 + Math.floor(random() * 2);
  for (let index = 0; index < size; index++) {
    const key = `${properties()}k${index}`;
    const isLast = index === size - 1;
    if (chance(0.15)) {
      // An explicit key, with its value on the next line or with none.
      lines.push(`${blanks(indent)}? ${key}`);
      if (chance(0.7)) lines.push(`${blanks(indent)}: ${scalar(indent)}`);
    } else if (depth > 0 && chance(0.55)) {
      lines.push(`${blanks(indent)}${key}:`);
      lines.push(
        ...(chance(0.4) ? sequence(chance(0.5) ? indent : indent + 2, depth - 1) : mapping(indent + 2, depth - 1)),
      );
    } else if (isLast && chance(0.12)) {
      lines.push(`${blanks(indent)}${key}:`);
    } else {
      lines.push(`${blanks(indent)}${key}: ${scalar(indent)}`);
    }
  }
  return lines;
}

/** The lines of a sequence whose `-` are at `indent`. */
function sequence(indent: number, depth: number): string[] {
  const lines: string[] = [];
  const size = 1 + Math.floor(random() * 2);
  for (let index = 0; index < size; index++) {
    if (depth > 0 && chance(0.5)) {
      const nested = chance(0.3) ? sequence(indent + 2, depth - 1) : mapping(indent + 2, depth - 1);
      lines.push(`${blanks(indent)}- ${nested[0].trimStart()}`, ...nested.slice(1));
    } else if (index === size - 1 && chance(0.1)) {
      lines.push(`${blanks(indent)}-`);
    } else {
      lines.push(`${blanks(indent)}- ${scalar(indent)}`);
    }
  }
  return lines;
}

function document(): string[] {
  const indent = chance(0.1) ? 2 : 0;
  const lines = chance(0.25) ? sequence(indent, 2) : mapping(indent, 2);
  const comments = Math.floor(random() * 4);
  for (let index = 0; index < comments; index++) {
    if (chance(0.2)) lines.push("");
    lines.push(`${blanks(Math.floor(random() * 9))}# c${index}`);
  }
  return lines;
}

function text(): string {
  const lines = document();
  if (chance(0.15)) lines.push("...");
  if (chance(0.1)) lines.push("---", ...document());
  return lines.join("\n") + "\n";
}

function expected(input: string, directory: string): Promise<string | null> {
  if (!oxfmt) return prettier.format(input, { parser: "yaml" }).catch(() => null);
  const result = Bun.spawnSync([oxfmt, "--stdin-filepath=in.yaml"], { cwd: directory, stdin: Buffer.from(input) });
  return Promise.resolve(result.exitCode === 0 ? result.stdout.toString() : null);
}

const directory = mkdtempSync(join(tmpdir(), "yaml-end-comments-"));
if (oxfmt) writeFileSync(join(directory, ".oxfmtrc.json"), "{}\n");
const totals = { same: 0, different: 0, refused: 0, rejected: 0 };
let shown = 0;
for (let index = 0; index < count; index++) {
  const input = text();
  const byTool = await expected(input, directory);
  if (byTool === null) {
    totals.rejected++;
    continue;
  }
  writeFileSync(join(directory, "in.yaml"), input);
  const result = Bun.spawnSync([...command, "in.yaml"], {
    cwd: directory,
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
  });
  if (result.exitCode !== 0) {
    totals.refused++;
    if (shown++ < show)
      console.log(`refused ${JSON.stringify(input)}\n  ${result.stderr.toString().trim().split("\n").pop()}`);
    continue;
  }
  const byBun = readFileSync(join(directory, "in.yaml"), "utf8");
  if (byBun === byTool) {
    totals.same++;
    continue;
  }
  totals.different++;
  if (shown++ < show) {
    console.log(
      `different ${JSON.stringify(input)}\n  ${oxfmt ? "oxfmt" : "prettier"}: ${JSON.stringify(byTool)}\n  bun fmt: ${JSON.stringify(byBun)}`,
    );
  }
}
rmSync(directory, { recursive: true });
console.log(
  `${totals.same} the same, ${totals.different} different, ${totals.refused} refused by bun fmt, ${totals.rejected} rejected by ${oxfmt ? "oxfmt" : "Prettier"}`,
);
