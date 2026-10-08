// Not a comparison: shapes of templates that nest without end or that take quadratic time in a careless parser or printer, at two sizes, under
// a limit on time and memory. It prints the shapes whose time grows faster than their size, and those that end in anything but output or a
// refusal.
//
//   bun guards.ts <bun-lint> <directory for the inputs> [-size=200000]
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [bin, out, ...args] = process.argv.slice(2);
const size = +(args.find(it => it.startsWith("-size=")) ?? "-size=200000").slice(6);
const repeat = (text: string, count: number) =>
  Buffer.alloc(Buffer.byteLength(text) * Math.max(0, Math.floor(count)), text).toString();
// Each makes a template of about `n` bytes.
const shapes: Record<string, (n: number) => string> = {
  "elements in elements": n => repeat("<a>", n / 7) + repeat("</a>", n / 7),
  "components in components": n => repeat("<A>", n / 7) + repeat("</A>", n / 7),
  "blocks in blocks": n => repeat("{{#a}}", n / 12) + repeat("{{/a}}", n / 12),
  "else if chain": n => "{{#if a}}" + repeat("{{else if a}}b", n / 14) + "{{/if}}",
  "else chain of another name": n => "{{#a}}" + repeat("{{else b}}c", n / 11) + "{{/a}}",
  "parentheses": n => "{{a " + repeat("(a ", n / 4) + repeat(")", n / 4) + "}}",
  "parentheses in hashes": n => "{{a " + repeat("b=(a ", n / 6) + repeat(")", n / 6) + "}}",
  "partial blocks": n => repeat("{{#> a}}", n / 14) + repeat("{{/a}}", n / 14),
  "raw blocks in a raw block": n =>
    "{{{{a}}}}" + repeat("{{{{b}}}}", n / 19) + repeat("{{{{/b}}}}", n / 19) + "{{{{/a}}}}",
  "open elements": n => repeat("<a>", n / 3),
  "open blocks": n => repeat("{{#a}}", n / 6),
  "open parentheses": n => "{{a " + repeat("(a ", n / 3),
  "siblings": n => repeat("<a></a>", n / 7),
  "siblings on lines": n => repeat("<a></a>\n", n / 8),
  "mustaches": n => repeat("{{a}}", n / 5),
  "mustaches and blanks": n => repeat("{{a}} ", n / 6),
  "blocks": n => repeat("{{#a}}{{/a}}", n / 12),
  "words": n => repeat("a ", n / 2),
  "one word": n => repeat("a", n),
  "blanks": n => "a" + repeat(" ", n) + "b",
  "line breaks": n => "a" + repeat("\n", n) + "b",
  "blank lines in an element": n => "<a>" + repeat(" \n", n / 2) + "</a>",
  "attributes": n => "<a" + repeat(" b", n / 2) + "></a>",
  "attributes with values": n => "<a" + repeat(' b="c"', n / 6) + "></a>",
  "modifiers": n => "<a" + repeat(" {{b}}", n / 6) + "></a>",
  "comments in a tag": n => "<a" + repeat(" {{!b}}", n / 7) + "></a>",
  "parts of a value": n => '<a b="' + repeat("c{{d}}", n / 6) + '"></a>',
  "classes": n => '<a class="' + repeat("b ", n / 2) + '"></a>',
  "classes and mustaches": n => '<a class="' + repeat("b {{c}} ", n / 8) + '"></a>',
  "lines in a value": n => '<a b="' + repeat("c\n", n / 2) + '"></a>',
  "block parameters": n => "<a as |" + repeat("b ", n / 2) + "|></a>",
  "block parameters of a block": n => "{{#a as |" + repeat("b ", n / 2) + "|}}{{/a}}",
  "parameters": n => "{{a" + repeat(" b", n / 2) + "}}",
  "pairs": n => "{{a" + repeat(" b=c", n / 4) + "}}",
  "a long path": n => "{{a" + repeat(".b", n / 2) + "}}",
  "a long path with brackets": n => "{{a" + repeat(".[b c]", n / 6) + "}}",
  "strings": n => "{{a" + repeat(' "b"', n / 4) + "}}",
  "escaped quotes": n => '{{a "' + repeat('\\"', n / 2) + '"}}',
  "escaped quotes without an end": n => '{{a "' + repeat('\\"', n / 2),
  "strings that end at an escaped quote": n => "{{a " + repeat('"\\" ', n / 4) + "}}",
  "escaped brackets": n => "{{a.[" + repeat("\\]", n / 2) + "]}}",
  "open brackets": n => "{{a " + repeat("[", n),
  "less than": n => repeat("<", n),
  "less than and blanks": n => repeat("< ", n / 2),
  "less than in a style": n => "<style>" + repeat("<", n) + "</style>",
  "less than in a script": n => "<script>" + repeat("</", n / 2) + "</script>",
  "open tags": n => repeat("<a ", n / 3),
  "end tags": n => repeat("</a>", n / 4),
  "ampersands": n => repeat("&", n),
  "entities": n => repeat("&amp;", n / 5),
  "braces": n => repeat("{", n),
  "closing braces": n => repeat("}", n),
  "escaped mustaches": n => repeat("\\{{", n / 3),
  "escaped mustaches with text": n => repeat("\\{{a}} ", n / 7),
  "backslashes": n => repeat("\\", n) + "{{a}}",
  "backslashes before mustaches": n => repeat("\\\\{{a}}", n / 7),
  "escaped mustaches in a value": n => '<a b="' + repeat("\\{{c}}", n / 6) + '"></a>',
  "escaped mustaches in a comment": n => "<!--" + repeat("\\{{c}}", n / 6) + "-->",
  "escaped mustaches in a name": n => "<a" + repeat("\\{{c}}", n / 6) + "></a>",
  "dashes in a comment": n => "<!--" + repeat("-", n) + "-->",
  "dashes and letters in a comment": n => "<!--" + repeat("-a", n / 2) + "-->",
  "mustaches in a comment": n => "<!--" + repeat(" {{a}}", n / 6) + "-->",
  "blocks in a comment": n => "<!-- " + repeat("{{#a}}", n / 12) + repeat("{{/a}}", n / 12) + "-->",
  "comments": n => repeat("<!--a-->", n / 8),
  "open comments": n => repeat("<!--", n / 4),
  "dashes in a mustache comment": n => "{{!--" + repeat("-", n) + "--}}",
  "dashes without an end": n => "{{!--" + repeat("-", n),
  "open mustache comments": n => repeat("{{!--", n / 5),
  "open short comments": n => repeat("{{!", n / 3),
  "mustache comments": n => repeat("{{!a}}", n / 6),
  "ignored": n => repeat("{{! prettier-ignore }}\n<a   b></a>\n", n / 35),
  "doctypes": n => repeat("<!DOCTYPE html>", n / 15),
  "an open doctype": n => "<!DOCTYPE " + repeat("a", n),
  "lines in pre": n => "<pre>" + repeat("a\n", n / 2) + "</pre>",
  "lines in a style that is no style sheet": n => "<style>{" + repeat("  a\n", n / 4) + "</style>",
  "rules in a style": n => "<style>" + repeat("a{b:c}", n / 6) + "</style>",
  "styles": n => repeat("<style>a{b:c}</style>", n / 21),
  "front matter": n => "---\n" + repeat("a: b\n", n / 5) + "---\n<a></a>",
  "open front matter": n => "---\n" + repeat("a: b\n", n / 5),
  "line separators": n => repeat("\n {{a}}", n / 9),
  "line separators on one line": n => "\n " + repeat("{{~! a ~}}", n / 10),
  "line separators in mustaches": n => repeat("{{a\n b}}", n / 10),
  "no-break spaces": n => repeat(" ", n / 2),
  "wide characters": n => repeat("日本 ", n / 7),
  "nul": n => repeat("a\0", n / 2),
  "nul in strings": n => "{{a" + repeat(' "\0"', n / 4) + "}}",
  "tildes": n => repeat("{{~a~}}", n / 7),
  "numbers": n => "{{a" + repeat(" 1.50", n / 5) + "}}",
  "a long number": n => "{{" + repeat("9", n) + "}}",
  "dots": n => "{{" + repeat(".", n) + "}}",
  "slashes": n => "{{a" + repeat("/b", n / 2) + "}}",
  "this": n => "{{" + repeat("this/", n / 5) + "a}}",
};

const directory = mkdtempSync(join(out, "handlebars-guards-"));
const input = join(directory, "input.hbs");
function run(text: string) {
  writeFileSync(input, text);
  const start = performance.now();
  const result = Bun.spawnSync([
    "sh",
    "-c",
    `ulimit -c 0; ulimit -v 4000000; exec timeout 20 "$0" format file "$1" > /dev/null`,
    bin,
    input,
  ]);
  return { time: performance.now() - start, code: result.exitCode };
}
let bad = 0;
for (const [name, make] of Object.entries(shapes)) {
  for (const options of [""]) {
    const [small, large] = [run(make(size / 8)), run(make(size))];
    const grows = large.time / Math.max(small.time, 4);
    const line = `${name}${options}: ${small.time.toFixed(0)} ms, ${large.time.toFixed(0)} ms, exit ${small.code} ${large.code}`;
    if (grows > 20 || large.code !== 0 || small.code !== 0) {
      bad++;
      console.log("BAD", line);
    } else if (args.includes("-all")) console.log(line);
  }
}
rmSync(directory, { recursive: true });
console.log(`${Object.keys(shapes).length} shapes, ${bad} bad`);
