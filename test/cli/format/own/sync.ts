// Writes what Prettier and oxfmt print for the inputs in `cases`, next to them.
//
//   bun test/cli/format/own/sync.ts <directory with node_modules/prettier> <directory with node_modules/.bin/oxfmt>
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { collect } from "../bundle.ts";
import { render, rowsOf, type Options } from "../oxfmt/fixtures.ts";

const [prettierRoot, oxfmtRoot] = process.argv.slice(2);
if (!prettierRoot || !oxfmtRoot) {
  console.error("usage: bun sync.ts <directory with node_modules/prettier> <directory with node_modules/.bin/oxfmt>");
  process.exit(1);
}
const prettier = await import(resolve(prettierRoot, "node_modules/prettier/index.mjs"));
const oxfmt = resolve(oxfmtRoot, "node_modules/.bin/oxfmt");
const files = new Map<string, Uint8Array>();
collect(import.meta.dir, "cases", files, name => name.endsWith(".snap"));

for (const [path, bytes] of files) {
  if (!path.endsWith(".input")) continue;
  const name = path.slice(0, -".input".length);
  const [asPrettier, asOxfmt]: [Options, string][][] = [[], []];
  for (const options of rowsOf(name, files)) {
    const failure = (error: Error) => `<${error.name}>`;
    asPrettier.push([options, await prettier.format(Buffer.from(bytes).toString(), { ...options, filepath: name }).catch(failure)]);
    const directory = mkdtempSync(join(tmpdir(), "oxfmt-"));
    writeFileSync(join(directory, ".oxfmtrc.json"), JSON.stringify(options));
    const { stdout, exitCode } = Bun.spawnSync([oxfmt, `--stdin-filepath=${basename(name)}`], { cwd: directory, stdin: bytes });
    // What oxfmt refuses, only Prettier judges.
    if (exitCode === 0) asOxfmt.push([options, stdout.toString()]);
    rmSync(directory, { recursive: true });
  }
  writeFileSync(join(import.meta.dir, `${name}.prettier.snap`), render(asPrettier));
  if (asOxfmt.length > 0) writeFileSync(join(import.meta.dir, `${name}.snap`), render(asOxfmt));
}
