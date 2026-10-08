// Collects Prettier's fixtures and snapshots in `bundle.zst`.
//
//   bun test/cli/format/prettier/sync.ts <path to a checkout of prettier/prettier at a release tag, with its node_modules>
//   bun test/cli/format/prettier/sync.ts --extract <part of a path, or ""> <directory>
import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { collect, extract, writeBundle } from "../bundle.ts";

const languages = ["js", "jsx", "typescript", "json", "css", "less", "scss", "graphql", "yaml", "markdown", "mdx", "misc"];

const ours = ["babel", "typescript", "json", "json5", "jsonc", "json-stringify", "css", "less", "scss", "graphql", "yaml", "markdown", "mdx"];
/** The name of a file that is parsed with the parser. */
const fileFor = (parser: string, name: string) =>
  parser === "json-stringify" ? `${name}/package.json` : `${name}.${{ babel: "js", typescript: "ts", markdown: "md" }[parser] ?? parser}`;

type Snippet = string | { name?: string; code: string; output?: string; filename?: string };
type Options = { errors?: true | Record<string, true | string[]> } & Record<string, unknown>;

/**
 * What is in a `format.test.js` and in no snapshot: the expected output of a snippet, if it is next to the input, and the text of a snippet
 * that is rejected. The tests are run here with a `runFormatTest` that takes notes. They are written as the other fixtures are: in
 * `inline-outputs` next to the test a snapshot file, in `rejected-snippets` the inputs and a snapshot file.
 */
async function addFromTests(root: string, files: Map<string, Uint8Array>) {
  const prettier = { getSupportInfo: async () => ({ options: [{ name: "parser", choices: ours.map(value => ({ value })) }] }) };
  const separator = (title: string) => "=".repeat(Math.floor((80 - title.length) / 2)) + title + "=".repeat(Math.ceil((80 - title.length) / 2));
  const escape = (text: string) => text.replace(/[\\`]|\$\{/g, "\\$&");

  for (const test of [...new Bun.Glob(`{${languages.join(",")}}/**/format.test.js`).scanSync(root)].sort()) {
    const code = readFileSync(join(root, test), "utf8");
    if (!/\bsnippets\b/.test(code)) continue;
    const directory = dirname(test);
    let [outputs, rejected] = ["", ""];
    const counts = new Map<string, number>();
    const runFormatTest = (fixtures: { snippets?: Snippet[] }, parsers: string[], rawOptions: Options = {}) => {
      // As in Prettier's `run-format-test.js` and `shouldThrowOnFormat`
      const { errors = {}, ...options }: Options = `/${directory}/`.includes("/_errors_/") ? { errors: true, ...rawOptions } : rawOptions;
      (fixtures.snippets ?? []).forEach((snippet, index) => {
        const { name = `#${index}`, code, output, filename } = typeof snippet === "string" ? { code: snippet } : snippet;
        for (const parser of parsers.filter(it => ours.includes(it))) {
          const list = errors === true || errors[parser];
          if (list === true || (Array.isArray(list) && filename !== undefined && list.includes(filename))) {
            const file = fileFor(parser, String(counts.size));
            counts.set(file, 1);
            files.set(`${directory}/rejected-snippets/${file}`, Buffer.from(code));
            rejected += `\nexports[\`${file} format 1\`] = \`\n"snippet: ${escape(name)}, ${parser}"\n\`;\n`;
          }
        }
        if (output === undefined) return;
        // The output is the same for all of them. The first of each language stands for the others.
        const families = new Map(parsers.filter(it => ours.includes(it)).map(it => [/^babel$|^typescript$/.test(it) ? "js" : it, it]).reverse());
        for (const parser of [...families.values()].reverse()) {
          const title = `snippet: ${name}${Object.keys(options).length ? ` - ${JSON.stringify(options)}` : ""} format`;
          counts.set(title, (counts.get(title) ?? 0) + 1);
          const lines = [...Object.entries(options), ["parsers", [parser]]].map(([name, value]) => `${name}: ${JSON.stringify(value)}`).sort();
          const body = [separator("options"), ...lines, separator("input"), code, separator("output"), output, separator("")].join("\n");
          outputs += `\nexports[\`${escape(title)} ${counts.get(title)}\`] = \`\n${escape(body)}\n\`;\n`;
        }
      });
    };
    // The imports become arguments.
    const given = new Map<string, unknown>([["runFormatTest", runFormatTest], ["importMeta", { url: pathToFileURL(join(root, test)).href }]]);
    for (const [, names, from] of code.matchAll(/^import (.+?) from "(.+?)";$/gm)) {
      const module = from.endsWith("/prettier-entry.js") ? { default: prettier } : await import(from.startsWith(".") ? join(root, directory, from) : Bun.resolveSync(from, root));
      if (names.startsWith("{")) for (const name of names.slice(1, -1).split(",")) given.set(name.trim(), module[name.trim()]);
      else given.set(names, module.default);
    }
    const body = code.replace(/^import .*$/gm, "").replaceAll("import.meta", "importMeta");
    await new (Object.getPrototypeOf(async function () {}).constructor)(...given.keys(), body)(...given.values());
    const snapshot = (text: string) => Buffer.from(`// Written by sync.ts\n${text}`);
    if (outputs) files.set(`${directory}/inline-outputs/__snapshots__/format.test.js.snap`, snapshot(outputs));
    if (rejected) files.set(`${directory}/rejected-snippets/__snapshots__/format.test.js.snap`, snapshot(rejected));
  }
}

const here = import.meta.dir;
const bundle = join(here, "bundle.zst");
const [source, ...rest] = process.argv.slice(2);
if (source === "--extract" && rest.length === 2) {
  console.log(`${extract(bundle, rest[0], rest[1])} files in ${rest[1]}`);
} else if (source && source !== "--extract") {
  const files = new Map<string, Uint8Array>();
  // The snapshots say with which options an input is formatted.
  for (const language of languages) {
    collect(join(source, "tests/format"), language, files, name => name === "format.test.js");
  }
  await addFromTests(join(source, "tests/format"), files);
  writeBundle(bundle, files);
  writeFileSync(join(here, "LICENSE"), readFileSync(join(source, "LICENSE")));
  const version = {
    "prettier/prettier": (await $`git rev-parse HEAD`.cwd(source).text()).trim(),
    version: JSON.parse(readFileSync(join(source, "package.json"), "utf8")).version,
  };
  writeFileSync(join(here, "version.json"), JSON.stringify(version, null, 2) + "\n");
  console.log(`${files.size} files`);
} else {
  console.error("usage: bun sync.ts <path to a checkout of Prettier> | --extract <part of a path> <directory>");
  process.exit(1);
}
