// Compares what the properties of strings (`\p{RGI_Emoji}`, ..) match with the `RegExp` of the Bun, or the Node.js, that runs this
// script, in text made of sequences of emoji, valid and not.
//
//   bun|node test/cli/lint/oracle/regex/emoji.ts <bun-lint> [<ucd>/emoji-zwj-sequences.txt]

import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { ask, hex } from "./common.ts";

const [binary, zwj] = process.argv.slice(2);
const NAMES = ["Basic_Emoji", "Emoji_Keycap_Sequence", "RGI_Emoji", "RGI_Emoji_Flag_Sequence", "RGI_Emoji_Modifier_Sequence", "RGI_Emoji_Tag_Sequence", "RGI_Emoji_ZWJ_Sequence"];

const sequences: string[] = [];
for (let cp = 0; cp <= 0x1ffff; cp++) {
  const c = String.fromCodePoint(cp);
  if (!/\p{Emoji}/u.test(c)) continue;
  sequences.push(c, `${c}\u{fe0f}`, `${c}\u{fe0f}\u{20e3}`, `${c}\u{1f3fb}`, `${c}\u{1f3ff}`, `${c}\u{200d}\u{2640}\u{fe0f}`, `${c}\u{1f3fd}\u{200d}\u{1f680}`);
}
for (let a = 0x1f1e6; a <= 0x1f1ff; a++) for (let b = 0x1f1e6; b <= 0x1f1ff; b++) sequences.push(String.fromCodePoint(a, b));
for (const tag of ["gbeng", "gbsct", "gbwls", "gbxxx", "gb"]) {
  sequences.push(String.fromCodePoint(0x1f3f4, ...[...tag].map(c => 0xe0000 + c.charCodeAt(0)), 0xe007f));
}
if (zwj) {
  for (const line of readFileSync(zwj, "utf8").split("\n")) {
    const field = line.split(/[;#]/)[0].trim();
    if (!field) continue;
    const text = String.fromCodePoint(...field.split(/\s+/).map(digits => parseInt(digits, 16)));
    sequences.push(text, text.slice(0, -1), [...text].slice(0, -1).join(""));
  }
}

const requests: [string, string, string, string][] = [];
for (let i = 0; i < sequences.length; i += 200) {
  const text = sequences.slice(i, i + 200).join(" ");
  for (const name of NAMES) {
    requests.push(["matchAll", `\\p{${name}}`, "v", text]);
    requests.push(["matchAll", `[\\p{${name}}--\\p{Basic_Emoji}]`, "v", text]);
    requests.push(["matchAll", `[\\p{${name}}&&[\\p{RGI_Emoji_ZWJ_Sequence}\\q{#|a}]]`, "iv", text]);
  }
}
const answers = ask(
  binary,
  "ops",
  requests.map(([op, ...strings]) => [op, ...strings.map(hex)]),
);
let failed = 0;
requests.forEach(([, pattern, flags, text], i) => {
  const wanted = [...text.matchAll(new RegExp(pattern, `${flags}dg`))].map((m: any) => [...m.indices]);
  if (isDeepStrictEqual(answers[i], wanted)) return;
  if (++failed > 10) return;
  const at = wanted.findIndex((m, k) => !isDeepStrictEqual(m, answers[i][k]));
  console.log(`/${pattern}/${flags}: match ${at} is ${JSON.stringify(answers[i][at])}, not ${JSON.stringify(wanted[at])}`);
});
console.log(`${requests.length - failed} of ${requests.length} as RegExp, with ${sequences.length} sequences`);
process.exit(failed ? 1 : 0);
