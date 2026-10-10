// `PatternMatcher` of `@eslint-community/eslint-utils`, in the format of `bun-lint utils-eslint pattern`.
//
//   ESLINT_DIR=<eslint checkout> node pattern.ts --cases > cases.jsonl     the cases
//   ESLINT_DIR=<eslint checkout> node pattern.ts cases.jsonl > expected    one line a case
//
// Indices are in bytes of UTF-8.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

if (process.argv[2] === "--cases") {
  const patterns = [
    ["foo", "gu"],
    ["(\\w)(\\d)", "gu"],
    ["[a-c]", "gu"],
    ["a(b)", "gu"],
    ["(a)|(b)", "g"],
    ["(?<x>a)(b)?", "g"],
    ["\\$\\{", "gu"],
    ["é|😀", "gu"],
    ["(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)", "g"],
  ];
  const texts = String.raw`||abc|\foo|\\\foo|\a\foo|foo|\\foo|\\\\foo|-foofoofooabcfoo-|-foo\foofooabcfoo-|ab0c|a1b2c3|1\a2\b3|1a2\b3|a\bc|${"${a} \\${b} \\\\${c}"}|é\é😀\😀\\😀|abcdefghijkl|\abcdefghijk abcdefghijk`.split("|");
  const replacements = ["xyz", "x", "$$x", "$$&", "$$$&", "$&", "$'$`", "$0", "$1", "$2", "[$1$2]", "$10", "$11", "$12", "$99", "$", "$$", "a$", "$<x>", "$01"];
  for (const [pattern, flags] of patterns) {
    for (const text of texts) {
      for (const escaped of [false, true]) {
        for (const replacement of replacements) console.log(JSON.stringify({ pattern, flags, escaped, text, replacement }));
      }
    }
  }
} else {
  const { PatternMatcher } = createRequire(join(process.env.ESLINT_DIR!, "package.json"))("@eslint-community/eslint-utils");
  const quote = (text: string | undefined) =>
    text === undefined ? "none" : `"${text.replace(/[^ !#-[\]-~]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
  for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
    if (!line) continue;
    const it = JSON.parse(line);
    const matcher = new PatternMatcher(new RegExp(it.pattern, it.flags), { escaped: it.escaped });
    let out = "";
    for (const found of matcher.execAll(it.text)) {
      out += `${Buffer.byteLength(it.text.slice(0, found.index))}:${[...found].map(quote).join("")} `;
    }
    console.log(`${out}${matcher.test(it.text)} ${quote(it.text.replace(matcher, it.replacement))}`);
  }
}
