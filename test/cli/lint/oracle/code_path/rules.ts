// Compares all the messages of the rules that are about code paths with those of ESLint itself, on the `.js` files of a
// directory: those that `flows.ts` writes.
//
//   bun rules.ts --bin <bun-lint> --eslint <checkout of eslint> --files <directory> [--count N] [--scratch <dir>]
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const languageOptions = { ecmaVersion: "latest", sourceType: "script" };
const scratch = resolve(option(args, "--scratch") ?? ".");
const config = join(scratch, "eslint.config.mjs");
mkdirSync(scratch, { recursive: true });
writeFileSync(config, `export default [${JSON.stringify({ languageOptions, rules })}];\n`);

const files = readdirSync(directory).filter(it => it.endsWith(".js")).sort().slice(0, Number(option(args, "--count") ?? 1e9)); // prettier-ignore
const paths = files.map(it => resolve(directory, it));
// With `-c` the working directory is what the patterns of a configuration start from.
const output = spawnSync(bin, ["cli", "-c", config, "-f", "json", ...paths], { cwd: directory, maxBuffer: 1 << 30 });
const ours = new Map<string, string[]>();
for (const { filePath, messages } of JSON.parse(output.stdout.toString())) {
  ours.set(filePath, messages.map((it: any) => `${it.line}:${it.column} ${it.fatal ? "rejected" : it.ruleId}`)); // prettier-ignore
}

const linter = new Linter();
const found = new Map<string, string[]>();
let [same, differ, skipped, messages, own] = [0, 0, 0, 0, 0];
for (const path of paths) {
  const theirs: any[] = linter.verify(readFileSync(path, "utf8"), { languageOptions, rules });
  const actual = ours.get(path);
  if (actual === undefined) throw new Error(`${path} was not linted`);
  if (theirs.some(it => it.fatal) || actual.some(it => it.endsWith(" rejected"))) {
    skipped++;
    continue;
  }
  const expected = theirs.map(it => `${it.line}:${it.column} ${it.ruleId}`);
  messages += expected.length;
  own += actual.length;
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
console.log(`${same} files the same, ${differ} differ, ${skipped} that one of the parsers rejects. ESLint has ${messages} messages, we have ${own}.`);
