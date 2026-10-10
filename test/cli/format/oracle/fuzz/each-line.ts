// Formats every line of a file on its own. For a list of small programs of which Prettier rejects some: in one file, one rejected line hides
// all the others.
//
//   bun each-line.ts <bun-lint> <directory with node_modules/prettier> <directory for temporary files> <file> [extension, "ts" if left out]
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const [bin, prettierRoot, tmp, file, extension = "ts"] = process.argv.slice(2);
const prettier = await import(resolve(prettierRoot, "node_modules/prettier/index.mjs"));
const path = join(tmp, `line.${extension}`);
let [same, differ, rejected, onlyOursRejects] = [0, 0, 0, 0];
for (const line of (await Bun.file(file).text()).split("\n").filter(Boolean)) {
  const expected: string | null = await prettier.format(line + "\n", { filepath: path }).catch(() => null);
  writeFileSync(path, line + "\n");
  const { stdout, exitCode } = Bun.spawnSync([bin, "format", "file", path]);
  const actual = stdout.toString();
  const failed = exitCode !== 0 || actual.startsWith("SyntaxError");
  if (expected === null) {
    rejected++;
    console.log(`rejected by Prettier${failed ? " and by ours" : ", formatted by ours"}: ${line}`);
  } else if (failed) {
    onlyOursRejects++;
    console.log(`rejected by ours only: ${line}`);
  } else if (actual === expected) {
    same++;
  } else {
    differ++;
    console.log(`differs: ${line}\n  Prettier: ${JSON.stringify(expected.trimEnd())}\n  ours:     ${JSON.stringify(actual.trimEnd())}`);
  }
}
console.log(`${same} same, ${differ} differ, ${rejected} rejected by Prettier, ${onlyOursRejects} rejected by ours only`);
