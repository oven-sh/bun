// Run by linear-regexp.test.ts, with and without --experimental-linear-regexp. The first argument
// says what to report; the report is one line of JSON. Every report here reads the statistics of
// a match. The others are in linear-regexp-routes-fixture.ts.
import { jscInternals } from "bun:internal-for-testing";

const statisticsOf = (regExp: RegExp, subject: string, start = 0) =>
  jscInternals.regExpMatchStatistics(regExp, subject, start);
const engineOf = (regExp: RegExp) => statisticsOf(regExp, "aa!").engine;
const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();

const reports: Record<string, () => unknown> = {
  engine: () => ({
    literal: engineOf(/(a*)*b/),
    constructed: engineOf(new RegExp("(a*)*b", "i")),
    unicodeSets: engineOf(/[\p{L}--[a-c]]+/v),
    execArgv: process.execArgv,
  }),

  steps: () => {
    const patterns: [RegExp, string][] = [
      [/(a*)*b/, "a"], // exponential for a backtracking matcher
      [/(a|aa)+b/, "a"],
      [/(x+x+)+y/, "x"],
      [/^(\w+\s?)*$/, "a "],
      [/(?:(?=a)a|a)*b/, "a"],
      [/(?:(?=a{0,4}(?=a{0,4}(?!a{0,4}b)))a)*b/, "a"], // lookarounds inside one another
      [/a*a*a*a*a*a*a*a*b/, "a"], // polynomial
      [/a*b/, "a"], // quadratic
    ];
    const rows = [];
    for (const [regExp, repeated] of patterns) {
      for (const encoding of ["latin1", "utf16"]) {
        const lengths: number[] = [];
        const statistics = [128, 256, 384].map(length => {
          const subject = repeat(repeated, length) + "!" + (encoding === "utf16" ? "\u2603" : "");
          if (jscInternals.isUTF16String(subject) !== (encoding === "utf16"))
            throw new Error("not a " + encoding + " string");
          lengths.push(subject.length);
          return statisticsOf(regExp, subject);
        });
        rows.push({ pattern: String(regExp), encoding, lengths, statistics });
      }
    }

    // A counted repeat is a copy of its atom per count, so a subject shorter than the count has
    // more states alive the longer it is. A match, and a match that starts in the middle.
    const bounded = [
      [/x{0,100}y/, repeat("x", 60) + "!", 0],
      [/x{0,100}y/, repeat("x", 300) + "!", 0],
      [/^(?:\w+\s?){1,100}$/, repeat("ab ", 90), 0],
      [/(\d+)-(\d+)/, repeat("a", 500) + "10-20" + repeat("b", 500), 250],
      [/b+$/, repeat("ab", 400), 399],
    ].map(([regExp, subject, start]) => ({
      pattern: String(regExp),
      length: (subject as string).length,
      start,
      statistics: statisticsOf(regExp as RegExp, subject as string, start as number),
    }));

    // One match is linear. A global loop is one match per result, and each of these reads the
    // subject to its end before it takes the single "a".
    const globalLoop = [50, 100, 200].map(length => {
      const subject = repeat("a", length);
      let steps = 0;
      for (let start = 0; start < length; ++start) steps += statisticsOf(/a*b|a/, subject, start).steps;
      return steps;
    });

    return { rows, bounded, globalLoop };
  },

  refused: () => {
    const cases: [RegExp, string][] = [
      [/(a+)b\1/, "aabaa"],
      [/(?<quote>['"]).*?\k<quote>/, "say 'hi' now"],
      [/(?=.*\d)(?=.*[a-z])\w{6,}/, "passw0rd"],
      [/(?<=\$\d*)\d/, "cost $105"],
      // The program of the matcher has a copy of the group for each of the 300 x 300 repeats.
      [/(?:a{1,300}){1,300}b/, "aab"],
      // Seven lookarounds inside one another, each with four characters to read.
      [/(?=a{0,4}(?=a{0,4}(?=a{0,4}(?=a{0,4}(?=a{0,4}(?=a{0,4}(?=a{0,4}b)))))))a/, "ab"],
      // The backtracking engines rewrite /.*X.*/ to a search for X, and read this subject once.
      [/.*foo(?=.*bar).*/, repeat("x", 32000) + "foo bar"],
    ];
    return cases.map(([regExp, subject]) => {
      const { engine, refusal, jit } = statisticsOf(regExp, subject);
      const match = regExp.exec(subject)!;
      return {
        pattern: String(regExp),
        engine,
        refusal,
        jit,
        index: match.index,
        match: [...match].map(text => text?.length),
      };
    });
  },

  methods: () => {
    const cases: [RegExp, string][] = [
      [/(a*)*/, "b"],
      [/(a*)+/, "b"],
      [/(?:a|())*/, "aa"],
      [/(a|ab)(c|bcd)(d*)/, "abcd"],
      [/(z)((a+)?(b+)?(c))*/, "zaacbbbcac"],
      [/(?:(a)|(b)|c)+?$/, "abc"],
      [/a{2,3}?/g, "aaaaaaa"],
      [/(?<=(\d)(\d))$/, "1053"],
      [/(?<!\$)\b\d+/g, "cost $10 20 30"],
      [/(?=(a{1,3}))a/g, "baaabac"],
      [/^\w+$/gm, "one\ntwo\nthree"],
      [/./gsu, "a\n\u{1F600}b"],
      [/\bs/giu, "\u017fs S"],
      [/[^\W]/giu, "S\u212a!"],
      [/(?<year>\d{4})-(?<month>\d{2})/g, "2026-09 and 2027-10"],
      [/(?:(?<n>a)|(?<n>b))+/, "ab"],
      [/[\p{L}--[a-c]]+/gv, "abcdefabc"],
      [/.*a.*/g, "xxaxx\nyyayy"],
      [/^.*foo.*$/gm, "a foo\nb\nc foo d"],
      [/(?:)/g, "ab"],
      [/a/y, "ba"],
      [/\s*,\s*/g, "a , b,c ,  d"],
      [/(?i:a)b|c(?-i:d)/gi, "Ab AB cd cD"],
      [/(\d+)\.(\d+)/dg, "v1.22 v3.4"],
    ];
    const clone = (regExp: RegExp) => new RegExp(regExp.source, regExp.flags);
    return cases.map(([regExp, subject]) => {
      const exec = clone(regExp).exec(subject);
      return {
        pattern: String(regExp),
        engine: statisticsOf(clone(regExp), subject).engine,
        exec: exec && {
          index: exec.index,
          match: [...exec],
          groups: exec.groups,
          indices: exec.indices && [...exec.indices],
        },
        test: clone(regExp).test(subject),
        match: subject.match(clone(regExp)),
        matchAll: regExp.global
          ? [...subject.matchAll(clone(regExp))].map(match => [match.index, ...match])
          : undefined,
        search: subject.search(clone(regExp)),
        replace: subject.replace(clone(regExp), "<$&|$1>"),
        split: subject.split(clone(regExp)),
      };
    });
  },
};

console.log(JSON.stringify(reports[process.argv[2]]()));
