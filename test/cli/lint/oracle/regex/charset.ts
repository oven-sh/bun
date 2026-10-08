// For patterns that match one character, compares the set of all characters that match with that of the `RegExp` of the Bun, or the Node.js, that
// runs this script: every property of `\p{..}`, the escapes, and classes, with and without the `i`, `u` and `v` flags.
//
//   bun|node test/cli/lint/oracle/regex/charset.ts <bun-lint> <regexpp checkout> [--classes=n] [--seed=n]
//
// Known differences, where the other engine and the specification agree with bun-lint:
// - JavaScriptCore, `i` without `u` and `v`: it does not know the pairs of letters that Unicode 16 added (U+019B and U+A7DC, ..).
// - V8, `\P{ASCII}` and `[^\p{ASCII}]` with `iv`: it matches U+017F and U+212A, which are `s` and `k` when case is ignored.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ask, hex } from "./common.ts";

const [binary, regexpp] = process.argv.slice(2);
const flag = (name: string, fallback: number) =>
  Number(process.argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
let seed = flag("seed", 1);

function random(n: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
}
const pick = <T>(list: readonly T[]): T => list[random(list.length)];

const source = readFileSync(join(regexpp, "src/unicode/properties.ts"), "utf8");
function names(set: string): string[] {
  const start = source.indexOf(`const ${set} = new DataSet(`);
  return [...source.slice(start, source.indexOf("\n)", start)).matchAll(/"([^"]*)"/g)].flatMap(m => m[1].split(" ").filter(Boolean));
}

const cases: [string, string][] = [];
for (const name of names("gcValueSets")) cases.push([`\\p{${name}}`, "u"], [`\\p{gc=${name}}`, "u"], [`\\P{General_Category=${name}}`, "iu"], [`\\P{${name}}`, "iv"]);
for (const name of names("scValueSets")) cases.push([`\\p{sc=${name}}`, "u"], [`\\p{Script_Extensions=${name}}`, "u"], [`\\p{scx=${name}}`, "iv"]);
for (const name of names("binPropertySets")) cases.push([`\\p{${name}}`, "u"], [`\\P{${name}}`, "u"], [`\\p{${name}}`, "iu"], [`\\P{${name}}`, "iu"], [`[^\\P{${name}}]`, "iu"], [`\\P{${name}}`, "iv"], [`[^\\p{${name}}]`, "iv"]);
for (const flags of ["", "i", "u", "iu", "v", "iv", "s", "su"]) {
  for (const pattern of [".", "\\d", "\\D", "\\w", "\\W", "\\s", "\\S", "[^\\W]", "[^\\w]", "[\\W\\d]", "[^]", "[]", "[a-z]", "[^a-z]", "[A-Z]", "k", "K", "s", "\\u212a", "\\u017f", "[\\u0100-\\uffff]", "[^\\u0100-\\uffff]", "\\ud83d", "\\udca9", "[\\ud800-\\udfff]", "ß", "\\u1e9e", "σ", "\\u0130", "\\u0131", "i", "I", "\\u01c5", "\\u0345", "\\u1fd3", "\\ufb05"]) {
    cases.push([pattern, flags]);
  }
}
for (let i = flag("classes", 300); i > 0; i--) {
  const flags = pick(["", "i", "u", "iu", "v", "iv"]);
  const unicode = flags !== "" && flags !== "i";
  const escape = (cp: number) => (cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, "0")}`);
  const limit = unicode ? 0x10ffff : 0xffff;
  const point = () => pick([random(0x80), random(0x250), 0x370 + random(0x200), random(0x3000), 0x1e00 + random(0x200), 0x2100 + random(0x100), 0xa640 + random(0x200), random(limit + 1), unicode ? 0x10400 + random(0x100) : 0xff21 + random(0x40)]);
  const item = (): string => {
    switch (random(4)) {
      case 0:
        return escape(point());
      case 1:
        return pick(["\\d", "\\D", "\\w", "\\W", "\\s", "\\S", ...(unicode ? ["\\p{Lu}", "\\p{Ll}", "\\P{Ll}", "\\p{L}", "\\p{Greek}".replace("Greek", "sc=Greek"), "\\p{Cased}", "\\P{Alphabetic}"] : [])]);
      default: {
        const [a, b] = [point(), point()].sort((x, y) => x - y);
        return `${escape(a)}-${escape(b)}`;
      }
    }
  };
  const union = () => Array.from({ length: 1 + random(3) }, item).join("");
  let pattern = `[${pick(["", "^"])}${union()}]`;
  if (flags.includes("v") && random(2)) pattern = `[${pick(["", "^"])}[${pick(["", "^"])}${union()}]${pick(["&&", "--"])}[${pick(["", "^"])}${union()}]]`;
  cases.push([pattern, flags]);
}

function expected(pattern: string, flags: string): string | null {
  let regex: RegExp;
  try {
    regex = new RegExp(`^(?:${pattern})$`, flags);
  } catch {
    return null;
  }
  const limit = /[uv]/.test(flags) ? 0x10ffff : 0xffff;
  const out: string[] = [];
  let start = -1;
  for (let cp = 0; cp <= limit + 1; cp++) {
    const inside = cp <= limit && regex.test(String.fromCodePoint(cp));
    if (inside && start < 0) start = cp;
    if (!inside && start >= 0) {
      out.push(`${start.toString(16)}-${(cp - 1).toString(16)}`);
      start = -1;
    }
  }
  return out.join(" ");
}

const answers = ask(
  binary,
  "charset",
  cases.map(([pattern, flags]) => [hex(pattern), hex(flags)]),
);
let failed = 0;
let skipped = 0;
cases.forEach(([pattern, flags], i) => {
  const wanted = expected(pattern, flags);
  const actual = answers[i]?.error ? null : answers[i];
  if (wanted === null && actual === null) return void skipped++;
  if (actual === wanted) return;
  if (++failed > 30) return;
  console.log(`/${pattern}/${flags}`);
  const [a, w] = [new Set((actual ?? "error").split(" ")), new Set((wanted ?? "error").split(" "))];
  console.log(`  only here      ${[...a].filter(r => !w.has(r)).slice(0, 12).join(" ")}`);
  console.log(`  only in RegExp ${[...w].filter(r => !a.has(r)).slice(0, 12).join(" ")}`);
});
console.log(`${cases.length - failed - skipped} of ${cases.length - skipped} as RegExp (${skipped} that neither knows)`);
process.exit(failed ? 1 : 0);
