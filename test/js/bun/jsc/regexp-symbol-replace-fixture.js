// Runs in a child process of regexp-symbol-replace.test.ts and prints one JSON report.
// The last section replaces RegExp.prototype.exec, which turns the fast path off for the
// rest of the process, so nothing may run after it.
import { runInNewContext } from "node:vm";

const symbolReplace = RegExp.prototype[Symbol.replace];
// The shape of the RegExpPrototypeSymbolReplace primordial of the node-ported builtins.
const uncurried = Function.prototype.call.bind(symbolReplace);

function outcome(fn) {
  try {
    return "value:" + fn();
  } catch (e) {
    return "throw:" + e.constructor.name + ":" + e.message;
  }
}

// An own property sends the RegExp to the generic path and changes nothing else.
function generic(source, flags) {
  const regexp = new RegExp(source, flags);
  regexp.custom = true;
  return regexp;
}

const report = {};

// 1. The fast path and the generic path agree on the result and on lastIndex.
{
  const patterns = [
    ["\\d+", "g"],
    ["\\d+", ""],
    ["(\\d)(\\w)?", "g"],
    ["a|(b)", "g"],
    ["(?<year>\\d{4})-(?<month>\\d{2})", "g"],
    ["(?<year>\\d{4})-(?<month>\\d{2})", ""],
    ["(?<a>x)|(?<a>y)", "g"],
    ["(?:)", "g"],
    ["(?:)", "gu"],
    ["x*", "g"],
    ["^", "gm"],
    ["\\u{1F600}", "gu"],
    ["b", "y"],
    ["b", "gy"],
    ["(?:)", "y"],
    ["B", "gi"],
    ["nomatch", "g"],
  ];
  const inputs = [
    "",
    "abc 123 def 456 ghi",
    "2024-01-15 and 2025-12-31",
    "a\u{1F600}b\u{1F600}",
    "xxyyxx",
    "l1\nl2\n",
    "bbab",
  ];
  const collect = function () {
    return "<" + JSON.stringify(Array.prototype.slice.call(arguments)) + ">";
  };
  const replacements = [
    "-",
    "",
    "$&$&",
    "[$1|$2]",
    "$<year>/$<month>",
    "$<nope>",
    "$`|$'",
    "$$",
    undefined,
    42,
    { toString: () => "[$&]" },
    collect,
    m => m.toUpperCase(),
    () => undefined,
    Symbol("replacement"),
    () => {
      throw new RangeError("from the replacer");
    },
    {
      toString() {
        throw new SyntaxError("from toString");
      },
    },
  ];

  const mismatches = [];
  let compared = 0;
  for (const [source, flags] of patterns) {
    // Only a sticky RegExp starts at lastIndex. The others reset it (global) or leave it alone.
    const lastIndices = flags.includes("y") ? [0, 1, 3, 1000] : [3];
    for (const input of inputs) {
      for (let i = 0; i < replacements.length; i++) {
        for (const lastIndex of lastIndices) {
          const calls = {
            "re[Symbol.replace](str, v)": (re, str, v) => re[Symbol.replace](str, v),
            "uncurryThis(RegExp.prototype[Symbol.replace])(re, str, v)": (re, str, v) => uncurried(re, str, v),
            "str.replace(re, v)": (re, str, v) => str.replace(re, v),
          };
          const slow = generic(source, flags);
          slow.lastIndex = lastIndex;
          const expected = [outcome(() => symbolReplace.call(slow, input, replacements[i])), slow.lastIndex];
          for (const name in calls) {
            const fast = new RegExp(source, flags);
            fast.lastIndex = lastIndex;
            const actual = [outcome(() => calls[name](fast, input, replacements[i])), fast.lastIndex];
            compared++;
            if (actual[0] !== expected[0] || actual[1] !== expected[1])
              mismatches.push({ call: name, source, flags, input, replacement: i, lastIndex, actual, expected });
          }
        }
      }
    }
  }
  report.matrix = { compared, mismatches };
}

// 2. The arguments are converted once, in order, on both paths.
{
  const log = [];
  const string = {
    toString() {
      log.push("string");
      return "aXbX";
    },
  };
  const replacement = {
    toString() {
      log.push("replaceValue");
      return "-";
    },
  };
  const results = [/X/g[Symbol.replace](string, replacement), generic("X", "g")[Symbol.replace](string, replacement)];
  report.conversions = { results, log };
}

// 3. The RegExp stops being primordial while an argument is converted.
{
  const ownExecDuringString = (() => {
    const regexp = /a/g;
    let calls = 0;
    const result = regexp[Symbol.replace](
      {
        toString() {
          regexp.exec = function () {
            calls++;
            return null;
          };
          return "aaa";
        },
      },
      "b",
    );
    return { result, calls };
  })();

  const ownExecDuringReplaceValue = (() => {
    const regexp = /a/g;
    let calls = 0;
    let conversions = 0;
    const result = regexp[Symbol.replace]("aaa", {
      toString() {
        conversions++;
        regexp.exec = function () {
          calls++;
          return null;
        };
        return "b";
      },
    });
    return { result, calls, conversions };
  })();

  const lastIndexDuringReplaceValue = (() => {
    const regexp = /a/y;
    const log = [];
    const result = regexp[Symbol.replace]("aaa", {
      toString() {
        log.push("replaceValue");
        regexp.lastIndex = {
          valueOf() {
            log.push("lastIndex");
            return 1;
          },
        };
        return "b";
      },
    });
    return { result, log, lastIndex: regexp.lastIndex };
  })();

  report.sideEffects = { ownExecDuringString, ownExecDuringReplaceValue, lastIndexDuringReplaceValue };
}

// 4. Receivers that are not a primordial RegExp.
{
  class Counting extends RegExp {
    static calls = 0;
    exec(string) {
      Counting.calls++;
      return super.exec(string);
    }
  }
  const subclass = new Counting("a", "g")[Symbol.replace]("aaa", "b");

  const fake = {
    flags: "",
    called: 0,
    exec() {
      if (this.called++) return null;
      return Object.assign(["b"], { index: 1 });
    },
  };

  report.receivers = {
    subclass: [subclass, Counting.calls],
    plainObject: symbolReplace.call(fake, "abc", "[$&]"),
    primitive: outcome(() => symbolReplace.call("not an object", "abc", "x")),
    frozenGlobal: outcome(() => Object.freeze(/a/g)[Symbol.replace]("aaa", "b")),
    frozenSingle: outcome(() => Object.freeze(/a/)[Symbol.replace]("aaa", "b")),
    otherRealm: symbolReplace.call(runInNewContext("/(l+)/g"), "hello world", "[$1]"),
  };
}

// 5. Which path a direct call takes. String.prototype.replace is specified as a call of
// RegExp.prototype[Symbol.replace], so the two may not differ in anything a program can see.
// One thing tells the two paths of JavaScriptCore apart: the generic path finds every match
// before it calls the replacer, and the fast path calls the replacer after each match of a
// short string. RegExp.lastMatch inside the replacer shows which one ran.
{
  const lastMatches = call => {
    const seen = [];
    call(/\d/g, "a1b2c3", match => {
      seen.push(RegExp.lastMatch);
      return match;
    });
    return seen.join();
  };
  report.path = {
    sameAsStringReplace:
      lastMatches((re, str, fn) => re[Symbol.replace](str, fn)) === lastMatches((re, str, fn) => str.replace(re, fn)),
    uncurriedSameAsStringReplace:
      lastMatches((re, str, fn) => uncurried(re, str, fn)) === lastMatches((re, str, fn) => str.replace(re, fn)),
    genericPath: lastMatches((re, str, fn) => generic(re.source, re.flags)[Symbol.replace](str, fn)),
  };
}

// 6. A replaced RegExp.prototype.exec is observed: when ToString(replaceValue) replaces it, and
// from then on. This comes last.
{
  const originalExec = RegExp.prototype.exec;
  let calls = 0;
  const during = /a/g[Symbol.replace]("aaa", {
    toString() {
      RegExp.prototype.exec = function (string) {
        calls++;
        return originalExec.call(this, string);
      };
      return "b";
    },
  });
  const callsDuring = calls;
  calls = 0;
  const after = /a/g[Symbol.replace]("aaa", "c");
  const callsAfter = calls;
  RegExp.prototype.exec = function () {
    return null;
  };
  const never = /a/g[Symbol.replace]("aaa", "c");
  RegExp.prototype.exec = originalExec;
  report.replacedExec = { during, callsDuring, after, callsAfter, never };
}

console.log(JSON.stringify(report));
