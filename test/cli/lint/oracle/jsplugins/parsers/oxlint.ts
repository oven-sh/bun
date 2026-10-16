// oxlint against `bun lint` on the scripts in `.vue`, `.svelte` and `.astro` files.
//
//     bun oxlint.ts [--show=3] <oxlint> <directory> <pattern> -- <bun lint, as a command>
//
// Both run in `<directory>` with the `.oxlintrc.json` below and `-f json` on the files that match `<pattern>`. Compared for each
// file: the rule, the line and the column of every diagnostic. The texts are ESLint's here, and so is where a diagnostic ends.

import { Glob } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const ours = argv.slice(split + 1);
const flags = argv.slice(0, split).filter(it => it.startsWith("--"));
const [oxlint, directory, pattern] = argv.slice(0, split).filter(it => !it.startsWith("--"));
const show = Number(flags.find(it => it.startsWith("--show="))?.slice(7) ?? "3");

const config = {
  categories: { correctness: "off" },
  rules: {
    "no-var": "error",
    "no-debugger": "error",
    eqeqeq: "error",
    "no-unused-vars": "error",
    "no-unused-labels": "error",
    "no-empty": "error",
    "no-console": "error",
    "prefer-const": "error",
    "no-use-before-define": "error",
    "getter-return": "error",
    "typescript/no-explicit-any": "error",
    "typescript/consistent-type-imports": "error",
    "typescript/no-non-null-assertion": "error",
    "react/rules-of-hooks": "error",
  },
};
const scratch = mkdtempSync(join(tmpdir(), "oxlint-oracle-"));
const configFile = join(scratch, "oxlintrc.json");
writeFileSync(configFile, JSON.stringify(config));

const files = [...new Glob(pattern).scanSync({ cwd: directory })].filter(it => !it.includes("node_modules")).sort();

async function run(cmd: string[]) {
  const byFile = new Map<string, string[]>();
  const started = performance.now();
  // The command line has an end.
  for (let at = 0; at < files.length; at += 500) {
    const child = Bun.spawn({
      cmd: [...cmd, "-c", configFile, "-f", "json", ...files.slice(at, at + 500)],
      cwd: directory,
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, AGENT: "0" },
    });
    const out = await new Response(child.stdout).text();
    await child.exited;
    for (const it of JSON.parse(out.slice(out.indexOf("{"))).diagnostics) {
      const span = it.labels[0]?.span;
      const list = byFile.get(it.filename) ?? [];
      list.push(`${span?.line}:${span?.column} ${it.code ?? it.message}`);
      byFile.set(it.filename, list);
    }
  }
  return { byFile, seconds: ((performance.now() - started) / 1000).toFixed(2) };
}

const [expected, actual] = [await run([oxlint]), await run(ours)];
rmSync(scratch, { recursive: true });
let same = 0;
let shown = 0;
let diagnostics = 0;
for (const file of files) {
  const [a, b] = [(expected.byFile.get(file) ?? []).sort(), (actual.byFile.get(file) ?? []).sort()];
  diagnostics += a.length;
  if (a.join("\n") === b.join("\n")) {
    same++;
    continue;
  }
  if (shown++ >= show) continue;
  console.log(`── ${file}`);
  for (const it of a.filter(it => !b.includes(it)).slice(0, 4)) console.log(`   only oxlint: ${it}`);
  for (const it of b.filter(it => !a.includes(it)).slice(0, 4)) console.log(`   only ours:   ${it}`);
}
console.log(
  `${same} / ${files.length} files identical, ${diagnostics} diagnostics, oxlint ${expected.seconds} s, ours ${actual.seconds} s`,
);
process.exit(same === files.length ? 0 : 1);
