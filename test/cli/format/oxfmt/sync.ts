// Collects the fixtures of oxc's formatter, its snapshots, and what Prettier prints for the same inputs, in `bundle.zst`.
//
//   bun test/cli/format/oxfmt/sync.ts <path to a checkout of oxc-project/oxc> <directory with node_modules/prettier>
//   bun test/cli/format/oxfmt/sync.ts --extract <part of a path, or ""> <directory>
import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { collect, extract, writeBundle } from "../bundle.ts";
import { render, rowsOf, type Options } from "./fixtures.ts";

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
  for (const language of ["css", "graphql", "json", "markdown", "yaml"]) {
    const found = new Map<string, Uint8Array>();
    collect(join(source, `crates/oxc_formatter_${language}/tests`), "fixtures", found, name => name.endsWith(".rs"));
    // `embedded`: style sheets with the placeholders that stand for the `${}` of a template.
    for (const [name, bytes] of found) if (!name.startsWith("fixtures/embedded/")) files.set(name.replace("fixtures", language), bytes);
  }
  // One language in another. Of these there is no snapshot of oxfmt's.
  for (const kind of ["css-in-js", "gql-in-js", "md-in-js", "xxx-in-js-comment", "xxx-in-md"]) {
    collect(join(source, "apps/oxfmt/conformance/fixtures"), `edge-cases/${kind}`, files, () => false);
  }
  // `tests/jsdoc/fixtures` has pairs, `a.ts` and `a.output.ts`, with options in snake case. They are written in the form of the others.
  const pairs = new Map<string, Uint8Array>();
  collect(join(source, "crates/oxc_formatter/tests"), "jsdoc/fixtures", pairs, () => false);
  const rowsOfPairs = new Map<string, Options[]>();
  for (const [name, bytes] of pairs) {
    const [, stem, extension] = /^(.*?)(\.[jt]sx?)$/.exec(name) ?? [];
    const output = pairs.get(`${stem}.output${extension}`);
    // The one that oxc's own test leaves out: it needs a formatter for HTML.
    if (!stem || !output || name.endsWith("descriptions/032-jsx-tsx-css.ts")) continue;
    const given = pairs.get(`${stem}.options.json`) ?? pairs.get(`${dirname(name)}/options.json`);
    const options: Options = {};
    for (const [key, value] of Object.entries(given ? JSON.parse(Buffer.from(given).toString()) : {})) {
      const camelCase = key.replace(/_(.)/g, (_, letter) => letter.toUpperCase());
      options[key === "single_quote" || key === "print_width" ? camelCase : `jsdoc.${camelCase}`] = value;
    }
    // A property of `jsdoc` says that it is on.
    if (!Object.keys(options).some(name => name.startsWith("jsdoc."))) options.jsdoc = true;
    files.set(name, bytes);
    files.set(`${name}.snap`, Buffer.from(render([[options, Buffer.from(output).toString()]])));
    rowsOfPairs.set(name, [options]);
  }
  for (const [name, bytes] of [...files]) {
    if (!files.has(`${name}.snap`) && !name.startsWith("edge-cases/")) continue;
    const outputs: [Options, string][] = [];
    for (const options of rowsOfPairs.get(name) ?? rowsOf(name, files)) {
      // Not options of Prettier.
      const known = Object.fromEntries(Object.entries(options).flatMap(([name, value]) => (name.startsWith("jsdoc") ? [] : [[name === "variant" ? "parser" : name, value]])));
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
