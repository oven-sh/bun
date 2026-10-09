// Makes test/cli/format/tailwind/cases.json and order.json again: what oxfmt prints for the inputs in cases.json with the real
// Tailwind CSS, and where that puts each class that it is asked about.
//
//   bun make-fixtures.ts <directory with node_modules/oxfmt> <directory with node_modules/tailwindcss, version 4>
//
// The inputs are those of oxfmt's apps/oxfmt/test/api/sort_tailwindcss.test.ts (MIT) and some more.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Case = { name: string; filename: string; options: object; input: string; output: string; todo?: string };
const [oxfmt, tailwind] = process.argv.slice(2).map(it => resolve(it));
const target = join(import.meta.dir, "../../tailwind");
const cases: Case[] = JSON.parse(readFileSync(join(target, "cases.json"), "utf8"));
const real = join(tailwind, "node_modules/tailwindcss");

const root = mkdtempSync(join(tmpdir(), "tailwind-fixtures-"));
try {
  // In the place of the package: the package, which writes down what it is asked.
  const asked = join(root, "asked.txt");
  const stand = join(root, "node_modules/tailwindcss");
  mkdirSync(stand, { recursive: true });
  cpSync(join(real, "theme.css"), join(stand, "theme.css"));
  writeFileSync(
    join(stand, "package.json"),
    JSON.stringify({ name: "tailwindcss", version: "4.0.0", main: "index.mjs" }),
  );
  writeFileSync(
    join(stand, "index.mjs"),
    `import { appendFileSync } from "node:fs";
import * as real from ${JSON.stringify(pathToFileURL(join(real, "dist/lib.mjs")).href)};
export async function __unstable__loadDesignSystem(...args) {
  const design = await real.__unstable__loadDesignSystem(...args);
  return { getClassOrder(classes) { appendFileSync(${JSON.stringify(asked)}, classes.join("\\n") + "\\n"); return design.getClassOrder(classes); } };
}
`,
  );
  writeFileSync(asked, "");
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
  const classes = [...new Set(readFileSync(asked, "utf8").split("\n"))].sort();
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
