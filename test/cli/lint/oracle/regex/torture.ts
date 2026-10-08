// Gives `bun-lint regex raw` patterns and text that are not valid UTF-8, or not valid at all. There is nothing to compare with: it
// must not panic and it must end.
//
//   bun|node test/cli/lint/oracle/regex/torture.ts <bun-lint> [--count=n] [--seed=n]

import { pick, random, setSeed } from "./cases.ts";
import { ask } from "./common.ts";

const [binary, ...rest] = process.argv.slice(2);
const flag = (name: string, fallback: number) => Number(rest.find(a => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
setSeed(flag("seed", 1));

const encoder = new TextEncoder();
const PIECES = [
  ..."()[]{}|^$.*+?\\-&=!<>:,/0129abckpPqudDsSwWbBxiv_~",
  "(?:", "(?=", "(?!", "(?<=", "(?<!", "(?<a>", "\\k<a>", "\\1", "(?i:", "\\p{L}", "\\P{Lu}", "\\p{RGI_Emoji}", "\\q{", "&&", "--", "[^", "\\u{1f4a9}", "\\ud83d", "{2,}", "{0,2}?",
  "\u{1f4a9}", "é", " ", "ſ",
].map(piece => [...encoder.encode(piece)]);
const BROKEN = [[0x80], [0xbf], [0xc0], [0xc2], [0xe2, 0x80], [0xed, 0xa0, 0xbd], [0xed, 0xb2, 0xa9], [0xf0], [0xf0, 0x9f], [0xf0, 0x9f, 0x92], [0xf4, 0x90, 0x80, 0x80], [0xf8], [0xff], [0x9f, 0x92, 0xa9]];

function bytes(length: number, broken: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) out.push(...(random(broken) === 0 ? pick(BROKEN) : pick(PIECES)));
  return out;
}
const hex = (list: number[]) => list.map(byte => byte.toString(16).padStart(2, "0")).join("");

const requests: string[][] = [];
for (let i = flag("count", 100000); i > 0; i--) {
  const flags = pick(["", "u", "v", "i", "iu", "iv", "g", "y", "ms", "x", "uv", "gg"]);
  requests.push([hex(bytes(1 + random(10), 6)), hex([...encoder.encode(flags)]), hex(bytes(random(10), 3))]);
}
// Nesting and sizes that recursion could not take.
for (const [open, close] of [["(", ")"], ["(?:", ")"], ["(?=", ")"], ["(?<=", ")"], ["[", "]"], ["(?:a|", ")*"], ["(", ")+"]]) {
  for (const depth of [100, 249, 250, 251, 5000, 200000]) {
    for (const flags of ["", "v"]) {
      requests.push([hex([...encoder.encode(open.repeat(depth) + "a" + close.repeat(depth))]), hex([...encoder.encode(flags)]), hex([97, 97])]);
      requests.push([hex([...encoder.encode(open.repeat(depth))]), hex([...encoder.encode(flags)]), hex([97])]);
    }
  }
}
const answers = ask(binary, "raw", requests);
console.log(`${answers.filter(answer => answer === true).length} of ${requests.length} survived`);
