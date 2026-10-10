// HTML in the templates of JavaScript: fixtures of Prettier and small pieces of HTML, whole or in part, in `` html`..` ``, `/* HTML */` and
// `@Component({ template })`, with substitutions in the place of words, values and names of attributes, names of elements, and in comments,
// scripts and style sheets. It only writes them: `../against-prettier.ts --options='{"embeddedHtml":true}'` compares.
//
//   bun templates.ts <tests/format of a checkout of Prettier> <directory to write to> [-seed=1] [-count=1000]
//
// Prettier numbers its placeholders with a counter that grows as long as the process lives. It lines up the candidates of a `srcset` by the
// width of the placeholder, and prints the placeholder itself, in lower case, where a substitution is the name of a property in a style
// sheet. So a difference is one only if a new process shows it too.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [fixtures, out, ...args] = process.argv.slice(2);
const flag = (name: string, otherwise: string) =>
  (args.find(it => it.startsWith(`-${name}=`)) ?? `-${name}=${otherwise}`).slice(name.length + 2);
let seed = +flag("seed", "1");
const below = (n: number) => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % n;
};
const chance = (percent: number) => below(100) < percent;
const pick = <T>(list: readonly T[]): T => list[below(list.length)];

const files: string[] = [];
const walk = (directory: string) => {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) walk(path);
    else if (/\.(html|vue)$/.test(name) && stats.size <= 3000) files.push(path);
  }
};
for (const language of ["html", "lwc", "angular", "vue"]) walk(join(fixtures, language));

const expressions = [
  "x",
  "this.foo.bar",
  "a ? b : c",
  "fn(a, b)",
  "{ a: 1 }",
  "[1, 2, 3]",
  "a + b",
  "await x",
  "`t${y}`",
  "items.map((item) => html`<li>${item}</li>`)",
  'items.map((item) => html`\n<li class="${item.cls}">${item.name}</li>\n`)',
  "someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour)",
  "/* c */ x",
  "x /* c */",
  "\n  x\n",
  "\n x // c\n",
  "cond && html`<b>${y}</b>`",
  "cond ? html`<i>a</i>` : nothing",
  'classMap({ active: this.active, "is-long-class-name": this.isLongClassName, other: other })',
  '"str"',
  "'s'",
  "() => this.handle()",
  "(e) => { this.a = e; }",
];
const pieces = [
  '<div class="a b">text <b>bold</b> more text</div>',
  "<ul>\n<li>one</li><li>two</li>\n</ul>",
  '<input type="text" value="v" disabled>',
  "<p>some long paragraph of text that goes on and on until it has to be wrapped somewhere near the end of the line</p>",
  "<script>const a = 1; function f(x) { return x + 1 }</script>",
  "<style>a { color: red; } .b > c { margin: 0 }</style>",
  "<!-- a comment -->",
  "<pre>\n  keep\n   this\n</pre>",
  "<textarea>\n a\n</textarea>",
  '<my-element .prop="v" @click="h" ?on="b"></my-element>',
  '<a href="x">link</a>, <i>i</i>; <span> s </span>',
  "<table><tr><td>1</td><td>2</td></tr></table>",
  '<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>',
  '<script type="application/json">{"a":1,"b":[1,2,3]}</script>',
  '<button onclick="go(1)" style="color:red;margin:0">Go</button>',
  '<select><option value="1">a</option><option>b</option></select>',
  "<br/>",
  '<img src="a.png" srcset="a.png 1x, b.png 2x" alt="x">',
  "<script>const t = html`<p>${x} y</p>`;</script>",
  "<h1>   Title   </h1>",
  "text only",
  "<span>a</span><span>b</span>",
  "<!DOCTYPE html><html><head><title>t</title></head><body>b</body></html>",
  "$ {x} \\ ` ${",
  "<div>{{ a | b }}</div> ${{ c }}",
  "@if (a) {<b>c</b>}",
];
const wrappers = [
  "const t = html`%`;",
  "foo(html`%`);",
  "const f = (x) => html`%`;",
  "const t = /* HTML */ `%`;",
  "foo(/* HTML */ `%`, b);",
  "class A extends B {\n  render() {\n    return html`%`;\n  }\n}",
  "export default { t: html`%` };",
  "a = cond ? html`%` : null;",
  "html`%`;",
  "x.y(1).z(html`%`).w();",
  '@Component({\n  selector: "a",\n  template: `%`,\n})\nclass C {}',
];

/// `text` as it is written in a template, with substitutions.
function withSubstitutions(text: string) {
  const used: string[] = [];
  // Where a substitution goes: \0, its number, \0.
  const mark = () => `\0${used.push(pick(expressions)) - 1}\0`;
  const replace = (pattern: RegExp, make: (match: RegExpExecArray) => string) => {
    const matches = [...text.matchAll(pattern)] as RegExpExecArray[];
    if (matches.length === 0) return false;
    const match = pick(matches);
    text = text.slice(0, match.index) + make(match) + text.slice(match.index + match[0].length);
    return true;
  };
  for (let left = pick([0, 1, 1, 2, 3, 5, 8]); left > 0; left--) {
    const kind = below(100);
    if (kind < 30 && replace(/="[^"\0]*"/g, () => pick(['="%"', "=%", "='%'", '="a % b"', '="%%"']).replace(/%/g, mark)))
      continue;
    if (kind < 75 && replace(/(?<=[>\s])[A-Za-z]+(?=[\s<])/g, mark)) continue;
    if (kind < 80 && replace(/<[a-z]+(?=[\s>])/g, () => "<" + mark())) continue;
    if (kind < 90 && replace(/\s[a-z-]+(?==")/g, () => " " + pick(["@click", ".prop", "?bool", "", ""]) + (chance(50) ? mark() : "name")))
      continue;
    if (kind < 93 && replace(/<!--[^\0]*?-->/g, ([comment]) => comment.slice(0, 4) + mark() + comment.slice(4))) continue;
    if (
      kind < 97 &&
      replace(/(?<=<(script|style)[^>\0]*>)[^\0]*?(?=<\/\1>)/g, ([code]) => {
        const words = [...code.matchAll(/[A-Za-z_]+|\d+/g)];
        if (words.length === 0) return code;
        const word = pick(words);
        return code.slice(0, word.index) + pick(["", "(", '"']) + mark() + code.slice(word.index + word[0].length);
      })
    )
      continue;
    const at = below(text.length + 1);
    if (!text.slice(Math.max(0, at - 6), at + 6).includes("\0")) text = text.slice(0, at) + mark() + text.slice(at);
  }
  const escaped = text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return escaped.replace(/\0(\d+)\0/g, (_, index) => "${" + used[+index] + "}");
}

for (let index = 0; index < +flag("count", "1000"); index++) {
  let text: string;
  if (chance(50)) {
    const separator = pick(["", "\n", " ", "\n\n"]);
    text = Array.from({ length: pick([1, 1, 2, 3, 5]) }, () => pick(pieces)).join(separator);
  } else {
    text = readFileSync(pick(files), "utf8");
    if (chance(50)) {
      const lines = text.split("\n");
      const first = below(lines.length);
      text = lines.slice(first, first + pick([1, 2, 3, 5, 10, 20])).join("\n");
    }
  }
  const around = below(10);
  if (around < 3) text = text.trim();
  else if (around < 5) text = text.trim() + "\n";
  else if (around < 6) text = "\n" + text.trim();
  else if (around < 7) text = ` ${text.trim()} `;
  const wrapper = pick(wrappers);
  const name = String(index).padStart(5, "0") + (wrapper.startsWith("@") ? ".ts" : ".js");
  writeFileSync(join(out, name), wrapper.replace("%", () => withSubstitutions(text)) + "\n");
}
