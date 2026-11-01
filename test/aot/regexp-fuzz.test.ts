// Random patterns, the same every run, asked in compiled programs and in plain Bun. Which code answers in a compiled program depends on where the pattern's text comes from, so each pattern is asked
// in three programs: as a literal, as a text of the run, and out of a table that a loop goes through (a text that the build works out).
// To come to the code that compiled code calls straight away: no literal of the same text in the program of the run's texts; one object for each method; one function for each pattern; many subjects.
// AOT_REGEXP_FUZZ_SEEDS="5 6 7" asks other patterns.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const seeds = (process.env.AOT_REGEXP_FUZZ_SEEDS ?? "1 2").split(" ").filter(Boolean).map(Number);
const patternsOfOneSeed = 400;

function patternsOf(seed: number) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const choice = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const plain = [
    "a",
    "b",
    "c",
    "x",
    "y",
    "0",
    "1",
    "_",
    " ",
    "-",
    "k",
    "s",
    "K",
    "\\xe9",
    "\\xff",
    "\\xb5",
    "\\u2500",
    "\\u212a",
    "\\u017f",
    "\\n",
    "\\.",
  ];
  const classes = [
    "[abc]",
    "[^abc]",
    "[a-z]",
    "[^a-z]",
    "[^\\s]",
    "[a-c\\u2500]",
    "[\\xe0-\\xff]",
    "[^\\x00-\\xff]",
    "[ks]",
    "[\\d_]",
  ];
  let groups = 0;
  const atom = (unicode: boolean, depth: number): string => {
    const r = random();
    if (r < 0.34) return choice(plain);
    if (r < 0.4) return unicode ? "\\u{1F600}" : "\\ud83d\\ude00";
    if (r < 0.43) return choice(["\\ud83d", "\\ude00"]);
    if (r < 0.52) return choice([".", "\\d", "\\w", "\\s", "\\D", "\\W", "\\S"]);
    if (r < 0.62)
      return choice(
        unicode
          ? [...classes, "[\\w\\-]", "[\\u{1F600}-\\u{1F64F}]", "[^\\u{1F600}]"]
          : [...classes, "[\\w-]", "[^]", "[]"],
      );
    if (r < 0.7) return choice(["\\b", "\\B", "^", "$"]);
    if (r < 0.74 && unicode) return choice(["\\p{L}", "\\P{L}", "\\p{Lu}", "\\p{Ll}", "\\p{Script=Greek}"]);
    if (r < 0.8 && groups) return "\\" + (1 + Math.floor(random() * groups));
    if (depth <= 0) return choice(plain);
    const k = random();
    if (k < 0.3) return (groups++, "(" + alternatives(unicode, depth - 1) + ")");
    return (
      choice(k < 0.55 ? ["(?:"] : k < 0.67 ? ["(?="] : k < 0.79 ? ["(?!"] : k < 0.9 ? ["(?<="] : ["(?<!"]) +
      alternatives(unicode, depth - 1) +
      ")"
    );
  };
  const term = (unicode: boolean, depth: number) => {
    const made = atom(unicode, depth);
    if (["\\b", "\\B", "^", "$"].includes(made) || /^\(\?(=|!|<)/.test(made) || random() < 0.55) return made;
    return made + choice(["*", "+", "?", "{2}", "{1,3}", "{0,}", "{0,1}", "{2,}"]) + (random() < 0.3 ? "?" : "");
  };
  const sequence = (unicode: boolean, depth: number) =>
    Array.from({ length: choice([0, 1, 1, 2, 2, 3, 4]) }, () => term(unicode, depth)).join("");
  const alternatives = (unicode: boolean, depth: number): string =>
    Array.from({ length: choice([1, 1, 1, 2, 2, 3]) }, () => sequence(unicode, depth)).join("|");
  const flagSets = [
    "",
    "",
    "i",
    "m",
    "s",
    "u",
    "u",
    "v",
    "g",
    "y",
    "gi",
    "iu",
    "mu",
    "su",
    "gu",
    "yu",
    "gv",
    "giu",
    "d",
    "im",
    "is",
  ];
  const found = new Map<string, { source: string; flags: string }>();
  while (found.size < patternsOfOneSeed) {
    const flags = choice(flagSets);
    groups = 0;
    let source = alternatives(/[uv]/.test(flags), 3);
    if (random() < 0.25) source = source.includes("|") ? `^(?:${source})$` : `^${source}$`;
    if (!source || source.includes("/")) continue;
    try {
      new RegExp(source, flags);
    } catch {
      continue;
    }
    found.set(`/${source}/${flags}`, { source, flags });
  }
  return [...found.values()];
}

const subjects = [
  "", "a", "b", "ab", "abc", "aab", "abab", "xay", "a b", "a-b", "a_1", "01", "k", "K", "s", "S", "ks", "\xe9", "\xc9", "\xff", "\xb5", "a\xe9b", "─", "a─", "─a", "K", "kK", "ſ", "sſ",
  "Μ", "μ", "\n", "a\nb", "ab\n", " ", "\u{1F600}", "a\u{1F600}", "\u{1F600}a", "a\u{1F600}b", "\u{1F600}\u{1F600}", "\ud83d", "\ude00", "a\ud83d", "\ude00a", "\ude00\ud83d", "aaaa", "abcabc", "a.b", "x y",
  "Αα",
]; // prettier-ignore
const ascii = (value: unknown) =>
  JSON.stringify(value).replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
const head = `const nothing = String(Date.now()).slice(99);
const subjects = ${ascii(subjects)};
const sumOf = text => [...text].reduce((sum, c) => (sum * 31 + c.codePointAt(0)) % 9973, text.length);
const show = m => (m ? m.index + ":" + m.map(each => (each === undefined ? "-" : sumOf(each))).join(",") : "n");
const code = list => (list === null ? "n" : list.length + "." + list.reduce((sum, each) => (sum * 31 + (typeof each === "number" ? each : each === undefined ? 3 : sumOf(each))) % 99991, 7));
`;
const asksOf = (isGlobal: boolean) => [
  'show(RE.exec(subject + nothing)) + "@" + RE.lastIndex',
  "(RE.test(subject + nothing) ? 1 : 0)",
  isGlobal ? "code((subject + nothing).match(RE))" : "show((subject + nothing).match(RE))",
  "(subject + nothing).search(RE)",
  'code([(subject + nothing).replace(RE, "[$&]")])',
  "code((subject + nothing).split(RE))",
  ...(isGlobal ? ["code([...(subject + nothing).matchAll(RE)].map(each => each.index))"] : []),
];
type Pattern = ReturnType<typeof patternsOf>[number];
const oneFunctionEach = (patterns: Pattern[], make: (pattern: Pattern) => string) =>
  head +
  patterns
    .map((pattern, index) => {
      const asks = asksOf(pattern.flags.includes("g"));
      const reset = /[gy]/.test(pattern.flags);
      return [
        `function ask${index}() {`,
        ...asks.map((_, which) => `const re${which} = ${make(pattern)};`),
        `let line = ${ascii(`/${pattern.source}/${pattern.flags} `)};`,
        "for (const subject of subjects) {",
        ...asks.map(
          (ask, which) =>
            `${reset ? `re${which}.lastIndex = 0; ` : ""}line += ${ask.replaceAll("RE", `re${which}`)} + " ";`,
        ),
        'line += "|"; }',
        "console.log(line); }",
        `ask${index}();`,
      ].join("\n");
    })
    .join("\n") +
  "\n";
const outOfTable = (patterns: Pattern[]) =>
  `${head}const texts = ${ascii(patterns.map(pattern => pattern.source))};
const flagsOf = ${ascii(patterns.map(pattern => pattern.flags))};
for (let at = 0; at < texts.length; at++) {
  const made = new RegExp(texts[at], flagsOf[at]);
  let line = "/" + texts[at] + "/" + flagsOf[at] + " ";
  for (const subject of subjects) {
${asksOf(false)
  .map(
    (ask, which) =>
      `    made.lastIndex = 0; line += ${which === 2 ? `(made.global ? code((subject + nothing).match(made)) : ${ask.replaceAll("RE", "made")})` : ask.replaceAll("RE", "made")} + " ";`,
  )
  .join("\n")}
    if (made.global) { made.lastIndex = 0; line += code([...(subject + nothing).matchAll(made)].map(each => each.index)) + " "; }
    line += "|";
  }
  console.log(line);
}
`;
const programs = {
  "a literal": patterns => oneFunctionEach(patterns, ({ source, flags }) => `/${source}/${flags}`),
  "a text of the run": patterns =>
    oneFunctionEach(patterns, ({ source, flags }) => `new RegExp(${ascii(source)} + nothing, ${ascii(flags)})`),
  "a text out of a table": outOfTable,
} satisfies Record<string, (patterns: Pattern[]) => string>;

describe.concurrent.each(seeds)("random patterns of seed %d answer as in plain Bun", seed => {
  for (const [origin, programOf] of Object.entries(programs)) {
    test(
      `as ${origin}`,
      () =>
        slot(async () => {
          const patterns = patternsOf(seed);
          using dir = tempDir("aot-regexp-fuzz", { "main.js": programOf(patterns) });
          const folder = String(dir);
          const plain = await spawned([bunExe(), "main.js"], folder, bunEnv);
          expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
          built(
            await spawned([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "out"], folder, bunEnv),
          );
          const compiled = await spawned([join(folder, isWindows ? "out.exe" : "out")], folder, bunEnv);
          expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({ stderr: "", exitCode: 0 });
          const expected = plain.stdout.split("\n");
          expect(expected.length).toBe(patterns.length + 1);
          expect(
            compiled.stdout
              .split("\n")
              .flatMap((line, index) => (line === expected[index] ? [] : [line.split(" ")[0]])),
          ).toEqual([]);
        }),
      300_000,
    );
  }
});
