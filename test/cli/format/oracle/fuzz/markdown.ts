// Random Markdown: inputs of Prettier's snapshots with a few random changes, or a soup of markers. Compares the formatted text, or the
// syntax tree with its positions (`--parser=markdown-ast` against `prettier.__debug.parse`), or formats as MDX.
//
//   bun markdown.ts <bun-lint> <directory with node_modules/prettier> <prettier/tests/format/markdown> [-mode=format|tree|mdx]
//     [-make=mutate|soup] [-n=500] [-seed=1] [-show=5] [--proseWrap=always ..]
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const [bin, prettierRoot, fixtures, ...args] = process.argv.slice(2);
const prettier = await import(join(resolve(prettierRoot), "node_modules/prettier/index.mjs"));
const flag = (name: string, otherwise: string) => (args.find(it => it.startsWith(`-${name}=`)) ?? `-${name}=${otherwise}`).slice(name.length + 2);
const [mode, make, count, show] = [flag("mode", "format"), flag("make", "mutate"), +flag("n", "500"), +flag("show", "5")];
const options: Record<string, unknown> = {};
for (const it of args.filter(it => it.startsWith("--"))) {
  const [key, value] = it.slice(2).split("=");
  options[key] = value === "true" ? true : value === "false" ? false : /^\d+$/.test(value) ? +value : value;
}

let seed = +flag("seed", "1");
const random = (below: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8) % below;
const pick = <T>(from: T[]) => from[random(from.length)];

const inputs: string[] = [];
(function walk(directory: string) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    if (!name.endsWith(".snap")) continue;
    const snapshots: Record<string, string> = {};
    new Function("exports", readFileSync(path, "utf8"))(snapshots);
    for (const snapshot of Object.values(snapshots)) {
      const input = /=+input=+\n([\s\S]*?)\n=+output=+\n/.exec(snapshot)?.[1];
      if (input !== undefined && input.length < 600) inputs.push(input + "\n");
    }
  }
})(fixtures);

// prettier-ignore
const bits = ["*", "**", "_", "__", "`", "``", "[", "]", "(", ")", "![", "](", "]: ", "[^", "> ", ">", "- ", "+ ", "* ", "1. ", "2) ", "# ", "## ", "\t", " ", "  ",
  "    ", "\n", "\n\n", "|", " | ", "|-|", "~~", "~", "$$", "$", "<", ">", "<a>", "</a>", "<!--", "-->", "<div>", "&amp;", "&#35;", "\\", "\\\n", "  \n", "---", "===",
  "***", "```", "~~~", "```js", "{{", "}}", "{%", "%}", "[[", "]]", "www.a.com", "http://a.b", "a@b.c", "[ ] ", "[x] ", ":", '"', "'", "a", "b c", "中", "、", "한", "é",
  "😀", "!", ".", "0"];
function mutate() {
  let text = pick(inputs);
  for (let changes = 1 + random(4); changes > 0; changes--) {
    const at = random(text.length + 1);
    const lines = text.split("\n");
    switch (random(5)) {
      case 0: text = text.slice(0, at) + pick(bits) + text.slice(at); break;
      case 1: text = text.slice(0, at) + text.slice(at + 1 + random(3)); break;
      case 2: { const [a, b] = [random(lines.length), random(lines.length)]; [lines[a], lines[b]] = [lines[b], lines[a]]; text = lines.join("\n"); break; }
      case 3: { const a = random(lines.length); lines[a] = pick(["  ", "    ", "> ", "- ", "\t", " ", "1. "]) + lines[a]; text = lines.join("\n"); break; }
      case 4: text = text.slice(0, at) + pick(pick(inputs).split("\n")) + "\n" + text.slice(at); break;
    }
  }
  return text;
}
const soup = () => Array.from({ length: 2 + random(14) }, () => pick(bits)).join("") + "\n";

/** The tree, a node a line, with offsets in bytes: what `--parser=markdown-ast` prints. */
async function tree(text: string) {
  const { ast } = await prettier.__debug.parse(text, { parser: "markdown" });
  const bytes = [0];
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    bytes.push(bytes[i] + (unit < 0x80 ? 1 : unit < 0x800 ? 2 : unit >= 0xd800 && unit <= 0xdbff ? 4 : unit >= 0xdc00 && unit <= 0xdfff ? 0 : 3));
  }
  const lines: string[] = [];
  (function walk(node: any, depth: number) {
    const { start, end } = node.position;
    let line = `${"  ".repeat(depth)}${node.type} ${bytes[start.offset]}-${bytes[end.offset]} ${start.line}:${start.column}-${end.line}:${end.column}`;
    for (const key of Object.keys(node).sort()) {
      if (["type", "children", "position", "data"].includes(key) || node[key] === undefined || node.type === "frontMatter") continue;
      line += ` ${key}=${JSON.stringify(node[key])}`;
    }
    lines.push(line);
    for (const child of node.children ?? []) walk(child, depth + 1);
  })(ast, 0);
  return lines.join("\n") + "\n";
}

const file = join(mkdtempSync(join(tmpdir(), "markdown-fuzz-")), mode === "mdx" ? "input.mdx" : "input.md");
let [same, total, shown] = [0, 0, 0];
for (let i = 0; i < count; i++) {
  const text = (make === "soup" ? soup() : mutate()).replaceAll("\r", "");
  let expected: string;
  try {
    const parser = mode === "mdx" ? "mdx" : "markdown";
    expected = mode === "tree" ? await tree(text) : await prettier.format(text, { parser, embeddedLanguageFormatting: "off", ...options });
  } catch {
    continue;
  }
  writeFileSync(file, text);
  const flags = mode === "tree" ? ["--parser=markdown-ast"] : ["--embeddedLanguageFormatting=off", ...Object.entries(options).map(([key, value]) => `--${key}=${value}`)];
  const result = Bun.spawnSync([bin, "format", "file", file, ...flags], { timeout: 10_000 });
  const actual = result.stdout.toString();
  total++;
  if (actual === expected) {
    same++;
  } else if (shown++ < show) {
    const [a, b] = [expected.split("\n"), actual.split("\n")];
    const line = a.findIndex((it, index) => it !== b[index]);
    console.log(`##### ${JSON.stringify(text)}\n  line ${line + 1}\n  - ${a.slice(line, line + 4).join("\n  - ")}\n  + ${b.slice(line, line + 4).join("\n  + ")}`);
    if (result.exitCode !== 0) console.log(result.stderr.toString().slice(0, 300));
  }
}
console.log(`${same}/${total} the same`);
