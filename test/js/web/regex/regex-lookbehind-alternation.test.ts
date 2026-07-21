// Focused semantics coverage for lookbehind assertions and large alternations
// -- the two areas the Yarr JIT work for oven-sh/bun#5197 touches. Each core
// assertion is bracketed by its nearest neighbors (the same construct with one
// dimension varied) so a regression shows up as a specific broken variant, not
// a vague failure. Expectations were cross-checked against node/V8.
import { describe, expect, test } from "bun:test";

const ex = (re: RegExp, s: string) => {
  const m = re.exec(s);
  return m === null ? null : { m: [...m], index: m.index };
};

describe("lookbehind: fixed-length bodies", () => {
  test("literal", () => {
    expect(ex(/(?<=ab)c/, "abc")).toEqual({ m: ["c"], index: 2 });
    expect(ex(/(?<=ab)c/, "xbc")).toBeNull(); // near-miss: wrong first char
    expect(ex(/(?<=ab)c/, "aXc")).toBeNull(); // near-miss: wrong second char
    expect(ex(/(?<=ab)c/, "c")).toBeNull(); // not enough input behind
  });
  test("negative", () => {
    expect(ex(/(?<!ab)c/, "abc")).toBeNull();
    expect(ex(/(?<!ab)c/, "xbc")).toEqual({ m: ["c"], index: 2 });
    expect(ex(/(?<!ab)c/, "c")).toEqual({ m: ["c"], index: 0 }); // start of input: assertion holds
  });
  test("multi-char classes and quantified char", () => {
    expect(ex(/(?<=\d{3})x/, "123x")).toEqual({ m: ["x"], index: 3 });
    expect(ex(/(?<=\d{3})x/, "12x")).toBeNull(); // one short
    expect(ex(/(?<=\d{3})x/, "1234x")).toEqual({ m: ["x"], index: 4 }); // extra digit still fine
    expect(ex(/(?<=[a-c][0-9])!/, "b7!")).toEqual({ m: ["!"], index: 2 });
    expect(ex(/(?<=[a-c][0-9])!/, "z7!")).toBeNull();
  });
});

describe("lookbehind: variable-length bodies", () => {
  test("greedy and lazy quantifiers behind", () => {
    expect(ex(/(?<=a+)b/, "aaab")).toEqual({ m: ["b"], index: 3 });
    expect(ex(/(?<=a+)b/, "b")).toBeNull(); // needs at least one a
    expect(ex(/(?<=a*)b/, "b")).toEqual({ m: ["b"], index: 0 }); // zero a's allowed
    expect(ex(/(?<=a+?)b/, "aab")).toEqual({ m: ["b"], index: 2 });
  });
  test("alternation inside lookbehind", () => {
    expect(ex(/(?<=^|\s)word/, "word up")).toEqual({ m: ["word"], index: 0 });
    expect(ex(/(?<=^|\s)word/, "a word")).toEqual({ m: ["word"], index: 2 });
    expect(ex(/(?<=^|\s)word/, "sword")).toBeNull();
  });
  test("captures inside lookbehind are recorded", () => {
    expect(ex(/(?<=(\d)(\d))x/, "12x")).toEqual({ m: ["x", "1", "2"], index: 2 });
    expect(ex(/(?<=(\d)(\d))x/, "912x")).toEqual({ m: ["x", "1", "2"], index: 3 }); // rightmost pair
    expect(ex(/(?<=(a|b))c/, "bc")).toEqual({ m: ["c", "b"], index: 1 });
  });
  test("backreference to a lookbehind capture", () => {
    // Lookbehind bodies evaluate right-to-left: \1 is reached before (\w) has
    // participated, so the backreference matches empty and (\w) then captures
    // the character adjacent to x. Both inputs therefore match.
    expect(ex(/(?<=(\w)\1)x/, "aax")).toEqual({ m: ["x", "a"], index: 2 });
    expect(ex(/(?<=(\w)\1)x/, "abx")).toEqual({ m: ["x", "b"], index: 2 });
    expect(ex(/(?<=(\w)\1)x/, "x")).toBeNull(); // nothing behind to capture
  });
});

describe("lookbehind: anchors, boundaries, and flags", () => {
  test("word boundary composition", () => {
    expect(ex(/(?<=\bcat)s/, "cats")).toEqual({ m: ["s"], index: 3 });
    expect(ex(/(?<=\bcat)s/, "bobcats")).toBeNull(); // no boundary before "cat"
    expect(ex(/(?<=cat\b)!/, "cat!")).toEqual({ m: ["!"], index: 3 });
  });
  test("start-of-line inside lookbehind with multiline", () => {
    expect(ex(/(?<=^a)b/m, "ab")).toEqual({ m: ["b"], index: 1 });
    expect(ex(/(?<=^a)b/m, "x\nab")).toEqual({ m: ["b"], index: 3 });
    expect(ex(/(?<=^a)b/, "x\nab")).toBeNull(); // without m, ^ is only start of input
  });
  test("case-insensitive", () => {
    expect(ex(/(?<=usd)\d+/i, "USD42")).toEqual({ m: ["42"], index: 3 });
    expect(ex(/(?<=usd)\d+/, "USD42")).toBeNull();
    expect(ex(/(?<=usd)\d+/i, "AUD42")).toBeNull();
  });
  test("global and sticky iteration", () => {
    const s = "$1 x $22 y $333";
    expect(s.match(/(?<=\$)\d+/g)).toEqual(["1", "22", "333"]);
    const y = /(?<=\$)\d+/y;
    y.lastIndex = 1;
    expect(ex(y, s)).toEqual({ m: ["1"], index: 1 });
    y.lastIndex = 2;
    expect(ex(y, s)).toBeNull(); // sticky: no match exactly at 2
  });
  test("astral characters behind (u/v flags)", () => {
    expect(ex(/(?<=😀)!/u, "😀!")).toEqual({ m: ["!"], index: 2 });
    expect(ex(/(?<=😀)!/u, "😁!")).toBeNull();
    expect(ex(/(?<=.)!/u, "😀!")).toEqual({ m: ["!"], index: 2 }); // . consumes the whole code point
  });
});

describe("lookbehind: nesting and lookahead composition", () => {
  test("lookbehind containing lookbehind", () => {
    expect(ex(/(?<=(?<=a)b)c/, "abc")).toEqual({ m: ["c"], index: 2 });
    expect(ex(/(?<=(?<=a)b)c/, "xbc")).toBeNull();
    expect(ex(/(?<=(?<!a)b)c/, "xbc")).toEqual({ m: ["c"], index: 2 });
  });
  test("lookahead inside lookbehind", () => {
    expect(ex(/(?<=a(?=b))b/, "ab")).toEqual({ m: ["b"], index: 1 });
    expect(ex(/(?<=a(?!c))b/, "ab")).toEqual({ m: ["b"], index: 1 });
    expect(ex(/(?<=a(?=c))b/, "ab")).toBeNull();
  });
  test("the isbot-style shape: lookbehind guarding a large alternation", () => {
    const re = /(?<!\b(?:cu|apple)) ?bot\b/i;
    expect(ex(re, "googlebot")).toEqual({ m: ["bot"], index: 6 });
    expect(ex(re, "cubot")).toBeNull(); // guarded prefix "cu"
    expect(ex(re, "applebot")).toBeNull(); // guarded prefix "apple"
    // The optional space is part of the match: on "apple bot" the engine
    // starts the match at "bot" (space not consumed), where the character
    // behind is " ", not "apple" -- so the guard does not fire.
    expect(ex(re, "apple bot")).toEqual({ m: ["bot"], index: 6 });
    // "xapplebot": the guard needs a word boundary before "apple"; "x" is a
    // word char so \b fails, the negative lookbehind is satisfied, "bot" matches.
    expect(ex(re, "xapplebot")).toEqual({ m: ["bot"], index: 6 });
  });
});

describe("alternation: order and captures", () => {
  test("leftmost alternative wins, not longest", () => {
    expect(ex(/a|ab|abc/, "abc")).toEqual({ m: ["a"], index: 0 });
    expect(ex(/abc|ab|a/, "abc")).toEqual({ m: ["abc"], index: 0 });
    expect(ex(/ab|abc|a/, "abcd")).toEqual({ m: ["ab"], index: 0 });
  });
  test("backtracking into a later alternative when the continuation fails", () => {
    expect(ex(/(?:ab|abc)d/, "abcd")).toEqual({ m: ["abcd"], index: 0 });
    expect(ex(/(?:ab|abc|abcd)e/, "abcde")).toEqual({ m: ["abcde"], index: 0 });
    expect(ex(/(?:aa|aab|aabc)z/, "aabcz")).toEqual({ m: ["aabcz"], index: 0 });
    expect(ex(/(?:aa|aab|aabc)z/, "aabz")).toEqual({ m: ["aabz"], index: 0 });
    expect(ex(/(?:aa|aab|aabc)z/, "aabq")).toBeNull();
  });
  test("only the matching alternative's captures participate", () => {
    expect(ex(/a(1)|a(2)|a(3)/, "a2")).toEqual({ m: ["a2", undefined, "2", undefined], index: 0 });
    expect(ex(/(x)|(y)|(z)/, "z")).toEqual({ m: ["z", undefined, undefined, "z"], index: 0 });
    expect(ex(/(?:(x)|(y)){2}/, "xy")).toEqual({ m: ["xy", undefined, "y"], index: 0 }); // per-iteration clearing
  });
  test("shared prefixes across many alternatives", () => {
    const words = ["about", "above", "after", "again", "against", "below", "between", "both", "during", "each"];
    const re = new RegExp("\\b(?:" + words.join("|") + ")\\b");
    for (const w of words) expect(ex(re, `x ${w} y`)).toEqual({ m: [w], index: 2 });
    expect(ex(re, "abov")).toBeNull(); // proper prefix must not match
    expect(ex(re, "againstx")).toBeNull(); // trailing \b
    expect(ex(re, "boths")).toBeNull();
  });
  test("anchored string lists", () => {
    const re = /^(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT)/;
    expect(ex(re, "POST /x")).toEqual({ m: ["POST"], index: 0 });
    expect(ex(re, "Pzz")).toBeNull(); // shared first letter is not a match
    expect(ex(re, " GET")).toBeNull(); // anchored
    expect(ex(re, "GETS")).toEqual({ m: ["GET"], index: 0 });
  });
  test("large alternation, case-insensitive, mixed lengths", () => {
    const re = /firefox|fxios|chrome|crios|safari|opera|opr\/|edg\/|edge|msie|trident|vivaldi/i;
    expect(ex(re, "Mozilla/5.0 Chrome/119")).toEqual({ m: ["Chrome"], index: 12 });
    expect(ex(re, "OPR/106 build")).toEqual({ m: ["OPR/"], index: 0 });
    expect(ex(re, "Edg/119")).toEqual({ m: ["Edg/"], index: 0 });
    expect(ex(re, "curl/8.0")).toBeNull();
  });
});

describe("alternation: empty and quantified alternatives", () => {
  test("empty alternative matches empty at every position", () => {
    expect(ex(/x|/, "abc")).toEqual({ m: [""], index: 0 });
    expect(ex(/|x/, "xbc")).toEqual({ m: [""], index: 0 }); // empty alternative is first
    expect("axbxc".split(/x|/)).toEqual(["a", "b", "c"]);
  });
  test("quantified group of alternatives", () => {
    expect(ex(/(?:a|b)+/, "abba!")).toEqual({ m: ["abba"], index: 0 });
    expect(ex(/(?:a|b)+?/, "abba")).toEqual({ m: ["a"], index: 0 });
    expect(ex(/(?:ab|a)*c/, "aabc")).toEqual({ m: ["aabc"], index: 0 });
    expect(ex(/(?:ab|a)*?c/, "aabc")).toEqual({ m: ["aabc"], index: 0 });
  });
  test("global iteration over alternation with empty match", () => {
    expect("aXbX".match(/X|/g)).toEqual(["", "X", "", "X", ""]);
    expect("aXbX".replace(/X|/g, "-")).toBe("-a--b--");
  });
});
