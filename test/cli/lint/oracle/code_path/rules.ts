// Compares all the messages of the rules that are about code paths with those of ESLint itself, on the `.js` files of a
// directory: those that `flows.ts` writes.
//
//   bun rules.ts --bin <bun-lint> --eslint <checkout of eslint> --files <directory> [--count N] [--scratch <dir>]
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { option } from "../tokens/corpus";

const args = process.argv.slice(2);
const [bin, directory] = [option(args, "--bin")!, option(args, "--files")!];
const { Linter } = require(resolve(option(args, "--eslint")!, "lib/api.js"));

const NAMES = [
  "array-callback-return", "consistent-return", "constructor-super", "getter-return", "no-fallthrough",
  "no-this-before-super", "no-unreachable", "no-unreachable-loop", "no-useless-assignment", "no-useless-return",
  "require-atomic-updates",
]; // prettier-ignore
const rules = Object.fromEntries(NAMES.map(name => [name, "error"]));
const config = join(option(args, "--scratch") ?? ".", "rules-config.json");
writeFileSync(config, JSON.stringify({ categories: { correctness: "off" }, rules }));

const files = readdirSync(directory).filter(it => it.endsWith(".js")).sort().slice(0, Number(option(args, "--count") ?? 1e9)); // prettier-ignore
const paths = files.map(it => join(directory, it));
const output = spawnSync(bin, ["cli", "-c", config, "-f", "json", "--no-ignore", ...paths], { maxBuffer: 1 << 30 });
const ours = new Map<string, string[]>(paths.map(it => [it, []]));
for (const it of JSON.parse(output.stdout.toString()).diagnostics) {
  const { line, column } = it.labels[0].span;
  ours.get(it.filename)?.push(`${line}:${column} ${it.code?.replace(/^.*\((.*)\)$/, "$1") ?? "rejected"}`);
}

const linter = new Linter();
const found = new Map<string, string[]>();
let [same, differ, skipped, messages] = [0, 0, 0, 0];
for (const path of paths) {
  const options = { languageOptions: { ecmaVersion: "latest", sourceType: "script" }, rules };
  const theirs: any[] = linter.verify(readFileSync(path, "utf8"), options);
  const actual = ours.get(path)!;
  // The configuration is one of oxlint, which does not have this rule.
  const alone = spawnSync(bin, ["run", "consistent-return", path]).stdout.toString();
  if (theirs.some(it => it.fatal) || actual.some(it => it.endsWith(" rejected")) || alone.includes("the parser rejects")) {
    skipped++;
    continue;
  }
  for (const [, line, column] of alone.matchAll(/:(\d+):(\d+): /g)) actual.push(`${line}:${column} consistent-return`);
  const expected = theirs.map(it => `${it.line}:${it.column} ${it.ruleId}`);
  messages += expected.length;
  const only = [
    ...expected.filter(it => !actual.includes(it)).map(it => ["only ESLint", it]),
    ...actual.filter(it => !expected.includes(it)).map(it => ["only bun", it]),
  ];
  only.length === 0 ? same++ : differ++;
  for (const [who, it] of only) {
    const kind = `${who}: ${it.split(" ")[1]}`;
    found.set(kind, [...(found.get(kind) ?? []), `${path}:${it.split(" ")[0]}`]);
  }
}
for (const [kind, where] of found) console.log(`${where.length} × ${kind}\n    ${where.slice(0, 3).join("\n    ")}`);
console.log(`${same} files the same (${messages} messages), ${differ} differ, ${skipped} that one of the parsers rejects.`);
