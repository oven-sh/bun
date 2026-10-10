// Compares `Selector::parse` and `Selector::compare` with ESLint's `lib/linter/esquery.js`.
//
//   bun parse.ts <eslint> <bun-lint> <scratch dir> [--count=n] [--seed=n] [<dir with sources to take strings from>..]
//
// The selectors are the string literals in the sources that esquery accepts and that have some punctuation in them, and
// `count` mutations of those. For each: the same error message, or none. For all that are valid: the same order.
import { Glob } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => args.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const [eslintPath, binary, scratch, ...sources] = args.filter(it => !it.startsWith("--"));
const count = Number(flag("count") ?? 200_000);
let state = Number(flag("seed") ?? 1);
const random = (n: number) => ((state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) >>> 8) % n;

const { parse } = require(resolve(eslintPath, "lib/linter/esquery.js"));

const SIMPLE_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };

/// The value of the string literal with `body` between its quotes.
function unescape(body: string): string {
  return body.replace(
    /\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|u\{([0-9a-fA-F]{1,6})\}|(\r\n|[\s\S]))/g,
    (whole, hex2, hex4, braced, other) => {
      const digits = hex2 ?? hex4 ?? braced;
      if (digits !== undefined) {
        const code = parseInt(digits, 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      // A line continuation.
      if (/^[\r\n\u2028\u2029]/.test(other)) return "";
      return SIMPLE_ESCAPES[other] ?? other;
    },
  );
}

const strings = new Set<string>();
for (const root of sources) {
  for (const path of new Glob("**/*.{js,ts}").scanSync(root)) {
    if (path.includes("node_modules/")) continue;
    for (const [, , body] of readFileSync(join(root, path), "utf8").matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      strings.add(unescape(body));
    }
  }
}

const CLASSES = new Set(["statement", "declaration", "pattern", "expression", "function"]);
function unknownClass(selector: any): string | undefined {
  if (selector === null || typeof selector !== "object") return;
  if (selector.type === "class" && !CLASSES.has(selector.name.toLowerCase())) return selector.name;
  for (const key of ["left", "right"]) {
    const found = unknownClass(selector[key]);
    if (found !== undefined) return found;
  }
  for (const it of selector.selectors ?? []) {
    const found = unknownClass(it);
    if (found !== undefined) return found;
  }
}

type Expected = { parsed: any } | { error: string };
function expected(source: string): Expected {
  try {
    const parsed = parse(source);
    const name = unknownClass(parsed.root);
    return name === undefined ? { parsed } : { error: `Unknown class name: ${name}` };
  } catch (error: any) {
    return { error: String(error.message) };
  }
}

const seeds = [...strings].filter(it => it.length < 150 && /[[\]:>~+!*.]/.test(it) && "parsed" in expected(it));
const alphabet = [..." [],():#!=><~+.*/\\\"'ab1-$|\n\t\u00e9\u{1F4A9}"].concat(
  ["type(", ":not(", ":has(", ":is(", ":matches(", ":nth-child(", ":nth-last-child(", ":first-child", ":last-child", ":exit"],
  [":function", ":statement", "Identifier", "[a=1]", "/a/i", "/[/]/", ".5", "'\\n'"],
);
const selectors = new Set<string>([...strings].filter(it => it.length < 300));
for (let i = 0; i < count; i++) {
  let it = [...seeds[random(seeds.length)]];
  for (let edits = 1 + random(3); edits > 0; edits--) {
    const at = random(it.length + 1);
    const piece = alphabet[random(alphabet.length)];
    it.splice(at, random(3) === 0 ? 0 : 1, ...(random(3) === 1 ? [] : [piece]));
  }
  selectors.add(it.join(""));
}
const all = [...selectors].filter(it => it.isWellFormed());

const input = join(scratch, "selectors.json");
writeFileSync(input, JSON.stringify(all));
const run = Bun.spawnSync([binary, "selector", "parse", input], { maxBuffer: 1 << 30 } as any);
const lines = run.stdout.toString().split("\n").filter(Boolean).map(it => JSON.parse(it));

let different = 0, valid = 0, syntaxErrors = 0, engine = 0;
const parsed: [number, any][] = [];
all.forEach((source, i) => {
  const [want, got] = [expected(source), lines[i]];
  let same: boolean;
  if ("parsed" in want && got.error?.startsWith("Invalid regular expression")) {
    // JavaScriptCore accepts some that the specification does not.
    engine++;
    same = true;
  } else if ("parsed" in want) {
    valid++;
    parsed.push([i, want.parsed]);
    same = got.error === undefined && got.exit === want.parsed.isExit;
  } else if (/^(Syntax error in selector|Unknown class name)/.test(want.error)) {
    syntaxErrors++;
    same = got.error === want.error;
  } else {
    // What the engine says about a regular expression, or about `undefined`.
    same = got.error !== undefined;
  }
  if (!same && different++ < 20) console.log("DIFFERENT", JSON.stringify(source), "\n  expected", want, "\n  actual  ", got);
});
const order = parsed.sort((a, b) => a[1].compare(b[1])).map(it => it[0]);
const isSameOrder = JSON.stringify(order) === JSON.stringify(lines[all.length].order);
console.log(`${all.length} selectors: ${valid} valid, ${syntaxErrors} with a message to compare, ${engine} that only the engine accepts, ${different} different; order ${isSameOrder ? "same" : "DIFFERENT"}`);
process.exit(different > 0 || !isSameOrder ? 1 : 0);
