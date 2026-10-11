// seeds.ts <directory> [more directories with files to take..]: writes the first corpus of each target to <directory>/<target>:
// the inputs of Prettier's tests (../../../prettier/bundle.zst), our own (../../../own/cases), the test cases of the rules
// (../../../../lint/conformance/bundle.zst) for the linter, and every file below the directories that are named.
// An input is ten bytes that choose the variant and the options (lib.rs: `Input`), all zero but the first, and the text.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBundle } from "../../../bundle.ts";

const [into, ...more] = process.argv.slice(2);
if (!into) throw new Error("usage: bun seeds.ts <directory> [directories..]");
const LARGEST = 64 << 10;

/** For each ending of a name: the target, and which of its variants (format.rs: `TARGETS`). */
const BY_ENDING: [string, string, number][] = [
  [".component.html", "html", 2],
  [".html", "html", 0],
  [".htm", "html", 0],
  [".xhtml", "html", 0],
  [".vue", "html", 1],
  [".mjml", "html", 4],
  [".hbs", "handlebars", 0],
  [".handlebars", "handlebars", 0],
  [".css", "css", 0],
  [".pcss", "css", 0],
  [".scss", "css", 1],
  [".less", "css", 2],
  [".yaml", "yaml", 0],
  [".yml", "yaml", 0],
  [".md", "markdown", 0],
  [".markdown", "markdown", 0],
  [".mdx", "markdown", 1],
  [".graphql", "graphql", 0],
  [".gql", "graphql", 0],
  [".json", "json", 0],
  [".json5", "json", 1],
  [".jsonc", "json", 2],
  [".js.flow", "js", 11],
  [".d.ts", "js", 8],
  [".js", "js", 0],
  [".jsx", "js", 1],
  [".ts", "js", 2],
  [".tsx", "js", 3],
  [".mjs", "js", 4],
  [".cjs", "js", 5],
  [".mts", "js", 6],
  [".cts", "js", 7],
];
/** The variants of lint.rs and the paths of parser.rs for those of `js`. */
const LINT = [0, 3, 4, 5, 11, 2, 8, 7, 6, 0, 0, 0];
const PARSER = [2, 3, 0, 1, 7, 8, 5, 6, 4, 2, 2, 2];

/** For a target and a variant: where such a text can be in a text in another language (format.rs: `PLACES`). */
const PLACES: Record<string, number[]> = {
  "html 0": [0, 1, 3, 4, 6, 7, 8],
  "html 1": [5],
  "html 2": [2],
  "css 0": [13, 32, 50, 51, 52, 58],
  "css 1": [14],
  "css 2": [15],
  "js 0": [10, 26, 27, 56],
  "js 2": [11],
  "js 3": [12, 31, 57],
  "json 0": [16, 17, 28, 59],
  "yaml 0": [19, 37, 60, 64, 65],
  "markdown 0": [18, 29, 55, 62],
  "graphql 0": [53, 54, 61],
  "handlebars 0": [30, 63],
};

const counts = new Map<string, number>();
function write(target: string, variant: number, second: number, text: Uint8Array, flags = 0) {
  if (text.length > LARGEST) return;
  const header = new Uint8Array(10);
  header[0] = variant;
  header[1] = second;
  new DataView(header.buffer).setUint32(2, flags, true);
  const bytes = Buffer.concat([header, text]);
  if (!counts.has(target)) mkdirSync(join(into, target), { recursive: true });
  writeFileSync(join(into, target, createHash("sha1").update(bytes).digest("hex")), bytes);
  counts.set(target, (counts.get(target) ?? 0) + 1);
}

function take(name: string, text: Uint8Array, isSmallSet = true) {
  if (name.includes("__snapshots__") || name.endsWith(".snap") || name.endsWith("format.test.js")) return;
  name = name.replace(/\.input$/, "");
  const found = BY_ENDING.find(([ending]) => name.toLowerCase().endsWith(ending));
  if (!found) return;
  let [, target, variant] = found;
  // What the directory of a fixture says that its name does not.
  const top = name.split("/")[0];
  if (target == "html" && top == "angular") variant = 2;
  if (target == "html" && top == "lwc") variant = 3;
  if (target == "html" && top == "vue") variant = 1;
  if (target == "js" && top == "flow" && variant == 0) variant = 9;
  write(target, variant, 0, text);
  // With `sortPackageJson` (format.rs: `FLAGS`).
  if (name.endsWith("package.json")) write("json", 4, 0, text, 1 << 26);
  if (target == "markdown" && variant == 0) write("md", 0, 0, text);
  if (isSmallSet && text.length <= 2048)
    for (const place of PLACES[`${target} ${variant}`] ?? []) write("embedded", place, 0, text);
  if (target == "js") {
    write("lint", LINT[variant], 0, text);
    // The second byte is the dialect: that of tsc, and that of Babel or of Flow.
    write("parser", PARSER[variant], 0, text);
    write("parser", PARSER[variant], variant >= 9 ? 4 : 3, text);
  }
}

function walk(directory: string, isSmallSet: boolean) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, isSmallSet);
    else take(path, readFileSync(path), isSmallSet);
  }
}

for (const [name, text] of readBundle(join(import.meta.dir, "../../../prettier/bundle.zst"))) take(name, text);
walk(join(import.meta.dir, "../../../own/cases"), true);
more.forEach(directory => walk(directory, false));
// For `imports`: the variant is where the text is (format.rs: `PLACES_OF_IMPORTS`) + 16 * which of `EXTRAS`.
const PLACES_OF_IMPORTS: Record<string, number[]> = {
  ts: [0, 4, 5, 10, 12, 15],
  js: [1, 6, 9, 11, 14],
  tsx: [2, 7, 13],
  jsx: [3, 8],
};
function writeImports(name: string, extras: readonly number[], text: Uint8Array) {
  const [file, ...elsewhere] = PLACES_OF_IMPORTS[/\.[cm]?(ts|js|tsx|jsx)$/.exec(name)?.[1] ?? "js"];
  for (const extra of extras) write("imports", file + 16 * extra, 0, text);
  // In a file in another language: with the first set of options.
  if (text.length <= 1024) for (const place of elsewhere) write("imports", place + 16 * extras[0], 0, text);
}
for (const [plugin, extras] of [
  ["trivago", [0, 1, 2, 3]],
  ["ianvs", [4, 5, 6, 7]],
  ["organize", [8, 9, 10]],
  ["oxfmt", [11, 12, 13]],
] as const) {
  const cases = JSON.parse(readFileSync(join(import.meta.dir, `../../../sort-imports/${plugin}.json`), "utf8"));
  for (const it of cases) writeImports(it.filename, extras, Buffer.from(it.input));
  // For `options`: with the options of the case.
  const named = {
    trivago: "@trivago/prettier-plugin-sort-imports",
    ianvs: "@ianvs/prettier-plugin-sort-imports",
    organize: "prettier-plugin-organize-imports",
  };
  for (const it of cases) {
    const { overrides, ...options } = it.options;
    const all = plugin == "oxfmt" ? { flavor: "oxfmt", ...options } : { plugins: [named[plugin]], ...options };
    const [file] = PLACES_OF_IMPORTS[/\.[cm]?(ts|js|tsx|jsx)$/.exec(it.filename)?.[1] ?? "js"];
    write("options", file, 0, Buffer.from(JSON.stringify(all) + "\n" + it.input));
  }
}
for (const [name, text] of readBundle(join(import.meta.dir, "../../../oxfmt/bundle.zst"))) {
  if (name.includes("jsdoc") && !name.endsWith(".snap")) writeImports(name, [14, 15], text);
  if (name.endsWith("package.json")) write("json", 4, 0, text, 1 << 26);
}
// One case in eight: there are tens of thousands, and most differ in a word. All that have options: a comment sets them.
let at = 0;
for (const [name, text] of readBundle(join(import.meta.dir, "../../../../lint/conformance/bundle.zst"))) {
  if (!name.endsWith(".json") || name.includes("node_modules/") || name.includes("-project/")) continue;
  const fixture = JSON.parse(text.toString());
  for (const it of fixture.cases ?? []) {
    const hasOptions = Array.isArray(it.options) && it.options.length > 0;
    if (typeof it.code != "string" || (at++ % 8 && !hasOptions)) continue;
    const isTypeScript = name.includes("typescript-eslint/");
    const { plugin, rule } = fixture;
    const id = plugin == "eslint" ? rule : `${plugin == "typescript-eslint" ? "@typescript-eslint" : plugin}/${rule}`;
    const code = it.code;
    if (hasOptions) {
      it.code = `/* eslint ${id}: ${JSON.stringify([2, ...it.options]).replaceAll("*/", "*\\/")} */\n${it.code}`;
    }
    const variant = isTypeScript ? (it.code.includes("</") ? 5 : 4) : it.code.includes("</") ? 3 : 0;
    write("lint", variant, 0, Buffer.from(it.code));
    // The same as a configuration of its own (flag 6), alone and beside all other rules (flag 7).
    if (hasOptions) {
      // A member that is `null` in the bundle is not there in the test case. The parser is the variant's.
      const { parser, ...language } = it.languageOptions ?? {};
      const given = (all: object) => Object.fromEntries(Object.entries(all).filter(([, value]) => value != null));
      const config = given({
        rules: { [id]: [2, ...it.options] },
        settings: it.settings,
        languageOptions: given(language),
      });
      const text = Buffer.from(`${JSON.stringify(config)}\n${code}`);
      // Flag 0: the names are oxlint's.
      const flags = (1 << 6) | (name.startsWith("oxlint/") ? 1 : 0);
      if (at % 2 == 0) write("lint", variant, 0, text, flags);
      if (at % 8 == 0) write("lint", variant, 0, text, flags | (1 << 7));
    }
  }
}
// The React Compiler as lint rules, alone (flag 8): its own fixtures, as ESLint's plugin and as oxlint (flag 0) have the rules.
const fixtures = join(import.meta.dir, "../../../../../bundler/transpiler/react-compiler-fixtures");
for (const name of readdirSync(fixtures, { recursive: true }) as string[]) {
  const ending = /\.(js|jsx|mjs|ts|tsx)$/.exec(name)?.[1];
  if (!ending) continue;
  // In a .js file of theirs there is JSX, and Flow.
  for (const flags of [1 << 8, (1 << 8) | 1])
    write("lint", ending.startsWith("ts") ? 5 : 3, 0, readFileSync(join(fixtures, name)), flags);
}
console.log(Object.fromEntries(counts));
