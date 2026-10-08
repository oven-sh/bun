// Collects the fixtures of oxc's formatter, its snapshots, and what Prettier prints for the same inputs, in `bundle.zst`.
//
//   bun test/cli/format/oxfmt/sync.ts <path to a checkout of oxc-project/oxc> <directory with node_modules/prettier>
//   bun test/cli/format/oxfmt/sync.ts --extract <part of a path, or ""> <directory>
import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { collect, extract, writeBundle } from "../bundle.ts";
import { isInput, render, rowsOf, type Options } from "./fixtures.ts";

const here = import.meta.dir;
const bundle = join(here, "bundle.zst");
const [source, ...rest] = process.argv.slice(2);
if (source === "--extract" && rest.length === 2) {
  console.log(`${extract(bundle, rest[0], rest[1])} files in ${rest[1]}`);
} else if (source && source !== "--extract" && rest.length === 1) {
  const prettierRoot = resolve(rest[0], "node_modules/prettier");
  const prettier = await import(join(prettierRoot, "index.mjs"));
  const files = new Map<string, Uint8Array>();
  for (const language of ["js", "ts"]) collect(join(source, "crates/oxc_formatter/tests/fixtures"), language, files, () => false);
  for (const [name, bytes] of [...files]) {
    if (!isInput(name)) continue;
    const outputs: [Options, string][] = [];
    for (const options of rowsOf(name, files)) {
      // Not an option of Prettier.
      const { jsdoc, ...known } = options;
      const output = await prettier.format(Buffer.from(bytes).toString(), { ...known, filepath: name }).catch((error: Error) => `<${error.name}>`);
      outputs.push([options, output]);
    }
    files.set(`${name}.prettier.snap`, Buffer.from(render(outputs)));
  }
  writeBundle(bundle, files);
  writeFileSync(join(here, "LICENSE"), readFileSync(join(source, "LICENSE")));
  const version = {
    "oxc-project/oxc": (await $`git rev-parse HEAD`.cwd(source).text()).trim(),
    prettier: JSON.parse(readFileSync(join(prettierRoot, "package.json"), "utf8")).version,
  };
  writeFileSync(join(here, "version.json"), JSON.stringify(version, null, 2) + "\n");
  console.log(`${files.size} files`);
} else {
  console.error("usage: bun sync.ts <path to a checkout of oxc> <directory with node_modules/prettier> | --extract <part of a path> <directory>");
  process.exit(1);
}
