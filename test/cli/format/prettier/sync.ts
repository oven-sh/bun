// Collects Prettier's fixtures and snapshots in `bundle.zst`.
//
//   bun test/cli/format/prettier/sync.ts <path to a checkout of prettier/prettier at a release tag>
//   bun test/cli/format/prettier/sync.ts --extract <part of a path, or ""> <directory>
import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { collect, extract, writeBundle } from "../bundle.ts";

const languages = ["js", "jsx", "typescript", "json", "css", "less", "scss", "graphql", "yaml", "markdown", "misc"];

/**
 * A few `format.test.js` have the expected output next to the input, so it is in no snapshot. They are run here with a `runFormatTest` that
 * takes notes, which are written in the form of a snapshot file, in a directory `inline-outputs` next to them.
 */
async function addInlineOutputs(root: string, files: Map<string, Uint8Array>) {
  const outdent = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = String.raw({ raw: strings }, ...values.map(String)).replace(/^\n/, "").replace(/\n[ \t]*$/, "");
    const indentation = /^[ \t]*/.exec(strings[0].replace(/^\n/, ""))![0];
    return text.replaceAll(new RegExp(`^${indentation}`, "gm"), "");
  };
  const ours = ["babel", "typescript", "json", "json5", "jsonc", "json-stringify", "css", "less", "scss", "graphql", "yaml", "markdown"];
  const prettier = { getSupportInfo: async () => ({ options: [{ name: "parser", choices: ours.map(value => ({ value })) }] }) };
  const separator = (title: string) => "=".repeat(Math.floor((80 - title.length) / 2)) + title + "=".repeat(Math.ceil((80 - title.length) / 2));
  const escape = (text: string) => text.replace(/[\\`]|\$\{/g, "\\$&");

  for (const test of new Bun.Glob(`{${languages.join(",")}}/**/format.test.js`).scanSync(root)) {
    const code = readFileSync(join(root, test), "utf8");
    if (!/\boutput\b/.test(code)) continue;
    let snapshot = "";
    const counts = new Map<string, number>();
    const runFormatTest = (fixtures: { snippets: (string | { name?: string; code: string; output?: string })[] }, parsers: string[], options: object = {}) => {
      fixtures.snippets.forEach((snippet, index) => {
        if (typeof snippet === "string" || snippet.output === undefined) return;
        // The output is the same for all of them. The first of each language stands for the others.
        const families = new Map(parsers.filter(it => ours.includes(it)).map(it => [/^json|^css|^less|^scss|^graphql|^yaml|^markdown/.test(it) ? it : "js", it]).reverse());
        for (const parser of [...families.values()].reverse()) {
          const title = `snippet: ${snippet.name ?? `#${index}`}${Object.keys(options).length ? ` - ${JSON.stringify(options)}` : ""} format`;
          counts.set(title, (counts.get(title) ?? 0) + 1);
          const lines = [...Object.entries(options), ["parsers", [parser]]].map(([name, value]) => `${name}: ${JSON.stringify(value)}`).sort();
          const body = [separator("options"), ...lines, separator("input"), snippet.code, separator("output"), snippet.output, separator("")].join("\n");
          snapshot += `\nexports[\`${escape(title)} ${counts.get(title)}\`] = \`\n${escape(body)}\n\`;\n`;
        }
      });
    };
    const body = code.replace(/^import .*$/gm, "").replaceAll("import.meta", "{}");
    await new (Object.getPrototypeOf(async function () {}).constructor)("runFormatTest", "outdent", "prettier", body)(runFormatTest, outdent, prettier);
    if (snapshot) files.set(`${dirname(test)}/inline-outputs/__snapshots__/format.test.js.snap`, Buffer.from(`// Written by sync.ts\n${snapshot}`));
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
  await addInlineOutputs(join(source, "tests/format"), files);
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
