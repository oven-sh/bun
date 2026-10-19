// Records the tree that `@eslint/markdown` gets from mdast-util-from-markdown for every example in
// `test/js/bun/md/*.txt` (the CommonMark and GFM specs, and md4c's tests). Each example is parsed in both languages,
// with and without math and front matter.
//
//   node markdown-trees.mjs <node_modules with @eslint/markdown>    # writes markdown-trees.zst next to this file
//
// The output has one line of JSON per case: `{ id, text, language, languageOptions, tree }`. `tree` is in the format
// that `bun lint --print-markdown-trees` prints: one line per node, with its type, its start and end in bytes, and its
// fields. A node without a position has ` ?` instead.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { zstdCompressSync } from "node:zlib";

// Resolve the packages from the plugin's directory, so that these are the versions it uses.
const requireFromPlugin = createRequire(join(resolve(process.argv[2]), "@eslint/markdown/dist/index.js"));
const load = name => import(pathToFileURL(requireFromPlugin.resolve(name)).href);
const { fromMarkdown } = await load("mdast-util-from-markdown");
const { frontmatterFromMarkdown } = await load("mdast-util-frontmatter");
const { gfmFromMarkdown } = await load("mdast-util-gfm");
const { mathFromMarkdown } = await load("mdast-util-math");
const { frontmatter } = await load("micromark-extension-frontmatter");
const { gfm } = await load("micromark-extension-gfm");
const { math } = await load("micromark-extension-math");

// `MarkdownLanguage.parse`
function parse(text, language, options) {
  const [extensions, mdastExtensions] = [[], []];
  if (language === "markdown/gfm") (extensions.push(gfm()), mdastExtensions.push(gfmFromMarkdown()));
  if (options.frontmatter) {
    const kind = options.frontmatter === "json" ? { type: "json", marker: "-" } : [options.frontmatter];
    (extensions.push(frontmatter(kind)), mdastExtensions.push(frontmatterFromMarkdown(kind)));
  }
  if (options.math) (extensions.push(math()), mdastExtensions.push(mathFromMarkdown()));
  return fromMarkdown(text, { extensions, mdastExtensions });
}

const FIELDS = [
  ..."depth lang meta value url title alt identifier label referenceType ordered start spread checked align".split(" "),
];

function print(text, root) {
  const bytes = index => Buffer.byteLength(text.slice(0, index));
  const lines = [];
  const visit = (node, depth) => {
    const { start, end } = node.position ?? {};
    const fields = FIELDS.filter(key => node[key] != null && !(key === "title" && node[key] === ""));
    lines.push(
      [
        " ".repeat(depth) + node.type,
        start ? `${bytes(start.offset)}-${bytes(end.offset)}` : "?",
        ...fields.map(key => `${key}=${JSON.stringify(node[key])}`),
      ].join(" "),
    );
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  visit(root, 0);
  return lines.join("\n");
}

const VARIANTS = [
  ["markdown/commonmark", {}],
  ["markdown/gfm", { frontmatter: "yaml" }],
  ["markdown/gfm", { math: true, frontmatter: "toml" }],
  ["markdown/commonmark", { math: true, frontmatter: "json" }],
];
const examples = join(import.meta.dirname, "../../../js/bun/md");
const cases = [];
for (const name of readdirSync(examples).sort()) {
  if (!name.endsWith(".txt")) continue;
  const found = readFileSync(join(examples, name), "utf8").matchAll(/^`{32} example[^\n]*\n(.*?)^\.\n.*?^`{32}$/gms);
  for (const [index, [, written]] of [...found].entries()) {
    const text = written.replaceAll("→", "\t");
    for (const [language, languageOptions] of VARIANTS) {
      const id = `${name}#${index} ${language} ${JSON.stringify(languageOptions)}`;
      cases.push({ id, text, language, languageOptions, tree: print(text, parse(text, language, languageOptions)) });
    }
  }
}
const lines = cases.map(it => `${JSON.stringify(it)}\n`).join("");
writeFileSync(join(import.meta.dirname, "markdown-trees.zst"), zstdCompressSync(lines, { params: { 100: 19 } }));
console.log(`${cases.length} cases`);
