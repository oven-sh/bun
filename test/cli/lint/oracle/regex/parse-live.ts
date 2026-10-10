// Compares `bun-lint regex parse` with @eslint-community/regexpp itself, run from its sources, on the
// patterns of its fixtures and on mutations of them, for every `ecmaVersion`, `strict` and mode.
//
//   bun test/cli/lint/oracle/regex/parse-live.ts <bun-lint> <regexpp checkout> [--mutations=n] [--seed=n]

import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { ask, hex } from "./common.ts";

const [binary, regexpp] = process.argv.slice(2);
const flag = (name: string, fallback: number) =>
  Number(process.argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const mutations = flag("mutations", 20000);
let seed = flag("seed", 1);

const { RegExpParser } = await import(join(regexpp, "src/index.ts"));
const { cloneWithoutCircular } = await import(join(regexpp, "scripts/clone-without-circular.ts"));

function random(n: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
}

function* json(dir: string): Iterable<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) yield* json(join(dir, entry.name));
    else if (entry.name.endsWith(".json")) yield join(dir, entry.name);
  }
}

function relativize(node: any, path: string): any {
  if (Array.isArray(node)) return node.map((child, i) => relativize(child, `${path}/${i}`));
  if (typeof node !== "object" || node === null) return node;
  const relative = (to: unknown): unknown =>
    Array.isArray(to)
      ? to.map(relative)
      : typeof to === "string"
        ? `♻️${posix.relative(path || "/", to || "/").replace(/\/$/u, "")}`
        : to;
  const out: any = {};
  for (const key of Object.keys(node)) {
    out[key] =
      key === "parent" || key === "resolved" || key === "references"
        ? relative(node[key])
        : relativize(node[key], `${path}/${key}`);
  }
  return out;
}

const patterns = new Set<string>();
for (const file of json(join(regexpp, "test/fixtures/parser/literal"))) {
  for (const source of Object.keys(JSON.parse(readFileSync(file, "utf8")).patterns)) {
    const end = source.lastIndexOf("/");
    if (source.startsWith("/") && end > 0) patterns.add(source.slice(1, end));
  }
}

const seeds = [...patterns];
const pieces = [
  ..."()[]{}|^$.*+?\\-&=!<>:,/0123456789abckpPqudDsSwWxiIms_~",
  "(?",
  "(?:",
  "(?=",
  "(?<=",
  "(?<!",
  "(?<a>",
  "(?i:",
  "(?-i:",
  "(?i-m:",
  "\\k<a>",
  "\\p{L}",
  "\\p{Script=Latin}",
  "\\p{RGI_Emoji}",
  "\\q{",
  "&&",
  "--",
  "[^",
  "\\u{",
  "\\u",
  "\\x",
  "\\c",
  "{1,",
  "{2}",
  "\u{1f4a9}",
  "\ud83d",
  "\udca9",
  "é",
  " ",
  "\\1",
  "\\2",
  "\\08",
];
for (let i = 0; i < mutations; i++) {
  let text = seeds[random(seeds.length)];
  for (let n = 1 + random(3); n > 0; n--) {
    const at = random(text.length + 1);
    const piece = pieces[random(pieces.length)];
    switch (random(3)) {
      case 0:
        text = text.slice(0, at) + piece + text.slice(at);
        break;
      case 1:
        text = text.slice(0, at) + text.slice(at + 1 + random(3));
        break;
      default:
        text = text.slice(0, at) + piece + text.slice(at + 1);
    }
  }
  patterns.add(text);
}

const versions = [5, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
let total = 0;
let failed = 0;
for (const ecmaVersion of versions) {
  for (const strict of [false, true]) {
    const parser = new RegExpParser({ ecmaVersion, strict });
    for (const flags of ["", "u", "v", "uv"]) {
      const all = [...patterns];
      const answers = ask(
        binary,
        "parse",
        all.map(source => ["pattern", strict ? "1" : "0", String(ecmaVersion), hex(source), hex(flags)]),
      );
      all.forEach((source, i) => {
        let expected: any;
        try {
          const ast = parser.parsePattern(source, 0, source.length, {
            unicode: flags.includes("u"),
            unicodeSets: flags.includes("v"),
          });
          expected = { ast: JSON.parse(JSON.stringify(cloneWithoutCircular(ast), (_, v) => (v === Infinity ? "$$Infinity" : v))) };
        } catch (error: any) {
          // Not a syntax error: regexpp fails on what it did not expect.
          if (typeof error.index !== "number") return;
          // A lone surrogate cannot be in a message here.
          expected = { error: { message: error.message.toWellFormed(), index: error.index } };
        }
        total++;
        const actual = answers[i]?.ast ? { ast: relativize(answers[i].ast, "") } : answers[i];
        if (Bun.deepEquals(actual, expected, true)) return;
        if (++failed > 30) return;
        console.log(`${JSON.stringify(source)} flags=${flags} ecmaVersion=${ecmaVersion} strict=${strict}`);
        const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
        let at = 0;
        while (at < a.length && a[at] === e[at]) at++;
        console.log(`  actual   ..${a.slice(Math.max(0, at - 60), at + 100)}`);
        console.log(`  expected ..${e.slice(Math.max(0, at - 60), at + 100)}`);
      });
    }
  }
}
console.log(`${total - failed} of ${total} as regexpp`);
process.exit(failed ? 1 : 0);
