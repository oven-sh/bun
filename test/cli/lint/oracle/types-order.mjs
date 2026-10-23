// Type properties in TypeScript 6's order, and how they print, as eslint-plugin-svelte's `no-unused-props` reads them
// (`getPropertiesOfType`, `typeToString`): what it reports for the components in types-order/, with
// `checkImportedTypes`. js-parsers.test.ts compares what `bun lint` reports for them with types-order.expected.json:
// spreads, heritage, merges across files and module augmentations, intersections, generic and mapped types, unions of
// string literals, and components' props types. The expected file is what ESLint 10.11 with eslint-plugin-svelte
// 3.23.1, svelte-eslint-parser 1.9.0, @typescript-eslint/parser 8.71.1 and TypeScript 6.0.3 report, recorded by:
//
//   node test/cli/lint/oracle/types-order.mjs <a node_modules with those packages>
//
// `main.svelte` has main.ts's variables as its props, and reads each one level down, so each type's properties are
// reported, and the other components read none of theirs.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const here = path.dirname(new URL(import.meta.url).pathname);
const project = path.join(here, "types-order");

/** The project's files, keyed by their path in it. */
export function projectFiles() {
  const files = {};
  for (const name of fs.readdirSync(project)) files[name] = fs.readFileSync(path.join(project, name), "utf8");
  return files;
}

/** The linted components. */
export const linted = JSON.parse(fs.readFileSync(path.join(project, "tsconfig.json"), "utf8")).files.filter(it =>
  it.endsWith(".svelte"),
);

/** The part of a message that's compared. TypeScript names a property whose key is a well-known symbol
 * `__@iterator@<id>`, with an id from its program, and Bun names it `__@iterator`. */
export const shown = ({ line, column, message }) => `${line}:${column} ${message.replace(/'(__@[^@']+)@\d+'/, "'$1'")}`;

/** What ESLint and eslint-plugin-svelte at `modules` report for the project, by component. */
export async function record(modules) {
  const require = createRequire(path.join(modules, "package.json"));
  const { ESLint } = require("eslint");
  const svelte = (await import(require.resolve("eslint-plugin-svelte"))).default;
  const eslint = new ESLint({
    cwd: project,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.svelte"],
        languageOptions: {
          parser: require("svelte-eslint-parser"),
          parserOptions: {
            parser: require("@typescript-eslint/parser"),
            project: "./tsconfig.json",
            tsconfigRootDir: project,
            extraFileExtensions: [".svelte"],
          },
        },
        plugins: { svelte },
        rules: { "svelte/no-unused-props": ["error", { checkImportedTypes: true }] },
      },
    ],
  });
  const files = {};
  for (const result of await eslint.lintFiles(linted)) {
    const fatal = result.messages.find(it => it.fatal);
    if (fatal) throw new Error(`${result.filePath}: ${fatal.message}`);
    files[path.relative(project, result.filePath)] = result.messages.map(shown);
  }
  const version = name => JSON.parse(fs.readFileSync(require.resolve(`${name}/package.json`), "utf8")).version;
  return { typescript: version("typescript"), "eslint-plugin-svelte": version("eslint-plugin-svelte"), files };
}

if (import.meta.main ?? process.argv[1] === new URL(import.meta.url).pathname) {
  const [modules] = process.argv.slice(2);
  const recorded = await record(path.resolve(modules));
  fs.writeFileSync(path.join(here, "types-order.expected.json"), JSON.stringify(recorded, null, 2) + "\n");
}
