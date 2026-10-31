// Regenerates test/cli/format/svelte/cases.json: the output of Prettier with prettier-plugin-svelte, and of oxfmt, for
// its inputs.
//
//   bun make-fixtures.ts <directory with node_modules/prettier, prettier-plugin-svelte 4.1.1 and svelte> <directory with node_modules/oxfmt>
//
// A case without `prettier` makes the plugin throw. A case without `oxfmt` is rejected by oxfmt.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { forOxfmt } from "../../svelte/for-oxfmt";

type Case = { name: string; options: Record<string, unknown>; input: string; prettier?: string; oxfmt?: string };
const [withPrettier, withOxfmt] = process.argv.slice(2).map(it => resolve(it));
const target = process.env.CASES ?? join(import.meta.dir, "../../svelte/cases.json");
const cases: Case[] = JSON.parse(readFileSync(target, "utf8"));
const require = createRequire(withPrettier + "/");
const prettier = require("prettier");
const plugin = require("prettier-plugin-svelte");
console.error = () => {};

// The plugin leaks two pieces of state into the next file in the same process: its `trim` can empty the array that is
// Prettier's `literalline`, and with `svelteSortOrder: "none"` it doesn't reset the flag that
// `<!-- prettier-ignore -->` sets.
const literalline = prettier.doc.builders.literalline;
const whole = [...literalline];
for (const it of cases) {
  delete it.prettier;
  await prettier.format("<p></p>", { parser: "svelte", plugins: [plugin] });
  try {
    it.prettier = await prettier.format(it.input, { ...it.options, parser: "svelte", plugins: [plugin] });
  } catch {}
  if (literalline.length !== whole.length) {
    literalline.length = 0;
    literalline.push(...whole);
    throw new Error(`${it.name}: the plugin damages Prettier. This is no case.`);
  }
}

for (const [options, group] of Map.groupBy(cases, it => JSON.stringify(it.options))) {
  const root = mkdtempSync(join(tmpdir(), "svelte-fixtures-"));
  try {
    writeFileSync(join(root, ".oxfmtrc.json"), JSON.stringify(forOxfmt(JSON.parse(options))));
    mkdirSync(join(root, "src"));
    for (const [index, it] of group.entries()) writeFileSync(join(root, "src", `${index}.svelte`), it.input);
    // One process for all files, except with `"none"`: see above.
    const names = group.map((_, index) => `src/${index}.svelte`);
    const runs = JSON.parse(options).svelteSortOrder === "none" ? names.map(it => [it]) : [names];
    let log = "";
    for (const run of runs) {
      const done = spawnSync(join(withOxfmt, "node_modules/.bin/oxfmt"), ["--threads=1", ...run], {
        cwd: root,
        env: { ...process.env, NODE_PATH: join(withPrettier, "node_modules") },
      });
      log += `${done.stdout}${done.stderr}`;
      if (done.status !== 0 && done.status !== 2) throw new Error(`oxfmt: ${done.status} ${done.signal} ${log}`);
    }
    for (const [index, it] of group.entries()) {
      delete it.oxfmt;
      if (!new RegExp(`\\b${index}\\.svelte\\b`).test(log)) it.oxfmt = readFileSync(join(root, names[index]), "utf8");
    }
  } finally {
    rmSync(root, { recursive: true });
  }
}
writeFileSync(target, JSON.stringify(cases, null, 1) + "\n");
