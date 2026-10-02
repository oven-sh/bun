// Run by linear-regexp.test.ts, with and without --experimental-linear-regexp. The first argument
// says what to report; the report is one line of JSON.
import { jscInternals } from "bun:internal-for-testing";
import { numberOfDFGCompiles } from "bun:jsc";
import { fork } from "node:child_process";
import { Worker } from "node:worker_threads";

const statisticsOf = (regExp: RegExp, subject: string, start = 0) =>
  jscInternals.regExpMatchStatistics(regExp, subject, start);
const engineOf = (regExp: RegExp) => statisticsOf(regExp, "aa!").engine;
const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();

// A backtracking engine takes 2^64 ways through this subject, stops at its limit, and answers
// "no match". So a match says that the non-backtracking matcher ran.
const onlyTheMatcherMatches = /(a*)*b|a*!/;
const manyA = repeat("a", 64) + "!";

const reports: Record<string, () => unknown> = {
  engine: () => ({
    literal: engineOf(/(a*)*b/),
    constructed: engineOf(new RegExp("(a*)*b", "i")),
    unicodeSets: engineOf(/[\p{L}--[a-c]]+/v),
    execArgv: process.execArgv,
  }),

  // Every way a program reaches a RegExp, in functions hot enough for the DFG to compile, then
  // in a Worker and in a forked process.
  routes: async () => {
    const routes = {
      test: (subject: string) => /(a*)*b|a*!/.test(subject),
      exec: (subject: string) => /(a*)*b|a*!/.exec(subject)?.index,
      search: (subject: string) => subject.search(/(a*)*b|a*!/),
      replace: (subject: string) => subject.replace(/(a*)*b|a*!/, "").length,
      match: (subject: string) => subject.match(/(?:a*)*b|a*!/g)?.length,
      matchAll: (subject: string) => [...subject.matchAll(/(?:a*)*b|a*!/g)].length,
      split: (subject: string) => subject.split(/(?:a*)*b|a*!/).length,
    };
    const results: Record<string, unknown> = {};
    const compiled: Record<string, boolean> = {};
    for (const [name, route] of Object.entries(routes)) {
      // Until the DFG has compiled the function, or far past where it does.
      for (let i = 0; i < 200000 && !(i > 200 && numberOfDFGCompiles(route) > 0); ++i) route("a!");
      compiled[name] = numberOfDFGCompiles(route) > 0;
      results[name] = route(manyA);
    }

    const worker = await new Promise((resolve, reject) => {
      const source = `
        const { parentPort } = require("node:worker_threads");
        const { jscInternals } = require("bun:internal-for-testing");
        parentPort.postMessage({
          engine: jscInternals.regExpMatchStatistics(/(a*)*b/, "aa!", 0).engine,
          matches: /(a*)*b|a*!/.test(${JSON.stringify(manyA)}),
        });`;
      const worker = new Worker(source, { eval: true });
      worker.on("message", resolve);
      worker.on("error", reject);
    });

    const forked = await new Promise((resolve, reject) => {
      const child = fork(import.meta.filename, ["forked"], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
      child.on("message", message => {
        resolve(message);
        child.kill();
      });
      child.on("error", reject);
    });

    return { results, compiled, worker, forked };
  },

  forked: () => {
    process.send!({ engine: engineOf(/(a*)*b/), matches: onlyTheMatcherMatches.test(manyA) });
    return undefined;
  },

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
        const statistics = [512, 1024, 1536].map(length => {
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
      [/x{0,300}y/, repeat("x", 200) + "!", 0],
      [/x{0,300}y/, repeat("x", 900) + "!", 0],
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
    const globalLoop = [100, 200, 400].map(length => {
      const subject = repeat("a", length);
      let steps = 0;
      for (let start = 0; start < length; ++start) steps += statisticsOf(/a*b|a/, subject, start).steps;
      return steps;
    });

    return { rows, bounded, globalLoop };
  },

  limits: () => ({
    matchLimit: onlyTheMatcherMatches.test(manyA),
    contextPool: /^(?:a|b)+$/.test(repeat("a", 262144)),
  }),

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
      [/\p{RGI_Emoji}/gv, "a\u{1F600}b\u{1F1FA}\u{1F1F8}"],
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

  // What a Worker does when its execArgv has the switch, from node:worker_threads and from the
  // global constructor.
  workerExecArgv: async () => {
    const source = `
      const { jscInternals } = require("bun:internal-for-testing");
      const engine = jscInternals.regExpMatchStatistics(/(a*)*b/, "aa!", 0).engine;
      if (typeof postMessage === "function") postMessage(engine);
      else require("node:worker_threads").parentPort.postMessage(engine);`;
    const describeError = (error: any) => ({ name: error.name, code: error.code, message: error.message });
    const start = (execArgv: string[]) =>
      new Promise(resolve => {
        try {
          const worker = new Worker(source, { eval: true, execArgv });
          worker.on("message", resolve);
          worker.on("error", error => resolve("error event: " + error.message));
        } catch (error) {
          resolve(describeError(error));
        }
      });
    const startGlobal = (execArgv: string[]) =>
      new Promise(resolve => {
        const url = URL.createObjectURL(new Blob([source]));
        try {
          // @ts-expect-error execArgv is Bun's
          const worker = new globalThis.Worker(url, { execArgv });
          worker.onmessage = event => {
            resolve(event.data);
            worker.terminate();
          };
          worker.onerror = event => resolve("error event: " + event.message);
        } catch (error) {
          resolve(describeError(error));
        }
      });
    return {
      given: await start(["--experimental-linear-regexp"]),
      givenGlobal: await startGlobal(["--experimental-linear-regexp"]),
      processExecArgv: await start(process.execArgv),
      none: await start([]),
    };
  },
};

const report = await reports[process.argv[2]]();
if (report !== undefined) {
  console.log(JSON.stringify(report));
  process.exit(0);
}
