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

const counts = new Map<string, number>();
function write(target: string, variant: number, second: number, text: Uint8Array) {
  if (text.length > LARGEST) return;
  const header = new Uint8Array(10);
  header[0] = variant;
  header[1] = second;
  const bytes = Buffer.concat([header, text]);
  if (!counts.has(target)) mkdirSync(join(into, target), { recursive: true });
  writeFileSync(join(into, target, createHash("sha1").update(bytes).digest("hex")), bytes);
  counts.set(target, (counts.get(target) ?? 0) + 1);
}

function take(name: string, text: Uint8Array) {
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
  if (target == "markdown" && variant == 0) write("md", 0, 0, text);
  if (target == "js") {
    write("lint", LINT[variant], 0, text);
    // The second byte is the dialect: that of tsc, and that of Babel or of Flow.
    write("parser", PARSER[variant], 0, text);
    write("parser", PARSER[variant], variant >= 9 ? 4 : 3, text);
  }
}

function walk(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else take(path, readFileSync(path));
  }
}

for (const [name, text] of readBundle(join(import.meta.dir, "../../../prettier/bundle.zst"))) take(name, text);
walk(join(import.meta.dir, "../../../own/cases"));
more.forEach(walk);
// One case in eight: there are tens of thousands, and most differ in a word.
let at = 0;
for (const [name, text] of readBundle(join(import.meta.dir, "../../../../lint/conformance/bundle.zst"))) {
  if (!name.endsWith(".json") || name.includes("node_modules/") || name.includes("-project/")) continue;
  for (const it of JSON.parse(text.toString()).cases ?? []) {
    if (typeof it.code != "string" || at++ % 8) continue;
    const isTypeScript = name.includes("typescript-eslint/");
    write("lint", isTypeScript ? (it.code.includes("</") ? 5 : 4) : it.code.includes("</") ? 3 : 0, 0, Buffer.from(it.code));
  }
}
console.log(Object.fromEntries(counts));
