// codePointAt and charCodeAt at every kind of unit and position: below the surrogates, lead and trail surrogates in and out of pairs, the units above them, and positions that lie outside the text.
const lines: string[] = [];
const texts = [
  "", "a", "plain ascii text", "café ÿ", "Ā߿ࠀ퟿", "퟿𐀀", "\ud800", "\udc00", "􏿿", "\ud800𐀀", "\udc00\ud800",
  "a😀b", "\ud83d", "x\ud83d", "\ude00x", "﻿Ａ�￿", "퟿", "\ud800a", "a\udfff", "\ud800", "\udbff퟿",
];
const positions: number[] = [0, 1, 2, 3, 4, 5, 16, -1, -2, -2147483648, 2147483647, 2147483648, 4294967295, 4294967296, -4294967296, 0.5, 1.9, -0.5, -0, NaN, Infinity, -Infinity, 1e21];
function point(text: string, position: number) { return text.codePointAt(position); }
function unit(text: string, position: number) { return text.charCodeAt(position); }
function pointOfAnything(text: any, position: any) { return text.codePointAt(position); }
for (const text of texts) {
  const row: string[] = [];
  for (const position of positions) row.push(String(point(text, position)) + "|" + String(unit(text, position)) + "|" + String(pointOfAnything(text, position)));
  lines.push(JSON.stringify(text) + " " + row.join(" "));
}
// A walk by code points, as a scanner does it.
function walk(text: string) {
  const found: number[] = [];
  let position = 0;
  while (position < text.length) {
    const ch = text.codePointAt(position)!;
    found.push(ch);
    position += ch >= 0x10000 ? 2 : 1;
  }
  return found.map(c => c.toString(16)).join();
}
for (const text of texts) lines.push("walk " + walk(text));
// Backwards from a position that runs below zero.
function backwards(text: string) { let sum = 0, missing = 0; for (let i = text.length + 1; i >= -3; i--) { const c = text.codePointAt(i); if (c === undefined) missing++; else sum += c; } return sum + " " + missing; }
for (const text of texts) lines.push("backwards " + backwards(text));
// Ropes and pieces of other texts.
const seed = String(process.argv.length);
const rope = "left " + seed + "\ud83d" + ("\ude00" + seed) + " rightＡ";
lines.push("rope " + walk(rope) + " " + point(rope, 6 + seed.length - 1) + " " + point(rope, -1) + " " + point(rope, rope.length));
const piece = ("0123456789😀tail" + seed).slice(9, 14);
lines.push("piece " + walk(piece) + " " + point(piece, 1) + " " + point(piece, 2) + " " + point(piece, 5) + " " + unit(piece, -1));
const rounds = Number(process.argv[2] ?? 200);
let total = 0;
for (let r = 0; r < rounds; r++) for (const text of texts) for (let i = -1; i <= text.length; i++) total += (text.codePointAt(i) ?? 1) + (text.charCodeAt(i) || 2);
lines.push("total " + total);
console.log(lines.join("\n"));
