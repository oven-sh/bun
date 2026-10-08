// Handlebars templates for `../against-prettier.ts`, which compares what the npm package of Prettier and `bun-lint format` make of them,
// what is rejected included (`--accepts`).
//
//   bun generate.ts -mode=grammar|mutate|soup [-n=1000] [-seed=1] -out=<directory> [<files and directories with templates..>]
//
// It writes `<n>.hbs` into a new directory in `-out` and prints its name.
//   grammar  templates from a grammar: elements, attributes, mustaches, blocks, comments, with white space of every kind between them
//   mutate   the templates that it is given, with a piece taken out, doubled, moved or replaced by one of `pieces`
//   soup     `pieces` in any order: most of it is rejected, and has to be by both
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string, otherwise: string) =>
  (args.find(it => it.startsWith(`-${name}=`)) ?? `-${name}=${otherwise}`).slice(name.length + 2);
const [mode, count] = [flag("mode", "grammar"), +flag("n", "1000")];
let seed = +flag("seed", "1");
function random(below: number) {
  seed = (seed + 0x6d2b79f5) | 0;
  let bits = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  bits = (bits + Math.imul(bits ^ (bits >>> 7), 61 | bits)) ^ bits;
  return ((bits ^ (bits >>> 14)) >>> 0) % below;
}
const pick = <T>(list: readonly T[]): T => list[random(list.length)];
const chance = (percent: number) => random(100) < percent;
const many = (most: number, make: () => string, between: () => string = () => "") =>
  Array.from({ length: random(most + 1) }, make).join(between());

const blanks = [
  "",
  "",
  "",
  " ",
  " ",
  "  ",
  "\n",
  "\n",
  "\n  ",
  "\n\n",
  "\n\n\n",
  " \n \n ",
  "\t",
  "\f",
  " ",
  " ",
  "   ",
  " ",
];
const words = [
  "a",
  "b",
  "foo",
  "bar-baz",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit",
  "x".repeat(30),
  "é",
  "日本語",
  "😀",
  "&amp;",
  "&nbsp;",
  "&",
  "'",
  '"',
  "\\",
  "\\\\",
  "}}",
  "{",
  "-",
  "--",
  ">",
  "=",
  "/",
];
const names = [
  "a",
  "foo",
  "foo-bar",
  "fooBar",
  "if",
  "unless",
  "each",
  "yield",
  "this",
  "this.a",
  "this.a.b",
  "@a",
  "@a.b",
  "a.b",
  "a.b.c",
  "a/b",
  "[a b]",
  "a.[b c]",
  "a.[1]",
  "a.1",
  "a.[true]",
  "a.true",
  "[a.b]",
  "[a/b]",
  "a.#b",
  "$a",
  "a?",
  "_",
  "a:b",
  "é",
];
const literals = [
  "1",
  "-1",
  "1.5",
  "0",
  "007",
  "1.50",
  "-0",
  "123456789012345678901",
  "true",
  "false",
  "null",
  "undefined",
  '"a"',
  "'a'",
  '"it\'s"',
  "'say \"a\"'",
  '"a\\"b"',
  "'a\\'b'",
  '""',
  "''",
  '"a b c"',
  '"\\\\"',
  '"\'\\""',
  '"\n"',
  '"}}"',
];
const tags = [
  "div",
  "span",
  "p",
  "a",
  "ul",
  "li",
  "pre",
  "style",
  "script",
  "title",
  "textarea",
  "b",
  "Foo",
  "FooBar",
  "Foo::Bar",
  "foo.bar",
  "this.foo",
  "@foo",
  ":named",
  "x-foo",
  "svg",
];
const voids = ["br", "img", "input", "hr", "link", "meta"];
const attributes = [
  "class",
  "id",
  "href",
  "style",
  "data-a",
  "disabled",
  "@value",
  "@on-change",
  "CLASS",
  "aria-label",
  "...attributes",
  "as",
  "async",
  "lang",
];

const blank = () => pick(blanks);
const space = () => pick([" ", " ", " ", "  ", "\n", "\n  ", "\t"]);
const strip = () => (chance(10) ? "~" : "");

function expression(depth: number): string {
  const kind = random(depth > 3 ? 6 : 10);
  if (kind < 4) return pick(names);
  if (kind < 6) return pick(literals);
  return `(${chance(10) ? space() : ""}${call(depth + 1)}${chance(10) ? space() : ""})`;
}
const call = (depth: number) => [chance(90) ? pick(names) : expression(depth), argumentsOf(depth)].filter(Boolean).join(space());
function argumentsOf(depth: number): string {
  const parts: string[] = [];
  for (let i = random(4); i > 0; i--) parts.push(expression(depth));
  for (let i = random(10) < 3 ? random(4) : 0; i > 0; i--)
    parts.push(`${pick(["a", "b", "class", "on-click", "[a b]"])}=${expression(depth)}`);
  return parts.join(space());
}
const blockParams = () =>
  chance(20)
    ? ` as |${
        many(
          2,
          () => pick(["a", "b", "item", "index"]),
          () => " ",
        ) || "x"
      }|`
    : "";
function mustache(): string {
  const kind = random(20);
  const inner = `${strip()}${chance(10) ? space() : ""}${call(0)}${chance(10) ? space() : ""}${strip()}`;
  if (kind === 0) return `{{{${inner}}}}`;
  if (kind === 1) return `{{&${call(0)}}}`;
  if (kind === 2) return `{{${pick(literals)}}}`;
  return `{{${inner}}}`;
}
function comment(): string {
  const text = pick([
    "",
    " ",
    "a",
    " a ",
    " a\n  b ",
    " prettier-ignore ",
    "prettier-ignore",
    " }} ",
    "-",
    "--",
    " - ",
    "~",
    " {{a}} ",
  ]);
  const kind = random(6);
  if (kind === 0) return `<!--${text.replaceAll("--", "- -")}-->`;
  if (kind === 1) return `<!--${pick(["", "-", "a-b", " {{a}} ", " {{#if a}}b{{/if}} ", ">", "->", " <div> "])}-->`;
  if (kind < 4 && !text.includes("}}")) return `{{${strip()}!${text}${strip()}}}`;
  return `{{${strip()}!--${text}--${strip()}}}`;
}
function attributeValue(): string {
  const kind = random(10);
  if (kind < 2) return mustache();
  if (kind < 3) return pick(["a", "a-b", "1", "a&amp;b"]);
  const quote = pick(['"', '"', "'"]);
  const part = () =>
    chance(35)
      ? mustache()
      : pick([
          "a",
          "b",
          " ",
          "  ",
          "\n",
          "foo bar",
          " foo ",
          "\n  foo\n  bar\n",
          "it's",
          'say "a"',
          "&quot;",
          "\\{{a}}",
          "x".repeat(20),
          "color: red;",
        ]).replaceAll(quote, "");
  return quote + many(5, part) + quote;
}
function attribute(): string {
  const kind = random(12);
  if (kind === 0) return `{{${call(0)}}}`;
  if (kind === 1) return comment().startsWith("{{") ? comment().replace(/^<!--[^]*$/, "{{! c }}") : "{{!-- c --}}";
  const name = pick(attributes);
  return chance(25) ? name : `${name}${chance(5) ? space() : ""}=${chance(5) ? space() : ""}${attributeValue()}`;
}
function element(depth: number): string {
  const inTag = many(4, () => space() + attribute());
  if (chance(15)) return `<${pick(voids)}${inTag}${pick(["", " ", "/", " /"])}>`;
  const tag = pick(tags);
  const params = chance(10) ? ` as |${pick(["a", "a b", " a  b "])}|` : "";
  if (chance(10)) return `<${tag}${inTag}${params}${pick(["", " "])}/>`;
  const body =
    tag === "style"
      ? pick(["", " ", "a{color:red}", "\n  a {\n    color: red;\n  }\n", "a{", "\n  a{b:c}\n  {{d}}\n", "/* a */"])
      : tag === "script" || tag === "title"
        ? pick(["", "a", "a < b", "<b>", "{{a}}"])
        : children(depth + 1);
  return `<${tag}${inTag}${params}${chance(10) ? space() : ""}>${body}</${tag}${chance(5) ? " " : ""}>`;
}
function block(depth: number): string {
  const name = pick(["if", "if", "unless", "each", "let", "foo", "foo-bar", "a.b", "@a"]);
  let text = `{{${strip()}#${name}${chance(85) ? space() + argumentsOf(1) : ""}${blockParams()}${strip()}}}${children(depth + 1)}`;
  for (let i = random(10) < 3 ? random(3) : 0; i > 0; i--)
    text += `{{${strip()}else ${pick(["if", "if", name, "unless", "foo"])} ${expression(1)}${blockParams()}${strip()}}}${children(depth + 1)}`;
  if (chance(30))
    text += `${pick([`{{${strip()}else${strip()}}}`, "{{else}}", "{{^}}", "{{ else }}"])}${children(depth + 1)}`;
  return `${text}{{${strip()}/${name}${strip()}}}`;
}
function text(): string {
  return many(5, () => pick(words), blank) || "a";
}
function child(depth: number): string {
  const kind = random(depth > 4 ? 60 : 100);
  if (kind < 30) return text();
  if (kind < 50) return mustache();
  if (kind < 58) return comment();
  if (kind < 59)
    return pick([
      "\\{{a}}",
      "\\\\{{a}}",
      "\\\\\\{{a}}",
      "{{{{raw}}}} {{a}} {{{{/raw}}}}",
      "<!DOCTYPE html>",
      "<!doctype html>",
    ]);
  if (kind < 85) return element(depth);
  return block(depth);
}
function children(depth: number): string {
  let out = blank();
  for (let i = random(5); i > 0; i--) out += child(depth) + blank();
  return out;
}

const pieces = [
  ...blanks,
  ...words,
  ...names,
  ...literals,
  ...tags.map(it => `<${it}>`),
  ...tags.map(it => `</${it}>`),
  ...voids.map(it => `<${it}>`),
  ...attributes.map(it => ` ${it}=`),
  "{{",
  "}}",
  "{{{",
  "}}}",
  "{{{{",
  "}}}}",
  "{{{{/",
  "{{~",
  "~}}",
  "{{#",
  "{{/",
  "{{^",
  "{{else",
  "{{else}}",
  "{{^}}",
  "{{>",
  "{{#>",
  "{{*",
  "{{#*",
  "{{&",
  "{{!",
  "{{!--",
  "--}}",
  "{{#if a}}",
  "{{/if}}",
  "{{else if b}}",
  "<",
  ">",
  "/>",
  "</",
  "<!",
  "<!--",
  "-->",
  "<!---",
  "--->",
  "<!-->",
  "<!DOCTYPE",
  "<!doctype html>",
  " PUBLIC",
  " SYSTEM",
  ' PUBLIC "a"',
  ' "b"',
  "<?",
  "<3",
  "< ",
  "(",
  ")",
  "[",
  "]",
  "\\]",
  "|",
  " as |",
  " as |a|",
  "as",
  "=",
  ".",
  "..",
  "../",
  "./",
  "/",
  ".#",
  "@",
  "~",
  "\\",
  "\\\\",
  "\\{{",
  "\\\\{{",
  '"',
  "'",
  '\\"',
  "\\'",
  "\0",
  " ",
  " ",
  "﻿",
  " ",
  "...attributes",
  "{{...attributes}}",
  "this",
  "this.",
  "this/",
  "a=b",
  "(a=b)",
  "{{! prettier-ignore }}",
  "{{!-- prettier-ignore --}}",
  "---\n",
  "---\na: b\n---\n",
  "+++\n",
  "<pre>",
  "</pre>",
  "<style>",
  "</style>",
  "a{b:c}",
];

const seeds: string[] = [];
(function walk(paths: string[]) {
  for (const path of paths) {
    if (statSync(path).isDirectory())
      walk(
        readdirSync(path)
          .filter(it => it !== "__snapshots__")
          .map(it => join(path, it)),
      );
    else if (/\.(hbs|handlebars)$/.test(path)) seeds.push(readFileSync(path, "utf8"));
  }
})(args.filter(it => !it.startsWith("-")));

const token = /\{\{\{?~?[#/^&!>*]?|~?\}\}\}?|<\/?[\w:@.-]*|\/?>|"[^"\n]*"|'[^'\n]*'|[\w@.-]+|\s+|[^]/g;
function mutate(): string {
  let all = pick(seeds).match(token) ?? [];
  if (all.length > 400) {
    const start = random(all.length - 300);
    all = all.slice(start, start + 300);
  }
  for (let changes = 1 + random(3); changes > 0 && all.length > 0; changes--) {
    const [at, kind] = [random(all.length), random(6)];
    if (kind === 0) all.splice(at, 1 + random(3));
    else if (kind === 1) all.splice(at, 0, all[at]);
    else if (kind === 2) all.splice(at, 0, pick(pieces));
    else if (kind === 3) all[at] = pick(pieces);
    else if (kind === 4) all.splice(at, 0, ...all.splice(random(all.length), 1 + random(3)));
    else all[at] = pick(all);
  }
  return all.join("");
}

const directory = mkdtempSync(join(flag("out", "."), `handlebars-${mode}-`));
for (let i = 0; i < count; i++) {
  const template = mode === "grammar" ? children(0) : mode === "mutate" ? mutate() : many(12, () => pick(pieces));
  writeFileSync(join(directory, `${i}.hbs`), template);
}
console.log(directory);
