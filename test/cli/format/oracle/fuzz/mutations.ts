// Style sheets, YAML, and style sheets in templates of JavaScript, with random changes.
//
//   bun mutations.ts <css|less|scss|yaml|embedded-css> <directory to write to> <count> <seed> <directories with files to start from..>
//
// It only writes the files. Compare with `against-prettier.ts` (the npm package) or `two-binaries.ts` (a build from before a change).
// Most of what it makes is rejected by both, which is a comparison too. Write to a new directory in memory that is only for this, and remove
// that directory afterwards, by its name.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const [language, out, countArg, seedArg, ...directories] = process.argv.slice(2);
let seed = Number(seedArg);
const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
const extensions = { css: [".css"], less: [".less"], scss: [".scss"], yaml: [".yml", ".yaml"], "embedded-css": [".css", ".scss"] }[language];
if (!extensions || directories.length === 0) {
  console.error("usage: bun mutations.ts <css|less|scss|yaml|embedded-css> <out> <count> <seed> <directories..>");
  process.exit(1);
}
const files: string[] = [];
const walk = (path: string) => {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (extensions.includes(extname(file))) files.push(file);
  }
};
directories.forEach(walk);
mkdirSync(out, { recursive: true });

const cssBits = ["(", ")", "{", "}", "[", "]", ";", ":", ",", "'", '"', "\\", "/*", "*/", "//", "@", "#", "!", "+", "-", "*", "/", "|", "~", ">", "&", ".", " ", "\n", "url(", "$", "#{", "u+", "é", " ", "--", "!important", "e+", "0", "1.", "%", "=", "^=", "::", "\t", "\f", "\0"];
function styleSheet(): string {
  let text = readFileSync(pick(files), "utf8");
  // A part of it, so that it stays small.
  const start = Math.floor(random() * text.length);
  const length = Math.floor(random() * 400);
  if (random() < 0.15) text = text.slice(start, start + length);
  else if (text.length > 1500) {
    const parts = text.split(/\n(?=\S)/);
    const first = Math.floor(random() * parts.length);
    text = parts.slice(first, first + 1 + Math.floor(random() * 12)).join("\n");
  }
  for (let changes = 1 + Math.floor(random() * 4); changes > 0; changes--) {
    const at = Math.floor(random() * (text.length + 1));
    const kind = random();
    if (kind < 0.4) text = text.slice(0, at) + pick(cssBits) + text.slice(at);
    else if (kind < 0.7) text = text.slice(0, at) + text.slice(at + 1 + Math.floor(random() * 3));
    else text = text.slice(0, at) + text.slice(at).replace(/[(){};:,]/, pick(cssBits));
  }
  return text;
}

const yamlBits = ["- ", "? ", ": ", ":", "-", "?", "#", " #", " # c", "\n", "\n\n", " ", "  ", "\t", "{", "}", "[", "]", ",", ", ", "'", '"', "\\", "|", ">", "|-", ">+", "|2", "&a ", "*a", "!t ", "!!str ", "!!set", "!!omap", "---", "...", "\n---\n", "\n...\n", "%YAML 1.2\n", "%TAG ! tag:x,2000:\n", "a", "a: b", "- a", "é", " ", "<<: ", "~", "null", "# prettier-ignore\n", "\n# c\n", "    ", "key: |\n  text\n", "k: >\n  a\n  b\n\n  c\n", "@", "`", "%", "0"];
function yaml(): string {
  let text = readFileSync(pick(files), "utf8");
  if (text.length > 1200) {
    const lines = text.split("\n");
    const first = Math.floor(random() * lines.length);
    text = lines.slice(first, first + 5 + Math.floor(random() * 30)).join("\n");
  }
  for (let changes = 1 + Math.floor(random() * 3); changes > 0; changes--) {
    const at = Math.floor(random() * (text.length + 1));
    const kind = random();
    const lines = text.split("\n");
    const line = Math.floor(random() * lines.length);
    if (kind < 0.5) text = text.slice(0, at) + pick(yamlBits) + text.slice(at);
    else if (kind < 0.75) text = text.slice(0, at) + text.slice(at + 1 + Math.floor(random() * 3));
    else if (kind < 0.9) {
      lines[line] = random() < 0.5 ? " ".repeat(1 + Math.floor(random() * 3)) + lines[line] : lines[line].replace(/^ {1,2}/, "");
      text = lines.join("\n");
    } else {
      lines.splice(line, 0, pick(lines));
      text = lines.join("\n");
    }
  }
  return text;
}

const expressions = ["a", "props => props.color", "({ theme }) => theme.colors.primary", "fn(a, b)", "a.b.c", "cond ? x : y", "css`color: red;`", "`${x}px`", "1 + 2", "props => props.active && css`\n  color: ${props.color};\n`", "veryLongFunctionName(argumentNumberOne, argumentNumberTwo, argumentNumberThree, four)", "/* c */ a", "{a: 1}.a", "function () { return 1 }"];
const templates = [
  (text: string) => `const A = styled.div\`${text}\`;\n`,
  (text: string) => `const A = styled(B)\`${text}\`;\n`,
  (text: string) => `const A = styled.div.attrs({ a: 1 })\`${text}\`;\n`,
  (text: string) => `export default css\`${text}\`;\n`,
  (text: string) => `function f() {\n  if (a) {\n    return css\`${text}\`;\n  }\n}\n`,
  (text: string) => `const a = <div css={\`${text}\`} />;\n`,
  (text: string) => `const a = <style jsx>{\`${text}\`}</style>;\n`,
  (text: string) => `foo(css\`${text}\`);\n`,
  (text: string) => `const f = (a) => css\`${text}\`;\n`,
  (text: string) => `const o = { a: { b: [css.global\`${text}\`] } };\n`,
  (text: string) => `const G = createGlobalStyle\`${text}\`;\nconst K = keyframes\`${text}\`;\n`,
];
function embeddedStyleSheet(): string | undefined {
  const parts = readFileSync(pick(files), "utf8").split(/\n(?=\S)/);
  const first = Math.floor(random() * parts.length);
  let text = parts.slice(first, first + 1 + Math.floor(random() * 5)).join("\n");
  if (/[`\\]|\$\{/.test(text)) return undefined;
  // A substitution in the place of a token, before it or behind it. \u0001 marks its end until all are in.
  for (let substitutions = Math.floor(random() * 5); substitutions > 0; substitutions--) {
    const tokens = [...text.matchAll(/[\w-]+|[.#][\w-]+|[^\s\w]|[^;{}]+;|\s+/g)].filter(match => !match[0].includes("${"));
    if (tokens.length === 0) break;
    const token = pick(tokens);
    const before = text.slice(0, token.index);
    if ((before.match(/\$\{/g)?.length ?? 0) !== (before.match(/\}\u0001/g)?.length ?? 0)) continue;
    const substitution = "${" + pick(expressions) + "}\u0001";
    const kind = random();
    const end = token.index + token[0].length;
    if (kind < 0.5) text = before + substitution + text.slice(end);
    else if (kind < 0.75) text = before + substitution + text.slice(token.index);
    else text = text.slice(0, end) + substitution + text.slice(end);
  }
  return pick(templates)(text.replaceAll("\u0001", ""));
}

const make = language === "yaml" ? yaml : language === "embedded-css" ? embeddedStyleSheet : styleSheet;
const extension = language === "embedded-css" ? ".jsx" : extensions.at(-1);
for (let index = 0; index < Number(countArg); ) {
  const text = make();
  if (text === undefined) continue;
  writeFileSync(join(out, String(index++).padStart(5, "0") + extension), text);
}
