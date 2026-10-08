// Makes test/cli/format/sort-imports/*.json of the cases that fixtures.mjs, fuzz.mjs and oxfmt.mjs make.
//
//   node make-fixtures.mjs --out=<directory> --sample=150 --bin=<bun-lint> <cases.json..>
//
// All cases of the tools' own tests are taken, and of the others (`fuzz/..`) every n-th, so that `--sample` are left of
// each file. Left out: what the tool itself fails on, syntax that bun format does not read, and, of the cases for oxfmt,
// those that bun format and oxfmt format differently without sorting imports (`plain`): they are not about imports.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { flags } from "./oracle.mjs";

const { named, positional } = flags(process.argv.slice(2));
const UNSUPPORTED = [
  // Flow
  /^tests\/Flow\//,
  // `assert { type: "json" }`, which TypeScript does not take any more
  /imports-with-assertions/,
];
// `import a // c\n// d\nfrom "a"`: Prettier swaps the two comments, which the check before a file is written refuses.
const REFUSED = /^import \w+ ?\/\/ c\n\/\/ d\n/m;
const byPlugin = {};
for (const file of positional) {
  let cases = JSON.parse(fs.readFileSync(file, "utf8")).filter(it => !it.error && it.output !== undefined);
  if (cases.some(it => it.plain !== undefined)) {
    const plain = cases.flatMap(({ options: { sortImports, ...options }, ...it }) => [
      { ...it, options, output: it.plain },
      { ...it, options, input: it.output },
    ]);
    const temporary = path.join(os.tmpdir(), `plain-${process.pid}.json`);
    fs.writeFileSync(temporary, JSON.stringify(plain));
    const failed = spawnSync(named.bin, ["format", "sort-imports", "cases", temporary], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout;
    fs.rmSync(temporary);
    const differs = new Set([...failed.matchAll(/^FAIL \w+\/(\S+)/gm)].map(match => match[1]));
    cases = cases.filter(it => !differs.has(it.name));
  }
  const isSampled = cases.every(it => it.name.startsWith("fuzz/"));
  const step = isSampled ? Math.max(1, Math.floor(cases.length / Number(named.sample ?? 150))) : 1;
  for (const [index, it] of cases.entries()) {
    if (index % step !== 0 || UNSUPPORTED.some(pattern => pattern.test(it.name)) || /\bassert\s*\{/.test(it.input) || REFUSED.test(it.input)) continue;
    const { parser, flavor, ...options } = it.options;
    // `bun format` refuses the syntax of TypeScript in a JavaScript file, as Prettier does, unless such a parser is asked for.
    if (/\.[cm]?jsx?$/.test(it.filename) && ["typescript", "babel-ts", "flow", "babel-flow"].includes(parser) && /^tests\/(Angular|Typescript)/.test(it.name)) {
      options.overrides = [{ files: "*.js", options: { parser } }];
    }
    const name = isSampled ? `${path.basename(file, ".json")}/${it.name.slice(5)}` : it.name;
    (byPlugin[it.plugin] ??= []).push({ name, filename: it.filename, options, input: it.input, output: it.output });
  }
}
for (const [plugin, cases] of Object.entries(byPlugin)) {
  fs.writeFileSync(path.join(named.out, `${plugin}.json`), JSON.stringify(cases, null, 1) + "\n");
  console.log(`${plugin}: ${cases.length} cases`);
}
