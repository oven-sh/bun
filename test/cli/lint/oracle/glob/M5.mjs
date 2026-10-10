// M5: the 14 POSIX classes of minimatch, plain and negated, against characters beyond ASCII. The reference has the general categories of Unicode
// (`\p{L}`, `\p{Nl}`, `\p{Nd}`, `\p{P}`, `\p{Z}`, `\p{C}`, `\p{Ll}`, `\p{Lu}`, `\p{Pc}`), `src/glob` what `core` of Rust has. ASCII: all 128, which have to be exact.
// Every code point up to U+2FFF, every 7th up to U+FFFF, every 101st beyond.
import { J, require } from "./refs.mjs";
const { Minimatch } = require(J + "minimatch");
const NAMES = [
  "alnum",
  "alpha",
  "ascii",
  "blank",
  "cntrl",
  "digit",
  "graph",
  "lower",
  "print",
  "punct",
  "space",
  "upper",
  "word",
  "xdigit",
];
export function* cases() {
  const points = [];
  for (let c = 1; c < 0x3000; c++) points.push(c);
  for (let c = 0x3000; c < 0x10000; c += 7) points.push(c);
  for (let c = 0x10000; c < 0x110000; c += 101) points.push(c);
  for (const name of NAMES)
    for (const pattern of [`[[:${name}:]]`, `[![:${name}:]]`]) {
      const m = new Minimatch(pattern, { dot: true });
      for (const c of points) {
        if (c === 47 || (c >= 0xd800 && c <= 0xdfff)) continue;
        const path = String.fromCodePoint(c);
        yield { it: { mode: "minimatch", pattern, path }, want: m.match(path) };
      }
    }
}
export const explain = it => (it.path.codePointAt(0) < 128 ? null : `${it.pattern.replace("!", "")} beyond ASCII`);
