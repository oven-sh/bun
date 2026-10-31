// Seeded differential fuzz of Bun.Glob#match against picomatch. Replay a
// failure with BUN_GLOB_FUZZ_SEED=<seed>; soak with BUN_GLOB_FUZZ_ITERS=<n>.
//
// The generator only emits the dialect both matchers define identically. Each
// exclusion below is a documented difference between the two dialects, so it is
// kept out of the generator rather than tolerated in the comparison:
//   - picomatch rejects "" as a path and as a pattern, and short-circuits
//     `path === pattern` to true; Bun matches both structurally.
//   - picomatch never matches a `.` or `..` segment or an empty segment
//     (leading, doubled or trailing `/`), and strips a leading `./` from the
//     pattern; Bun.Glob treats all of those as literal text. Dotfiles agree
//     once picomatch gets dot:true.
//   - Bun's negated classes `[!x]` / `[^x]` match `/` ("anything except the
//     characters", docs/runtime/glob.mdx); picomatch's never cross a separator.
//   - picomatch turns `{a}` / `{}` into literals and `{1..3}` into a range; Bun
//     braces always group and never expand ranges. A `**` inside or touching a
//     brace group is read differently too: picomatch lets it cross separators
//     even in `**{a,b}` and `a/{b,**}x`, where Bun (expanding the group like
//     bash) sees `*`, while `{**/a,b}` is a globstar for Bun only.
//   - Inside braces picomatch gives a `.` followed by `*` the guard it normally
//     reserves for the start of a segment, so `x{?.*,b}` does not match "x.."
//     although `x?.*` does; Bun expands braces like bash and matches both.
//   - After a `**` segment, picomatch lets a final segment that can match the
//     empty string (`a/**/{,b}` against "a") stand in for no segment at all;
//     Bun, like bash, still requires the `/`.
//   - `( ) | + @ "` are extglob / regex syntax in picomatch and plain text in
//     Bun; `\` before a letter is a regex class in picomatch (`\d`, `\b`) and a
//     plain letter in Bun; a run of three or more stars is rebuilt differently.
//   - On Windows Bun.Glob#match also treats `\` in the *path* as a separator, so
//     paths contain no backslashes (pattern escapes behave the same everywhere).
import { fuzzEnv, Rng } from "_util/fuzz";
import { Glob } from "bun";
import { expect, test } from "bun:test";
import picomatch from "picomatch";

const fuzz = fuzzEnv("BUN_GLOB_FUZZ", 0x676c6f62, { release: 2000, debug: 200 });
const PATHS_PER_PATTERN = 3;

const PICOMATCH_OPTIONS = {
  dot: true, // Bun.Glob#match has no dotfile rule
  strictSlashes: true, // `a/**` must not match "a"; a trailing `/` is significant
  posix: true,
  literalBrackets: false, // `[ab]` must not also match the literal text "[ab]"
  fastpaths: false,
  noextglob: true,
  regex: false,
  windows: false,
};

const PLAIN = [..."abcxyzAB019._-"];
// Glob syntax characters: literal text in paths, always escaped in patterns.
const META = [..."*?[]{}!,"];
const CLASSABLE = "abcxyz019";

function genSegment(rng: Rng): string {
  let s: string;
  do {
    const n = rng.range(1, 4);
    s = "";
    for (let i = 0; i < n; i++) s += rng.chance(0.08) ? rng.pick(META) : rng.pick(PLAIN);
  } while (s === "." || s === "..");
  return s;
}

function genPath(rng: Rng): string[] {
  const segments: string[] = [];
  const n = rng.range(1, 4);
  for (let i = 0; i < n; i++) segments.push(genSegment(rng));
  return segments;
}

function literal(ch: string): string {
  return META.includes(ch) ? "\\" + ch : ch;
}

function genClass(rng: Rng, ch: string): string {
  if (rng.chance(0.5)) {
    const at = CLASSABLE.indexOf(ch);
    const lo = at - rng.int(3);
    const hi = at + rng.int(3);
    // CLASSABLE is not in code point order across the letter/digit boundary,
    // and a reversed range is invalid for both matchers.
    if (lo >= 0 && hi < CLASSABLE.length && CLASSABLE.charCodeAt(lo) < CLASSABLE.charCodeAt(hi)) {
      return `[${CLASSABLE[lo]}-${CLASSABLE[hi]}]`;
    }
  }
  let members = ch;
  const extra = rng.int(3);
  for (let i = 0; i < extra; i++) members += rng.pick([...CLASSABLE]);
  return `[${members}]`;
}

/** Per-pattern choices; decided up front so every segment of one pattern agrees. */
interface Shape {
  /** Brace groups this pattern may still open. */
  braces: number;
  /** Whether whole `**` segments may be emitted. */
  globstarSegments: boolean;
  /** Whether a `**` that is only part of a segment (`**.js`, `a**b`, both meaning `*`) may be emitted. */
  partialGlobstar: boolean;
}

interface SegmentPattern {
  text: string;
  /** Whether the pattern can match "" (only stars and braces with such an alternative). */
  canBeEmpty: boolean;
}

/** A pattern for one segment, mostly matching `text`, sometimes deliberately not. */
function deriveSegment(rng: Rng, text: string, shape: Shape, inBraces: boolean): SegmentPattern {
  let out = "";
  let canBeEmpty = true;
  let lastWasStar = false;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const roll = rng.next();
    if (roll < 0.45) {
      out += literal(rng.chance(0.06) ? rng.pick(PLAIN) : ch);
      canBeEmpty = false;
      lastWasStar = false;
    } else if (roll < 0.65) {
      if (lastWasStar) {
        out += "?";
        canBeEmpty = false;
        lastWasStar = false;
        continue;
      }
      const swallowed = rng.int(3); // the star stands in for some of the following characters too
      // A `**` that is the entire segment would be a real globstar, so a partial
      // one needs text on at least one side of it.
      const wholeSegment = out === "" && i + swallowed >= chars.length - 1;
      out += shape.partialGlobstar && !inBraces && !wholeSegment && rng.chance(0.3) ? "**" : "*";
      i += swallowed;
      lastWasStar = true;
    } else if (roll < 0.78) {
      out += "?";
      canBeEmpty = false;
      lastWasStar = false;
    } else if (roll < 0.9 && CLASSABLE.includes(ch)) {
      out += genClass(rng, ch);
      canBeEmpty = false;
      lastWasStar = false;
    } else if (shape.braces > 0 && out !== "**") {
      // (`**{a,b}` is the brace adjacency case from the header.)
      shape.braces--;
      const span = chars.slice(i, i + rng.range(1, 3)).join("");
      const alternatives = [deriveSegment(rng, span, shape, true)];
      const n = rng.range(1, 2);
      for (let k = 0; k < n; k++) {
        alternatives.push(
          rng.chance(0.2)
            ? { text: "", canBeEmpty: true }
            : deriveSegment(rng, rng.string(PLAIN, rng.range(1, 3)), shape, true),
        );
      }
      // Move the alternative derived from the real text to a random slot.
      const at = rng.int(alternatives.length);
      [alternatives[0], alternatives[at]] = [alternatives[at], alternatives[0]];
      if (alternatives.some(a => a.text.includes("..") || a.text.includes(".*"))) {
        // `..` would be a picomatch range and `.*` gets the dotfile guard
        // (header); keep this character literal instead of opening the group.
        out += literal(ch);
        canBeEmpty = false;
      } else {
        out += `{${alternatives.map(a => a.text).join(",")}}`;
        if (!alternatives.some(a => a.canBeEmpty)) canBeEmpty = false;
        i += span.length - 1;
      }
      lastWasStar = false;
    } else {
      out += literal(ch);
      canBeEmpty = false;
      lastWasStar = false;
    }
  }
  if (!inBraces && (out === "." || out === "..")) {
    // Same rule as genSegment: a whole segment is never `.` or `..` (header).
    out += "?";
    canBeEmpty = false;
  }
  return { text: out, canBeEmpty };
}

function derivePattern(rng: Rng, path: string[]): string {
  const braces = rng.int(3);
  const globstarSegments = rng.chance(0.75);
  // Known divergences (pinned by PARTIAL_GLOBSTAR_BUGS below): a `**` that is
  // only part of a segment is documented to mean `*`, but src/glob/matcher.rs
  // still runs some of its globstar logic for it. Until the pin flips, partial
  // globstars only appear in patterns without globstar segments or braces;
  // afterwards this becomes an independent coin flip.
  const shape: Shape = { braces, globstarSegments, partialGlobstar: braces === 0 && !globstarSegments };

  const segments: string[] = [];
  const push = (segment: SegmentPattern) => {
    // An empty-matchable brace segment right after a globstar is the
    // `a/**/{,b}` case from the header; a `?` makes it need a character.
    if (segment.canBeEmpty && segment.text.includes("{") && segments.at(-1) === "**") segment.text += "?";
    segments.push(segment.text);
  };
  for (let i = 0; i < path.length; i++) {
    const roll = rng.next();
    if (roll < 0.2) {
      if (shape.globstarSegments) {
        segments.push("**");
        // The globstar stands in for zero or more of the path's segments; when
        // it stands in for zero, segment i is derived by the next iteration.
        i += rng.int(path.length - i + 1) - 1;
      } else {
        push(deriveSegment(rng, path[i], shape, false));
      }
    } else if (roll < 0.25) {
      // Drop the segment, or swap in an unrelated one: a likely non-match.
      if (rng.chance(0.5)) push(deriveSegment(rng, genSegment(rng), shape, false));
    } else {
      push(deriveSegment(rng, path[i], shape, false));
    }
  }
  if (shape.globstarSegments && (segments.length === 0 || rng.chance(0.08))) segments.push("**");
  if (segments.length === 0) segments.push("*");
  let pattern = segments.join("/");
  if (rng.chance(0.12)) pattern = "!" + pattern;
  if (rng.chance(0.03)) pattern = "!" + pattern;
  return pattern;
}

function mutatePath(rng: Rng, path: string[]): string[] {
  const out = path.slice();
  const i = rng.int(out.length);
  switch (rng.int(5)) {
    case 0:
      out.splice(rng.int(out.length + 1), 0, genSegment(rng));
      break;
    case 1:
      if (out.length > 1) out.splice(i, 1);
      else out[0] = genSegment(rng);
      break;
    case 2: {
      const chars = [...out[i]];
      chars[rng.int(chars.length)] = rng.pick(PLAIN);
      const s = chars.join("");
      out[i] = s === "." || s === ".." ? s + "x" : s;
      break;
    }
    case 3:
      out[i] = rng.chance(0.5) ? out[i] + rng.pick(PLAIN) : "." + out[i];
      break;
    default:
      out[i] = out[i] === out[i].toUpperCase() ? out[i].toLowerCase() : out[i].toUpperCase();
      break;
  }
  return out;
}

test(`Bun.Glob#match agrees with picomatch ${fuzz.label}`, () => {
  const rng = new Rng(fuzz.seed);
  let compared = 0;
  let matched = 0;
  for (let i = 0; i < fuzz.iters; i++) {
    const basePath = genPath(rng);
    const pattern = derivePattern(rng, basePath);
    const reference = picomatch(pattern, PICOMATCH_OPTIONS);
    const glob = new Glob(pattern);

    const paths = [basePath];
    while (paths.length < PATHS_PER_PATTERN) {
      paths.push(rng.chance(0.7) ? mutatePath(rng, rng.pick(paths)) : genPath(rng));
    }
    for (const segments of paths) {
      const path = segments.join("/");
      if (path === pattern) continue;
      const expected = reference(path);
      const actual = glob.match(path);
      compared++;
      if (expected) matched++;
      if (actual !== expected) {
        throw new Error(
          `new Bun.Glob(${JSON.stringify(pattern)}).match(${JSON.stringify(path)}) returned ${actual}, ` +
            `picomatch says ${expected}. ${fuzz.repro(i)}`,
        );
      }
    }
  }
  console.log(`glob-differential-fuzz: ${fuzz.iters} patterns, ${compared} paths compared, ${matched} matched`);
  expect(matched).toBeGreaterThan(0);
  expect(matched).toBeLessThan(compared);
});

// The cases derivePattern() steers around (`a*/**` and `**/a*/{x,y}` agree).
// Each has a fix in flight; when the last one lands this starts passing, and
// then it should be deleted together with the partialGlobstar gating.
const PARTIAL_GLOBSTAR_BUGS: [pattern: string, path: string][] = [
  ["a**/**", "ab"],
  ["**/a**/{x,y}", "ab/ay"],
];

test.failing("known divergences: a `**` that is only part of a segment still acts as a globstar", () => {
  for (const [pattern, path] of PARTIAL_GLOBSTAR_BUGS) {
    expect(new Glob(pattern).match(path), `${pattern} against ${path}`).toBe(
      picomatch(pattern, PICOMATCH_OPTIONS)(path),
    );
  }
});
