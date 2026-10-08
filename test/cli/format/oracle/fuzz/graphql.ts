// GraphQL documents with a comment in every gap between tokens, with random ranges, with other options and line endings, or with a token
// taken out, doubled or replaced, where what is rejected has to be the same too.
//
//   bun graphql.ts <bun-lint> <directory with node_modules/prettier> -mode=comments|ranges|options|mutate [-n=40] [-show=5] <files and directories..>
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const [bin, prettierRoot, ...args] = process.argv.slice(2);
const prettier = await import(join(resolve(prettierRoot), "node_modules/prettier/index.mjs"));
const flag = (name: string, otherwise: string) => (args.find(it => it.startsWith(`-${name}=`)) ?? `-${name}=${otherwise}`).slice(name.length + 2);
const [mode, count, show] = [flag("mode", "comments"), +flag("n", "40"), +flag("show", "5")];

const files: string[] = [];
(function walk(paths: string[]) {
  for (const path of paths) {
    if (statSync(path).isDirectory()) walk(readdirSync(path).filter(it => it !== "__snapshots__" && it !== "_errors_").map(it => join(path, it)));
    else if (/\.(graphql|gql)$/.test(path)) files.push(path);
  }
})(args.filter(it => !it.startsWith("-")));

let seed = 12345;
const random = (below: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 8) % below;
const input = join(mkdtempSync(join(tmpdir(), "graphql-fuzz-")), "input.graphql");
let [same, total, shown] = [0, 0, 0];
async function check(text: string, options: Record<string, unknown>, what: string) {
  const expected: string | null = await prettier.format(text, { parser: "graphql", ...options }).catch(() => null);
  writeFileSync(input, text);
  const result = Bun.spawnSync([bin, "format", "file", input, ...Object.entries(options).map(([key, value]) => `--${key}=${value}`)]);
  const actual = result.exitCode === 0 && result.stdout.toString() !== "SyntaxError\n" ? result.stdout.toString() : null;
  total++;
  if (actual === expected) same++;
  else if (shown++ < show) console.log(`##### ${what} ${JSON.stringify(options)}\n--- input\n${text}\n--- expected\n${expected}\n--- actual\n${actual}`);
}

const tokens = (text: string) => [...text.matchAll(/"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|#[^\n]*|[A-Za-z_0-9]+|\.\.\.|[^\s]/g)].map(it => [it.index, it.index + it[0].length]);
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (mode === "comments") {
    const gaps = tokens(text).flat();
    for (const at of gaps.length <= count ? gaps : Array.from({ length: count }, () => gaps[random(gaps.length)])) {
      if (/#[^\n]*$/.test(text.slice(0, at))) continue;
      for (const comment of ["# c\n", " # c\n", "\n# c\n", "\n\n# c\n\n", "# prettier-ignore\n"]) {
        await check(text.slice(0, at) + comment + text.slice(at), {}, `${file} @${at} ${JSON.stringify(comment)}`);
      }
    }
  } else if (mode === "ranges") {
    for (let i = 0; i < count; i++) {
      const [a, b] = [random(text.length + 1), random(text.length + 1)];
      await check(text, { rangeStart: Math.min(a, b), rangeEnd: Math.max(a, b) }, file);
    }
  } else if (mode === "options") {
    const sets = [{ printWidth: 40 }, { printWidth: 20 }, { printWidth: 1 }, { bracketSpacing: false }, { useTabs: true }, { tabWidth: 4, printWidth: 30 }, { endOfLine: "crlf" }];
    for (const options of sets) await check(text, options, file);
    await check(text.replaceAll("\n", "\r\n"), { endOfLine: "auto" }, `${file} CRLF`);
    await check(text.replaceAll("\n", "\r"), {}, `${file} CR`);
    await check("﻿" + text, {}, `${file} BOM`);
    await check(text.replace(/\s+/g, " "), {}, `${file} on one line`);
    await check(text.replace(/[ \t]+/g, "\n\n"), {}, `${file} on many lines`);
  } else {
    const all = tokens(text);
    for (let i = 0; i < count && all.length > 1; i++) {
      const [[a, b], [c, d], kind] = [all[random(all.length)], all[random(all.length)], random(3)];
      const middle = kind === 0 ? "" : kind === 1 ? `${text.slice(a, b)} ${text.slice(a, b)}` : text.slice(c, d);
      await check(text.slice(0, a) + middle + text.slice(b), {}, `${file} change ${kind}`);
    }
  }
}
console.log(`${same}/${total} the same`);
