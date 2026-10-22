// Regenerates test/cli/format/tailwind/cases.json and order.json: oxfmt's output for the inputs in cases.json with the
// real Tailwind CSS, and Tailwind's order for each class that oxfmt looks up.
//
//   bun make-fixtures.ts <directory with node_modules/oxfmt> <directory with node_modules/tailwindcss, version 4>
//
// The inputs come from oxfmt's apps/oxfmt/test/api/sort_tailwindcss.test.ts (MIT), plus some more.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Case = {
  name: string;
  filename: string;
  options: Record<string, unknown>;
  input: string;
  output: string;
  todo?: string;
};
const [oxfmt, tailwind] = process.argv.slice(2).map(it => resolve(it));
const target = join(import.meta.dir, "../../tailwind");
const cases: Case[] = JSON.parse(readFileSync(join(target, "cases.json"), "utf8"));
const real = join(tailwind, "node_modules/tailwindcss");

const root = mkdtempSync(join(tmpdir(), "tailwind-fixtures-"));
try {
  // A wrapper that replaces the package and logs every class it's asked about.
  const lookups = join(root, "asked.txt");
  const wrapper = join(root, "node_modules/tailwindcss");
  mkdirSync(wrapper, { recursive: true });
  cpSync(join(real, "theme.css"), join(wrapper, "theme.css"));
  writeFileSync(
    join(wrapper, "package.json"),
    JSON.stringify({ name: "tailwindcss", version: "4.0.0", main: "index.mjs" }),
  );
  writeFileSync(
    join(wrapper, "index.mjs"),
    `import { appendFileSync } from "node:fs";
import * as real from ${JSON.stringify(pathToFileURL(join(real, "dist/lib.mjs")).href)};
export async function __unstable__loadDesignSystem(...args) {
  const design = await real.__unstable__loadDesignSystem(...args);
  return { getClassOrder(classes) { appendFileSync(${JSON.stringify(lookups)}, classes.join("\\n") + "\\n"); return design.getClassOrder(classes); } };
}
`,
  );
  writeFileSync(lookups, "");
  for (const [index, it] of cases.entries()) {
    const file = join(root, String(index), it.filename);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, it.input);
    writeFileSync(join(root, String(index), ".oxfmtrc.json"), JSON.stringify(it.options));
    const done = spawnSync(join(oxfmt, "node_modules/.bin/oxfmt"), ["--threads=1", it.filename], {
      cwd: join(root, String(index)),
    });
    if (done.status !== 0) throw new Error(`${it.name}: ${done.stderr}${done.stdout}`);
    it.output = readFileSync(file, "utf8");
  }
  const classes = [...new Set(readFileSync(lookups, "utf8").split("\n"))].sort();
  const { __unstable__loadDesignSystem } = await import(pathToFileURL(join(real, "dist/lib.mjs")).href);
  const design = await __unstable__loadDesignSystem(readFileSync(join(real, "theme.css"), "utf8"), { base: real });
  const known = (design.getClassOrder(classes) as [string, bigint | null][]).filter(it => it[1] !== null);
  known.sort((a, z) => (a[1]! < z[1]! ? -1 : 1));
  writeFileSync(
    join(target, "order.json"),
    JSON.stringify(
      known.map(it => it[0]),
      null,
      1,
    ) + "\n",
  );
  writeFileSync(join(target, "cases.json"), JSON.stringify(cases, null, 1) + "\n");
  console.log(`${cases.length} cases, ${known.length} classes that Tailwind knows`);
} finally {
  rmSync(root, { recursive: true });
}
