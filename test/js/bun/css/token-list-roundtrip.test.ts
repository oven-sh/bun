// Seeded round-trip test of CSS token lists. A token list is a value whose grammar the parser
// does not know, so it must print with the tokens it was written with. Replay a failure with
// BUN_CSS_TOKEN_FUZZ_SEED=<seed> (and BUN_CSS_TOKEN_FUZZ_ITERS for a soak).
import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

const { _test, minifyTest, canonicalTest } = cssInternals;

const DEFAULT_SEED = 0x746f6b73;
const SEED =
  process.env.BUN_CSS_TOKEN_FUZZ_SEED !== undefined ? Number(process.env.BUN_CSS_TOKEN_FUZZ_SEED) >>> 0 : DEFAULT_SEED;
const ITERS = (() => {
  const n = Number(process.env.BUN_CSS_TOKEN_FUZZ_ITERS) | 0;
  return n > 0 ? n : 150;
})();

class Rng {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0;
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

// Text that prints as it is written, whatever is next to it. No numbers, hashes, colors or
// url(): the printer gives those its own spelling. No `!`, `;`, `{` or `}`: they end the value.
const IDENTS = ["a", "b", "foo", "bar-baz", "x1", "_y"] as const;
const DELIMS = [".", "*", ">", "~", "+", "-", "|", "=", "&", "%", "^", "$", "?", "<", "@", "/", ":", ","] as const;
const OTHER = ['"s"', '"a b"', "var(--v)"] as const;
const SPACES = [" ", " ", " ", "  ", "\n", "\t", "\n    ", "\r\n"] as const;
const COMMENTS = ["/**/", "/* c */", "/* a\n b */"] as const;

type Part = { text: string; kind: "atom" | "space" | "comment" };

function genParts(rng: Rng, depth: number): Part[] {
  const parts: Part[] = [];
  const atom = (text: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === "atom") {
      // `/` then `*` opens a comment, and a name then `(` is a function, whose arguments
      // lose the blank at each end.
      const opensComment = last.text.endsWith("/") && text.startsWith("*");
      const makesFunction = text === "(" && /[A-Za-z0-9_-]$/.test(last.text);
      if (opensComment || makesFunction) parts.push({ text: " ", kind: "space" });
    }
    parts.push({ text, kind: "atom" });
  };
  const count = 1 + rng.int(7);
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      // Zero, one or two pieces of whitespace and comments between two atoms.
      for (let n = rng.int(3); n > 0; n--) {
        if (rng.chance(0.7)) parts.push({ text: rng.pick(SPACES), kind: "space" });
        else parts.push({ text: rng.pick(COMMENTS), kind: "comment" });
      }
    }
    const roll = rng.int(10);
    if (roll < 4) atom(rng.pick(IDENTS));
    else if (roll < 8) atom(rng.pick(DELIMS));
    else if (roll < 9 || depth >= 2) atom(rng.pick(OTHER));
    else {
      const [open, close] = rng.pick([
        ["(", ")"],
        ["[", "]"],
      ] as const);
      atom(open);
      if (rng.chance(0.3)) parts.push({ text: rng.pick(SPACES), kind: "space" });
      for (const inner of genParts(rng, depth + 1)) {
        if (inner.kind === "atom") atom(inner.text);
        else parts.push(inner);
      }
      if (rng.chance(0.3)) parts.push({ text: rng.pick(SPACES), kind: "space" });
      atom(close);
    }
  }
  return parts;
}

const asWritten = (parts: Part[]) =>
  parts
    .map(p => p.text)
    .join("")
    .replaceAll("\r\n", "\n");

// One separator for each run of whitespace and comments: a blank if the run holds whitespace,
// an empty comment if it holds only comments. `canonical` is the print that `bun pm diff`
// compares: there the blank next to a comma has one form too.
function collapsed(parts: Part[], canonical: boolean): string {
  let out = "";
  for (let i = 0; i < parts.length;) {
    const part = parts[i];
    if (part.kind === "atom") {
      out += part.text;
      if (canonical && part.text === "," && i + 1 < parts.length) out += " ";
      i++;
      continue;
    }
    let end = i;
    let hasSpace = false;
    while (parts[end].kind !== "atom") {
      hasSpace ||= parts[end].kind === "space";
      end++;
    }
    const nextToComma = parts[i - 1].text === "," || parts[end].text === ",";
    if (!(canonical && nextToComma)) out += hasSpace ? " " : "/**/";
    i = end;
  }
  return out;
}

// [name, the tokens before the generated ones, the source and its outputs for a value `v`]
type Frame = (v: string) => [source: string, normal: string, minified: string];
const frames: [string, Part[], Frame][] = [
  ["a custom property", [], v => [`.c { --x: ${v}; }`, `.c {\n  --x: ${v};\n}\n`, `.c{--x:${v}}`]],
  ["an unknown property", [], v => [`.c { foo-bar: ${v}; }`, `.c {\n  foo-bar: ${v};\n}\n`, `.c{foo-bar:${v}}`]],
  [
    "a known property with var()",
    [
      { text: "var(--m)", kind: "atom" },
      { text: " ", kind: "space" },
    ],
    v => [`.c { margin: ${v}; }`, `.c {\n  margin: ${v};\n}\n`, `.c{margin:${v}}`],
  ],
  ["the prelude of an unknown at-rule", [], v => [`@foo ${v};`, `@foo ${v};\n`, `@foo ${v};`]],
  [
    "the arguments of an unknown pseudo-class",
    [],
    v => [`.c:foo(${v}) { color: red }`, `.c:foo(${v}) {\n  color: red;\n}\n`, `.c:foo(${v}){color:red}`],
  ],
];

for (const [index, [name, before, frame]] of frames.entries()) {
  // Runs `check` on each generated value and collects what it reports, up to three.
  const failures = (check: (parts: Part[], source: string) => object | undefined) => {
    const rng = new Rng(SEED + index);
    const found: object[] = [];
    for (let iteration = 0; iteration < ITERS && found.length < 3; iteration++) {
      const parts = before.concat(genParts(rng, 0));
      const source = frame(parts.map(p => p.text).join(""))[0];
      const failure = check(parts, source);
      if (failure) found.push({ seed: SEED, iteration, source, ...failure });
    }
    return found;
  };

  test(`${name} prints with the tokens it was written with`, () => {
    expect(
      failures((parts, source) => {
        const expected = { default: frame(asWritten(parts))[1], minified: frame(collapsed(parts, false))[2] };
        const actual = { default: _test(source, ""), minified: minifyTest(source, "") };
        // Each output, printed again in the mode that made it, must not change.
        const again = { default: _test(actual.default, ""), minified: minifyTest(actual.minified, "") };
        if (!Bun.deepEquals(actual, expected) || !Bun.deepEquals(again, expected)) return { expected, actual, again };
      }),
    ).toEqual([]);
  });

  test(`${name} has one form in the print that bun pm diff compares`, () => {
    expect(
      failures((parts, source) => {
        const expected = frame(collapsed(parts, true))[1];
        const actual = canonicalTest(source, "");
        const again = canonicalTest(actual, "");
        if (actual !== expected || again !== expected) return { expected, actual, again };
      }),
    ).toEqual([]);
  });
}
