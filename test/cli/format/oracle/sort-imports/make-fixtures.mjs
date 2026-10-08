// Makes test/cli/format/sort-imports/*.json of the cases that fixtures.mjs, fuzz.mjs and oxfmt.mjs make.
//
//   node make-fixtures.mjs --out=<directory> --sample=150 <cases.json..>
//
// All cases of the tools' own tests are taken, and of the others (`fuzz/..`) every n-th, so that `--sample` are left of
// each file. Left out: what the tool itself fails on, and syntax that bun format does not read.
import fs from "node:fs";
import path from "node:path";
import { flags } from "./oracle.mjs";

const { named, positional } = flags(process.argv.slice(2));
const UNSUPPORTED = [
  // Flow
  /^tests\/Flow\//,
  // `assert { type: "json" }`, which TypeScript does not take any more
  /imports-with-assertions/,
];
const byPlugin = {};
for (const file of positional) {
  const cases = JSON.parse(fs.readFileSync(file, "utf8")).filter(it => !it.error && it.output !== undefined);
  const isSampled = cases.every(it => it.name.startsWith("fuzz/"));
  const step = isSampled ? Math.max(1, Math.floor(cases.length / Number(named.sample ?? 150))) : 1;
  for (const [index, it] of cases.entries()) {
    if (index % step !== 0 || UNSUPPORTED.some(pattern => pattern.test(it.name)) || /\bassert\s*\{/.test(it.input)) continue;
    const { parser, flavor, ...options } = it.options;
    const name = isSampled ? `${path.basename(file, ".json")}/${it.name.slice(5)}` : it.name;
    (byPlugin[it.plugin] ??= []).push({ name, filename: it.filename, options, input: it.input, output: it.output });
  }
}
for (const [plugin, cases] of Object.entries(byPlugin)) {
  fs.writeFileSync(path.join(named.out, `${plugin}.json`), JSON.stringify(cases, null, 1) + "\n");
  console.log(`${plugin}: ${cases.length} cases`);
}
