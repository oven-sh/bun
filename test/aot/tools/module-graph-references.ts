// bun test/aot/tools/module-graph-references.ts <table> [<a plain Bun>]
// Prints the lines of ../module-graphs.expected.txt for a table that is held to Node.js and `bun build --compile` alone: the cells on which the two print the same.
// An ES module has no `require` in Node.js: there each file that names it begins with createRequire().
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cellsOf, programOf, type Table } from "../harness/module-graphs";

const [table, plain = process.execPath] = process.argv.slice(2) as [Table, string?];
const makesRequire = `import { createRequire as makeRequire } from "node:module"; const require = makeRequire(import.meta.url);\n`;
const linesOf = (command: string[], cwd: string) => {
  const { stdout, exitCode } = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "inherit" });
  if (exitCode) throw new Error(`${command.join(" ")}: exit code ${exitCode}`);
  const lines = stdout.toString().split("\n");
  return new Map(lines.filter(line => line.includes(" :")).map(line => [line.slice(0, line.indexOf(" ")), line]));
};

const cells = cellsOf(table);
for (let first = 0; first < cells.length; first += 1000) {
  const program = cells.slice(first, first + 1000);
  const { entry, files } = programOf(table, program);
  const root = mkdtempSync(join(tmpdir(), "module-graph-references-"));
  for (const [name, text] of Object.entries(files)) {
    for (const [folder, head] of [
      ["compiled", ""],
      ["node", name.endsWith(".mjs") && text.includes("require(") ? makesRequire : ""],
    ]) {
      mkdirSync(dirname(join(root, folder, name)), { recursive: true });
      writeFileSync(join(root, folder, name), head + text);
    }
  }
  linesOf([plain, "build", "--compile", `./${entry}`, "--outfile", "plain.exe"], join(root, "compiled"));
  const compiled = linesOf([join(root, "compiled", "plain.exe")], join(root, "compiled"));
  const node = linesOf(["node", entry], join(root, "node"));
  for (const { id } of program) if (compiled.has(id) && compiled.get(id) === node.get(id)) console.log(compiled.get(id));
  rmSync(root, { recursive: true, force: true });
}
