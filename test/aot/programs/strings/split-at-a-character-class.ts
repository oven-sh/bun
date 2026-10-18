// text.split(/\s+/), /,/, /[;,]/, /[^a-z0-9]+/, /\W/ ..: a literal that is one character or one class, once or repeated: the pieces, and what RegExp's legacy static properties say afterwards, are those of plain Bun for Latin-1 and for wide texts; so are the patterns next to that form, limits, and literals that were changed.
const statics = RegExp as unknown as Record<string, string>;
function seen(): string {
  return [statics.lastMatch, statics.input, statics.leftContext, statics.rightContext].map(text => JSON.stringify(text)).join();
}
function show(name: string, pieces: string[]) {
  console.log(name, pieces.length, JSON.stringify(pieces), seen());
}
const texts: string[] = [
  "",
  " ",
  "a",
  "one two  three\tfour\nfive",
  "  leading and trailing  ",
  "a,b;c,,d;",
  ",",
  ",,",
  "no-separator-at-all",
  "café au lait, s'il vous plaît",
  "東京 大阪　名古屋 x y z﻿w v u t",
  "wide 😀 pairs \ud83d and\ude00 halves",
  "x1y22z333",
  "A-B_C.D/E\\F]G[H^I",
  "tab\tcr\rlf\nff\fvt\vend",
  "UPPER lower 0123 _under",
];
function joined(first: string, second: string): string {
  return first + "|" + second;
}
for (const text of texts) {
  show("spaces", text.split(/\s+/));
  show("one space", text.split(/\s/));
  show("not spaces", text.split(/\S+/));
  show("comma", text.split(/,/));
  show("commas", text.split(/,+/));
  show("either", text.split(/[;,]/));
  show("either, repeated", text.split(/[;,]+/));
  show("digits", text.split(/\d+/));
  show("not digits", text.split(/\D+/));
  show("word", text.split(/\w/));
  show("not word", text.split(/\W+/));
  show("not in ranges", text.split(/[^a-z0-9]+/));
  show("ranges", text.split(/[A-Fx-z]/));
  show("escaped in a class", text.split(/[\]\[\\\^\-\/.]/));
  show("escaped", text.split(/\./));
  show("classes in a class", text.split(/[\s,;]+/));
  show("negated classes in a class", text.split(/[^\s\d]+/));
  show("not spaces in a class", text.split(/[\S]/));
  show("controls", text.split(/[\t\r\n\f\v]+/));
  show("a rope", joined(text, text).split(/\s+/));
  show("a slice", joined(text, text).slice(1, -1).split(/[|,]/));
}
for (const text of texts) {
  show("with a limit", text.split(/\s+/, 2));
  show("limit zero", text.split(/\s+/, 0));
  show("two terms", text.split(/,\s*/));
  show("may be empty", text.split(/\s*/));
  show("lazy", text.split(/\s+?/));
  show("counted", text.split(/\s{2}/));
  show("a group", text.split(/(\s+)/));
  show("alternatives", text.split(/,|;/));
  show("any character", text.split(/./));
  show("ignoring case", text.split(/[a-f]+/i));
  show("unicode", text.split(/\s+/u));
  show("global", text.split(/\s+/g));
  show("anchored", text.split(/^\s/));
  show("a wide character", text.split(/　/));
  show("a wide character in a class", text.split(/[　 ]+/));
  show("a range of other characters", text.split(/[ -,]+/));
  show("a dash at the end", text.split(/[a-]/));
  show("a hexadecimal escape", text.split(/\x20+/));
  show("a word boundary", text.split(/\b/));
}
function changed(text: string): string[] {
  const spaces = /\s+/;
  (spaces as unknown as { exec: unknown }).exec = () => null;
  return text.split(spaces);
}
show("exec of its own", changed("one two"));
function kept(text: string): string[] {
  const spaces = /\s+/;
  spaces.lastIndex = 3;
  const pieces = text.split(spaces);
  pieces.push(String(spaces.lastIndex));
  return pieces;
}
show("lastIndex is left alone", kept("one two three"));
let total = 0;
for (let round = 0; round < 3000; round++) {
  const words = ("round " + round + "  of\tmany é" + (round % 7 ? "" : " 東京")).split(/\s+/);
  total += words.length + words[1].length;
}
console.log("rounds", total);
const long = "word ".repeat(300_000);
console.log("long", long.split(/\s+/).length, long.split(/\s/).length);
