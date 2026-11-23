import { diff } from "bun";
import { describe, expect, test } from "bun:test";
import { isDebug } from "harness";

// Unless a test says otherwise, what is expected is what the package `diff` 9.0.0 returns.

type Changes = Bun.diff.Change<string | unknown[]>[];
const short = (changes: Changes | undefined) =>
  changes?.map(({ value, added, removed, count }) => [added ? "+" : removed ? "-" : "=", value, count]);
const edits = (changes: Changes) => changes.reduce((n, c) => n + (c.added || c.removed ? c.count : 0), 0);
const numbered = (count: number, line: (i: number) => unknown) =>
  Array.from({ length: count }, (_, i) => `${line(i)}\n`).join("");

function random(seed: number) {
  return (below: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) % below;
}

/**
 * The shortest script that `diff` picks, from the table of edit distances: read from the end, an insertion wherever
 * that is still shortest, else a deletion, else a match.
 */
function reference(a: string[], b: string[]) {
  const distance = Array.from({ length: a.length + 1 }, (_, x) =>
    Array.from({ length: b.length + 1 }, (_, y) => x + y),
  );
  for (let x = 1; x <= a.length; x++)
    for (let y = 1; y <= b.length; y++)
      distance[x][y] =
        a[x - 1] === b[y - 1] ? distance[x - 1][y - 1] : 1 + Math.min(distance[x - 1][y], distance[x][y - 1]);
  const runs: [string, string, number][] = [];
  for (let x = a.length, y = b.length; x > 0 || y > 0;) {
    let operation: string, token: string;
    if (y > 0 && distance[x][y - 1] < distance[x][y]) [operation, token] = ["+", b[--y]];
    else if (x > 0 && distance[x - 1][y] < distance[x][y]) [operation, token] = ["-", a[--x]];
    else [operation, token] = ["=", (--x, b[--y])];
    if (runs[0]?.[0] === operation) runs[0] = [operation, token + runs[0][1], runs[0][2] + 1];
    else runs.unshift([operation, token, 1]);
  }
  return runs;
}

function similarPair(next: (below: number) => number, alphabet: string[], maxLength: number) {
  const some = alphabet.slice(0, 1 + next(alphabet.length));
  const a = Array.from({ length: next(maxLength) }, () => some[next(some.length)]);
  const b = a.slice();
  for (let i = next(maxLength / 2); i > 0; i--) {
    const inserted = Array.from({ length: next(3) }, () => alphabet[next(alphabet.length)]);
    b.splice(next(b.length + 1), next(3), ...inserted);
  }
  return [a, b];
}

test("a change has value, added, removed and count", () => {
  expect(diff.lines("a\nb\n", "a\nc\n")).toStrictEqual([
    { value: "a\n", added: false, removed: false, count: 1 },
    { value: "b\n", added: false, removed: true, count: 1 },
    { value: "c\n", added: true, removed: false, count: 1 },
  ]);
  expect(diff.arrays([1], [2])).toStrictEqual([
    { value: [1], added: false, removed: true, count: 1 },
    { value: [2], added: true, removed: false, count: 1 },
  ]);
});

describe("lines", () => {
  // prettier-ignore
  test.each([
    ["both empty", "", "", []],
    ["equal", "a\nb", "a\nb", [["=", "a\nb", 2]]],
    ["old is empty", "", "a\nb\n", [["+", "a\nb\n", 2]]],
    ["new is empty", "a\nb\n", "", [["-", "a\nb\n", 2]]],
    ["last newline added", "a\nb", "a\nb\n", [["=", "a\n", 1], ["-", "b", 1], ["+", "b\n", 1]]],
    ["last line extended", "a\nb", "a\nbc", [["=", "a\n", 1], ["-", "b", 1], ["+", "bc", 1]]],
    ["common suffix inside a line", "xa\nb\n", "ya\nb\n", [["-", "xa\n", 1], ["+", "ya\n", 1], ["=", "b\n", 1]]],
    ["a line that ends another", "a\n", "ba\n", [["-", "a\n", 1], ["+", "ba\n", 1]]],
    ["CRLF is not LF", "a\r\nb\n", "a\nb\n", [["-", "a\r\n", 1], ["+", "a\n", 1], ["=", "b\n", 1]]],
    ["CR does not end a line", "a\rb\n", "a\rc\n", [["-", "a\rb\n", 1], ["+", "a\rc\n", 1]]],
    ["empty lines", "\n\n", "\n\n\n", [["=", "\n\n", 2], ["+", "\n", 1]]],
    ["an edit moves into the common tail", "x\na\n", "a\na\n", [["-", "x\n", 1], ["=", "a\n", 1], ["+", "a\n", 1]]],
    ["an edit moves to the end of a repeated tail", "x\na\nb\na\nb\nc\n", "a\nb\na\nb\na\nb\nc\n", [["-", "x\n", 1], ["=", "a\nb\na\nb\n", 4], ["+", "a\nb\n", 2], ["=", "c\n", 1]]],
    ["swapped", "a\nb\n", "b\na\n", [["-", "a\n", 1], ["=", "b\n", 1], ["+", "a\n", 1]]],
    ["Latin-1 and UTF-16", "é\na\n", "é\n世\n", [["=", "é\n", 1], ["-", "a\n", 1], ["+", "世\n", 1]]],
    ["UTF-16 and Latin-1", "世\né\n", "a\né\n", [["-", "世\n", 1], ["+", "a\n", 1], ["=", "é\n", 1]]],
    ["a code unit with the byte of a newline", "\u010a\u0a01a\n", "\u010a\u0a01b\n", [["-", "\u010a\u0a01a\n", 1], ["+", "\u010a\u0a01b\n", 1]]],
    ["code units that share a byte", "\u0141\n", "\u0241\n", [["-", "\u0141\n", 1], ["+", "\u0241\n", 1]]],
    ["lone surrogates", "\ud800\n", "\ud801\n", [["-", "\ud800\n", 1], ["+", "\ud801\n", 1]]],
  ])("%s", (_, a, b, expected) => {
    expect(short(diff.lines(a, b))).toEqual(expected);
  });

  test("ropes and substrings", () => {
    const base = numbered(50, i => `line ${i}`);
    const rope = base.slice(7) + "tail\n";
    expect(short(diff.lines(base.slice(7), rope))).toEqual([
      ["=", base.slice(7), 49],
      ["+", "tail\n", 1],
    ]);
  });

  test("values outlive the inputs", () => {
    const results = Array.from({ length: 50 }, (_, n) =>
      diff.lines(
        numbered(20, i => `${n} old ${i}`),
        numbered(20, i => `${n} ${i < 10 ? "old" : "世"} ${i}`),
      ),
    );
    Bun.gc(true);
    expect(results.map(short)).toEqual(
      results.map((_, n) => [
        ["=", numbered(10, i => `${n} old ${i}`), 10],
        ["-", numbered(10, i => `${n} old ${i + 10}`), 10],
        ["+", numbered(10, i => `${n} 世 ${i + 10}`), 10],
      ]),
    );
  });
});

describe("words", () => {
  // prettier-ignore
  test.each([
    ["a word", "the quick fox", "the slow fox", [["=", "the ", 2], ["-", "quick", 1], ["+", "slow", 1], ["=", " fox", 2]]],
    ["common prefix and suffix inside a word", "unhappy", "unsnappy", [["-", "unhappy", 1], ["+", "unsnappy", 1]]],
    ["a word that starts another", "a foo", "a foobar", [["=", "a ", 2], ["-", "foo", 1], ["+", "foobar", 1]]],
    ["a run of spaces", "a  b", "a \t b", [["=", "a", 1], ["-", "  ", 1], ["+", " \t ", 1], ["=", "b", 1]]],
    ["each line ending", "a\n\nb", "a\nb", [["=", "a\n", 2], ["-", "\n", 1], ["=", "b", 1]]],
    ["CRLF is one token", "a\r\nb", "a\rb", [["=", "a", 1], ["-", "\r\n", 1], ["+", "\r", 1], ["=", "b", 1]]],
    ["CRLF and LF", "a\r\nb", "a\nb", [["=", "a", 1], ["-", "\r\n", 1], ["+", "\n", 1], ["=", "b", 1]]],
    ["each punctuation mark", "f(a);", "f(a));", [["=", "f(a)", 4], ["+", ")", 1], ["=", ";", 1]]],
    ["Latin letters with diacritics", "naïve_1 x", "naïve_1 ḁ\u00ad", [["=", "naïve_1 ", 2], ["-", "x", 1], ["+", "ḁ\u00ad", 1]]],
    ["× and ˇ are not letters", "a×bˇc", "a×bˇd", [["=", "a×bˇ", 4], ["-", "c", 1], ["+", "d", 1]]],
    ["each CJK character", "世界", "世间", [["=", "世", 1], ["-", "界", 1], ["+", "间", 1]]],
    ["a surrogate pair", "a😀", "a😁", [["=", "a", 1], ["-", "😀", 1], ["+", "😁", 1]]],
    ["the spaces of \\s", "a\u00a0\ufeff\u2028b", "a\u0085b", [["=", "a", 1], ["-", "\u00a0\ufeff\u2028", 1], ["+", "\u0085", 1], ["=", "b", 1]]],
  ])("%s", (_, a, b, expected) => {
    expect(short(diff.words(a, b))).toEqual(expected);
  });
});

describe("chars", () => {
  // prettier-ignore
  test.each([
    ["Myers' example", "ABCABBA", "CBABAC", [["-", "AB", 2], ["=", "C", 1], ["+", "B", 1], ["=", "AB", 2], ["-", "B", 1], ["=", "A", 1], ["+", "C", 1]]],
    ["same high surrogate", "😀", "😁", [["-", "😀", 1], ["+", "😁", 1]]],
    ["same low surrogate", "\u{1F600}", "\u{1FA00}", [["-", "\u{1F600}", 1], ["+", "\u{1FA00}", 1]]],
    ["a pair and its first half", "😀", "\ud83d", [["-", "😀", 1], ["+", "\ud83d", 1]]],
    ["a pair and its second half", "😀", "\ude00", [["-", "😀", 1], ["+", "\ude00", 1]]],
    ["a pair counts once", "😀😀a", "😀😀b", [["=", "😀😀", 2], ["-", "a", 1], ["+", "b", 1]]],
  ])("%s", (_, a, b, expected) => {
    expect(short(diff.chars(a, b))).toEqual(expected);
  });

  test.each([256, 5000])("%d different characters", length => {
    const all = String.fromCharCode(...Array.from({ length }, (_, i) => i));
    expect(short(diff.chars(all, all.slice(1) + all[0]))).toEqual([
      ["-", all[0], 1],
      ["=", all.slice(1), length - 1],
      ["+", all[0], 1],
    ]);
  });
});

describe("arrays", () => {
  const object = {};
  const symbol = Symbol();
  // prettier-ignore
  test.each([
    ["both empty", [], [], []],
    ["numbers", [1, 2, 3], [1, 3, 4], [["=", [1], 1], ["-", [2], 1], ["=", [3], 1], ["+", [4], 1]]],
    ["doubles", [1.5, 2.5], [1.5], [["=", [1.5], 1], ["-", [2.5], 1]]],
    ["falsy values", [0, "", null, undefined, false], [0, "", null, undefined, false], [["=", [0, "", null, undefined, false], 5]]],
    ["no coercion", [1, null], ["1", undefined], [["-", [1, null], 2], ["+", ["1", undefined], 2]]],
    ["NaN is not NaN", [NaN], [NaN], [["-", [NaN], 1], ["+", [NaN], 1]]],
    ["0 is -0, and the new one is kept", [0], [-0], [["=", [-0], 1]]],
    ["strings and BigInts by value", ["ab", 2n ** 70n], [["a", "b"].join(""), 2n ** 70n], [["=", ["ab", 2n ** 70n], 2]]],
    ["objects and symbols by identity", [object, symbol, {}], [object, symbol, {}], [["=", [object, symbol], 2], ["-", [{}], 1], ["+", [{}], 1]]],
    ["a hole is undefined", [, 1], [undefined, 1], [["=", [undefined, 1], 2]]],
  ])("%s", (_, a, b, expected) => {
    expect(short(diff.arrays<unknown>(a, b))).toEqual(expected);
  });

  test("elements are the same objects", () => {
    const elements = Array.from({ length: 20 }, () => ({}));
    const [{ value }] = diff.arrays(elements, elements);
    expect(value).not.toBe(elements);
    expect(value.map((element, i) => element === elements[i])).toEqual(Array(20).fill(true));
  });

  test("a getter runs once and can change both arrays", () => {
    let reads = 0;
    const a: unknown[] = Array.from({ length: 20 }, (_, i) => `a${i}`);
    const b: unknown[] = ["a0", , "b"];
    Object.defineProperty(b, 1, {
      get() {
        reads++;
        a.length = 0;
        b.length = 2;
        Bun.gc(true);
        return "a1";
      },
    });
    expect(short(diff.arrays(a, b))).toEqual([
      ["=", ["a0", "a1"], 2],
      ["-", Array.from({ length: 18 }, (_, i) => `a${i + 2}`), 18],
      ["+", [undefined], 1],
    ]);
    expect(reads).toBe(1);
  });

  test("what a getter throws is thrown", () => {
    const error = new Error("from the getter");
    const throwing = Object.defineProperty(Array(20).fill(0), 15, {
      get() {
        throw error;
      },
    });
    expect(() => diff.arrays([1], throwing)).toThrow(error);
  });

  test("an array longer than the search can index", () => {
    expect(() => diff.arrays(new Array(2 ** 31), [])).toThrow(new RangeError("Out of memory"));
  });
});

test.each([2 ** 28 + 1, 2 ** 32 - 1])("arrays: a sparse array of length %d", length => {
  expect(() => diff.arrays(new Array(length), [])).toThrow(new RangeError("Out of memory"));
});

describe("of several shortest diffs, the one that diff picks", () => {
  test.each([
    ["lines", diff.lines, ["a\n", "b\n", "\n", "ab\n", "b\r\n", "}\n"]],
    ["lines, UTF-16", diff.lines, ["a\n", "世\n", "\n", "a世\n", "😀\n"]],
    ["words", diff.words, [".", ",", "\n", "(", "\r\n", "世"]],
    ["chars", diff.chars, ["a", "b", "c", "é", "\n"]],
    ["chars, UTF-16", diff.chars, ["a", "😀", "😁", "\u{1FA00}", "世"]],
  ])("%s", (_, fn, alphabet) => {
    const next = random(1);
    for (let i = 0; i < 150; i++) {
      // The longer ones take several attempts of the search, and rounds of more than 64 steps.
      const [a, b] = similarPair(next, alphabet, i % 50 ? 16 : 200);
      const expected = reference(a, b);
      expect({ a, b, changes: short(fn(a.join(""), b.join(""))) }).toEqual({ a, b, changes: expected });
    }
  });
});

test("of several shortest diffs of unrelated inputs, the one that diff picks", () => {
  const next = random(5);
  for (const distinct of [3, 30, 300]) {
    const [a, b] = [0, 1].map(() => Array.from({ length: 300 + next(40) }, () => `${next(1000) % distinct}\n`));
    expect(short(diff.lines(a.join(""), b.join("")))).toEqual(reference(a, b));
  }
});

describe("maxEditLength", () => {
  test.each([
    ["lines", (o: object) => diff.lines("a\nb\nc\n", "b\na\nd\n", o)],
    ["words", (o: object) => diff.words(".,;", ",.:", o)],
    ["chars", (o: object) => diff.chars("abc", "bad", o)],
    ["arrays", (o: object) => diff.arrays([1, 2, 3], [2, 1, 4], o)],
    ["hunks", (o: object) => diff.hunks("a\nb\nc\n", "b\na\nd\n", o)],
    ["createPatch", (o: object) => diff.createPatch("a\nb\nc\n", "b\na\nd\n", o)],
  ])("%s", (_, fn) => {
    const whole = fn({});
    expect(whole).toBeDefined();
    expect([0, 1, 2, 3, 4, 5, Infinity, undefined].map(maxEditLength => fn({ maxEditLength }))).toEqual([
      ...Array(4).fill(undefined),
      ...Array(4).fill(whole),
    ]);
    for (const maxEditLength of [-1, 1.5, NaN, -Infinity]) {
      expect(() => fn({ maxEditLength })).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          message: `The value of "options.maxEditLength" is out of range. It must be an integer >= 0 or Infinity. Received ${maxEditLength}`,
        }),
      );
    }
    expect(() => fn({ maxEditLength: "1" })).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });

  test("0 allows equal inputs", () => {
    expect(short(diff.lines("a\n", "a\n", { maxEditLength: 0 }))).toEqual([["=", "a\n", 1]]);
  });

  test("lengths that differ by more", () => {
    expect(diff.chars("a", "aaaa", { maxEditLength: 2 })).toBeUndefined();
    expect(short(diff.chars("a", "aaaa", { maxEditLength: 3 }))).toEqual([
      ["=", "a", 1],
      ["+", "aaa", 3],
    ]);
  });
});

describe("large inputs, on which diff is quadratic", () => {
  test("nothing in common", () => {
    const [a, b] = [numbered(10_000, i => i), numbered(10_000, i => -i - 1)];
    expect(short(diff.lines(a, b))).toEqual([
      ["-", a, 10_000],
      ["+", b, 10_000],
    ]);
  });

  test("most of one side is missing from the other", () => {
    const a = Buffer.alloc(60_000, "ab").toString();
    const b = Buffer.alloc(300, "ba").toString();
    expect(edits(diff.chars(a, b))).toBe(a.length - b.length);
    expect(edits(diff.chars(b, a))).toBe(a.length - b.length);
  });

  test("reversed", () => {
    const [a, b] = [numbered(10_000, i => i), numbered(10_000, i => 9999 - i)];
    expect(short(diff.lines(a, b))).toEqual([
      ["-", a.slice(0, -5), 9999],
      ["=", "9999\n", 1],
      ["+", b.slice(5), 9999],
    ]);
  });

  test("halves swapped", () => {
    const [first, second] = [numbered(9000, i => i), numbered(9000, i => -i - 1)];
    expect(short(diff.lines(first + second, second + first))).toEqual([
      ["-", first, 9000],
      ["=", second, 9000],
      ["+", first, 9000],
    ]);
  });

  type Next = ReturnType<typeof random>;
  test.each([
    ["frequent", (next: Next) => next(1000) % 7, 4634, 2544168612],
    ["rare", (next: Next) => next(3000), 9648, 2232959018],
    ["frequent and rare", (next: Next) => (next(1000) % 3 ? next(3000) : -1 - (next(1000) % 5)), 7982, 635490954],
  ])("unrelated inputs of %s tokens", (_, token, expectedEdits, checksum) => {
    const next = random(3);
    const [a, b] = [0, 1].map(() => numbered(5000, () => token(next)));
    const changes = diff.lines(a, b);
    const script = short(changes)!.map(([operation, , count]) => `${operation}${count}`);
    expect([edits(changes), Bun.hash.crc32(script.join(""))]).toEqual([expectedEdits, checksum]);
    expect(diff.lines(a, b, { maxEditLength: expectedEdits })).toEqual(changes);
    expect(diff.lines(a, b, { maxEditLength: expectedEdits - 1 })).toBeUndefined();
  });

  // Each edit is alone, and the inputs drift apart by as much as the edits allow: nothing is left over for an estimate
  // of the number of edits to be too high by.
  test.each(["removed first", "added first"])("maxEditLength is exact with lines %s", order => {
    const next = random(6);
    const line = () => `${next(100_000) % 50}\n`;
    const shared = Array.from({ length: 2000 }, () => Array.from({ length: 10 }, line).join(""));
    const extra = (from: number) =>
      shared.map((lines, i) => (i >= from && i < from + 1000 ? "x\n" : "") + lines).join("");
    const [a, b] = order === "removed first" ? [extra(0), extra(1000)] : [extra(1000), extra(0)];
    expect(edits(diff.lines(a, b, { maxEditLength: 2000 })!)).toBe(2000);
    expect(diff.lines(a, b, { maxEditLength: 1999 })).toBeUndefined();
  });

  test("lines that are made to collide", () => {
    // wyhash multiplies the last 8 bytes by the 8 before them xor this constant.
    const part = isDebug ? 3000 : 50_000;
    const lines = Array.from({ length: 4 * part }, (_, i) => `x\xdb\x28\xb4\xa0\xd1\x7e\x03\xe7${1_000_000 + i}\n`);
    expect(new Set(lines.slice(0, 50).map(line => Bun.hash.wyhash(Buffer.from(line, "latin1")))).size).toBe(1);
    const [a, b] = [lines.slice(0, -part).join(""), lines.slice(part).join("")];
    expect(diff.lines(a, b).map(change => change.count)).toEqual([part, 2 * part, part]);
  });

  test("past the limit of the search, the diff is still correct", () => {
    const next = random(4);
    // Every third line is the same on both sides and is there once, which makes what takes over fast.
    const [a, b] = [0, 1].map(() => {
      const units = new Uint16Array(2 * 99_000).fill(10);
      for (let i = 0; i < 99_000; i++) units[2 * i] = i % 3 ? 0x100 + (next(10_000) % 50) : 0x1000 + i / 3;
      return Buffer.from(units.buffer).toString("utf16le");
    });
    const patch = diff.createPatch(a, b);
    expect(diff.applyPatch(a, patch) === b).toBeTrue();
    expect(patch.split("\n ").length - 1).toBeGreaterThanOrEqual(33_000);
  });

  test.skipIf(isDebug)("past the limit of the search, a long run of equal characters stays unchanged", () => {
    const times = (letter: string, n: number) => Buffer.alloc(n, letter).toString();
    const a = "x" + times("c", 20_000) + times("x", 100_000) + "d";
    const b = "xd" + times("x", 100_000) + times("c", 20_000);
    expect(edits(diff.chars(a, b))).toBeLessThan(41_000);
  });
});

describe("hunks", () => {
  const text = numbered(20, i => i + 1);
  const changed = (...lines: number[]) => numbered(20, i => (lines.includes(i + 1) ? "x" : i + 1));
  const ranges = (hunks: Bun.diff.Hunk[]) => hunks.map(h => [h.oldStart, h.oldLines, h.newStart, h.newLines]);

  test("shape", () => {
    expect(diff.hunks("a\nb\nc\n", "a\nx\nc\n")).toStrictEqual([
      { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" a", "-b", "+x", " c"] },
    ]);
    expect(diff.hunks("a\n", "a\n")).toStrictEqual([]);
  });

  // prettier-ignore
  test.each([
    ["4 by default", changed(10), undefined, [[6, 9, 6, 9]]],
    ["0", changed(10), 0, [[10, 1, 10, 1]]],
    ["Infinity", changed(10), Infinity, [[1, 20, 1, 20]]],
    ["cut at the start and the end", changed(2, 19), 3, [[1, 5, 1, 5], [16, 5, 16, 5]]],
    ["twice the context between changes: one hunk", changed(5, 10), 2, [[3, 10, 3, 10]]],
    ["one line more: two hunks", changed(5, 11), 2, [[3, 5, 3, 5], [9, 5, 9, 5]]],
    ["an insertion without context", text.replace("\n3\n", "\nx\n3\n"), 0, [[3, 0, 3, 1]]],
    ["a deletion without context", text.replace("\n3\n", "\n"), 0, [[3, 1, 3, 0]]],
  ])("context: %s", (_, newText, context, expected) => {
    expect(ranges(diff.hunks(text, newText, { context }))).toEqual(expected);
  });

  const marker = "\\ No newline at end of file";
  // prettier-ignore
  test.each([
    ["old", "a", "a\n", ["-a", marker, "+a"]],
    ["new", "a\n", "a", ["-a", "+a", marker]],
    ["both", "a", "b", ["-a", marker, "+b", marker]],
    ["a kept line", "a\nb", "x\nb", ["-a", "+x", " b", marker]],
  ])("no newline at the end of %s", (_, a, b, lines) => {
    expect(diff.hunks(a, b).map(hunk => hunk.lines)).toEqual([lines]);
  });

  test("CR, empty lines and UTF-16", () => {
    expect(diff.hunks("\né\r\n", "\n世\r\n")[0].lines).toEqual([" ", "-é\r", "+世\r"]);
  });

  test.each([-1, 0.5, NaN])("context: %p is refused", context => {
    const error = expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      message: `The value of "options.context" is out of range. It must be an integer >= 0 or Infinity. Received ${context}`,
    });
    expect(() => diff.hunks("a", "b", { context })).toThrow(error);
    expect(() => diff.createPatch("a", "b", { context })).toThrow(error);
  });
});

describe("createPatch", () => {
  const body = "@@ -1,1 +1,1 @@\n-a\n+b\n";
  // prettier-ignore
  test.each([
    ["no names", {}, ""],
    ["both names", { oldFileName: "o", newFileName: "n" }, "--- o\n+++ n\n"],
    ["only the old name", { oldFileName: "o" }, "--- o\n+++ o\n"],
    ["only the new name", { newFileName: "n" }, "--- n\n+++ n\n"],
    ["headers", { oldFileName: "f", oldHeader: "é", newHeader: "世" }, "--- f\té\n+++ f\t世\n"],
    ["an empty header", { oldFileName: "f", oldHeader: "" }, "--- f\n+++ f\n"],
    // diff has no tab, and GNU patch changes the file "a".
    ["a tab ends a name with a space", { oldFileName: "a b", newHeader: "x" }, "--- a b\t\n+++ a b\tx\n"],
    ["a space at the start or the end is quoted", { oldFileName: " a", newFileName: "b " }, '--- " a"\t\n+++ "b "\t\n'],
    ["quoted names", { oldFileName: 'é\x07\b\t\n\v\f\r"\\\x01\x7f', newFileName: "世" }, '--- "\\303\\251\\a\\b\\t\\n\\v\\f\\r\\"\\\\\\001\\177"\n+++ "\\344\\270\\226"\n'],
  ])("%s", (_, options, headers) => {
    expect(diff.createPatch("a\n", "b\n", options)).toBe(headers + body);
  });

  test("the header of an empty range names the line before it", () => {
    expect(diff.createPatch("", "a\n")).toBe("@@ -0,0 +1,1 @@\n+a\n");
    expect(diff.createPatch("a\nb\n", "a\n", { context: 0 })).toBe("@@ -2,1 +1,0 @@\n-b\n");
  });

  test("equal texts, as with diff -u", () => {
    expect(diff.createPatch("a\n", "a\n", { oldFileName: "f" })).toBe("");
  });

  test.each([
    [{ oldFileName: "f", oldHeader: "a\n+++ g" }, "The property 'options.oldHeader' must not contain a line break"],
    [{ oldFileName: "f", newHeader: "世\r" }, "The property 'options.newHeader' must not contain a line break"],
    [{ newHeader: "" }, "The property 'options.newHeader' requires 'options.oldFileName' or 'options.newFileName'"],
  ])("%j is refused", (options, message) => {
    expect(() => diff.createPatch("a", "b", options)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE", message }),
    );
  });
});

describe("parsePatch", () => {
  const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] };
  const body = "@@ -1 +1 @@\n-a\n+b\n";

  // prettier-ignore
  test.each([
    ["empty", "", [{ hunks: [] }]],
    ["only a hunk", body, [{ hunks: [hunk] }]],
    ["no newline at the end", body.trimEnd(), [{ hunks: [hunk] }]],
    ["diff -u", `--- a\t2024-01-01 \tz\n+++ b\n${body}`, [{ oldFileName: "a", oldHeader: "2024-01-01", newFileName: "b", newHeader: "", hunks: [hunk] }]],
    ["Index:", `Index: a b \n${"=".repeat(67)}\n${body}`, [{ index: "a b", hunks: [hunk] }]],
    ["Mercurial", `diff -r 9117c6 -r 273ce1 .hgignore\n${body}`, [{ index: ".hgignore", hunks: [hunk] }]],
    ["other diff commands are not headers", `Index: f\ndiff -u -p -r1.1 f\n${body}`, [{ index: "f", hunks: [hunk] }]],
    ["files without an index line", `--- a\n+++ a\n${body}--- 世\n+++ 世\n${body}`, [
      { oldFileName: "a", oldHeader: "", newFileName: "a", newHeader: "", hunks: [hunk] },
      { oldFileName: "世", oldHeader: "", newFileName: "世", newHeader: "", hunks: [hunk] },
    ]],
    ["text around the hunks", `Subject: fix\n\n${body}Only in a: b\n@@ -5 +5 @@ function\n-a\n+b\n\nthanks`, [{ hunks: [hunk, { ...hunk, oldStart: 5, newStart: 5 }] }]],
    ["quoted names", `--- "\\303\\251\\t\\"\\\\"\n+++ "\\377"\n`, [{ oldFileName: 'é\t"\\', oldHeader: "", newFileName: "\ufffd", newHeader: "", hunks: [] }]],
    ["badly quoted names are left alone", `--- "a\\q"\n+++ "\\30"\n`, [{ oldFileName: '"a\\q"', oldHeader: "", newFileName: '"\\30"', newHeader: "", hunks: [] }]],
    ["backslashes", `--- a\\\\b\\c\n+++ a\\\\\\b\n`, [{ oldFileName: "a\\b\\c", oldHeader: "", newFileName: "a\\\\b", newHeader: "", hunks: [] }]],
    ["empty ranges", "@@ -0,0 +1 @@\n+a\n@@ -3 +3,0 @@\n-a\n", [{ hunks: [
      { oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ["+a"] },
      { oldStart: 3, oldLines: 1, newStart: 4, newLines: 0, lines: ["-a"] },
    ] }]],
    ["an empty range without a count", "@@ -1 +1 @@\n+a\n\\ x\n@@ -2,0 +2,0 @@", "Hunk at line 1 contained invalid line @@ -2,0 +2,0 @@"],
    ["a kept line without its space", "@@ -1,2 +1,2 @@\n\n-a\n+b\n", [{ hunks: [{ ...hunk, oldLines: 2, newLines: 2, lines: ["", "-a", "+b"] }] }]],
    ["lines that look like headers", "@@ -1 +1 @@\n--- a\n+++ b\n\\ No newline\n", [{ hunks: [{ ...hunk, lines: ["--- a", "+++ b", "\\ No newline"] }] }]],
    ["CRLF", "--- a\r\n+++ b\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n", [{ oldFileName: "a", oldHeader: "", newFileName: "b", newHeader: "", hunks: [{ ...hunk, lines: ["-a\r", "+b\r"] }] }]],
    ["git: change", `diff --git a/f b/f\nindex 123..456 100644\n--- a/f\n+++ b/f\n${body}`, [{ isGit: true, oldFileName: "a/f", oldHeader: "", newFileName: "b/f", newHeader: "", hunks: [hunk] }]],
    ["git: sections without hunks", [
      "diff --git a/x b/y b/z", "similarity index 100%", "rename from x b/y", 'rename to "z\\n"',
      "diff --git a/c b/d", "copy from c\r", "copy to d",
      "diff --git a/x b/y b/x b/y", "old mode 100644", "new mode 100755",
      'diff --git "a/\\303\\251" "b/\\303\\251"', "new file mode 100644",
      'diff --git a/s "b/\\t"', "deleted file mode 100755",
      'diff --git "a/\\t" b/s', "Binary files a and b differ",
      "diff --git unknown names",
    ].join("\n"), [
      { isGit: true, isRename: true, oldFileName: "a/x b/y", newFileName: "b/z\n", hunks: [] },
      { isGit: true, isCopy: true, oldFileName: "a/c", newFileName: "b/d", hunks: [] },
      { isGit: true, oldMode: "100644", newMode: "100755", oldFileName: "a/x b/y", newFileName: "b/x b/y", hunks: [] },
      { isGit: true, isCreate: true, newMode: "100644", oldFileName: "a/é", newFileName: "b/é", hunks: [] },
      { isGit: true, isDelete: true, oldMode: "100755", oldFileName: "a/s", newFileName: "b/\t", hunks: [] },
      { isGit: true, isBinary: true, oldFileName: "a/\t", newFileName: "b/s", hunks: [] },
      { isGit: true, hunks: [] },
    ]],
    ["an svn section without hunks, then a git section", `Index: e\n${"=".repeat(67)}\nCannot display\ndiff --git a/f b/f\n${body}`, [
      { index: "e", hunks: [] },
      { isGit: true, oldFileName: "a/f", newFileName: "b/f", hunks: [hunk] },
    ]],
    ["two svn sections without hunks", `Index: e\n${"=".repeat(67)}\nIndex: f\n`, [{ index: "e", hunks: [] }, { index: "f", hunks: [] }]],
    ["a rule between git sections", `diff --git a/e b/e\n${"=".repeat(67)}\ndiff --git a/f b/f\n`, [
      { isGit: true, oldFileName: "a/e", newFileName: "b/e", hunks: [] },
      { isGit: true, oldFileName: "a/f", newFileName: "b/f", hunks: [] },
    ]],
    ["only ---", `--- 世\n${body}`, 'Missing "+++ ..." file header for 世'],
    ["only +++", `+++ b\n${body}`, 'Missing "--- ..." file header for b'],
    ["cut after ---", "Index: f\n--- f\n", 'Missing "+++ ..." file header for f'],
    ["cut inside +++", "--- f\n++", 'Missing "+++ ..." file header for f'],
    ["only ---, then a section", "Index: f\n--- f\nIndex: g\n", 'Missing "+++ ..." file header for f'],
    ["a line between --- and +++", `${body}--- f\n\n+++ f\n${body}diff --git a/g b/g\n`, 'Missing "+++ ..." file header for f'],
    ["diff -c", "*** o\n--- n\n***************\n*** 1 ****\n! a\n--- 1 ----\n! b\n", 'Missing "+++ ..." file header for n'],
    ["diff -c, then a git section", "*** o\n--- n\n***************\ndiff --git a/g b/g\n", 'Missing "+++ ..." file header for n'],
    ["Index: and ---, then a git section", "Index: f\n--- f\ndiff --git a/g b/g\n", 'Missing "+++ ..." file header for f'],
    ["a rule and ---, then a git section", `Index: f\r\n${"=".repeat(67)}\r\n--- f\r\ndiff --git a/g b/g\r\n`, 'Missing "+++ ..." file header for f'],
    ["only ---, then a combined hunk", "--- f\n@@@ -1 -1 +1 @@@\ndiff --git a/g b/g\n", 'Missing "+++ ..." file header for f'],
    ["--- and +++ without hunks, then a git section", "diff --cc f\n--- a/f\n+++ b/f\ndiff --git a/g b/g\n", [
      { oldFileName: "a/f", oldHeader: "", newFileName: "b/f", newHeader: "", hunks: [] },
      { isGit: true, oldFileName: "a/g", newFileName: "b/g", hunks: [] },
    ]],
    ["an invalid line", "\n@@ -1 +1 @@\n-a\né\n", "Hunk at line 2 contained invalid line é"],
    ["cut after a newline", "@@ -1 +1,2 @@\n-a\n+b\n", "Hunk at line 1 contained invalid line "],
    ["too few added lines", "@@ -1 +1,2 @@\n-a\n+b", "Added line count did not match for hunk at line 1"],
    ["too few removed lines", "@@ -1,2 +1 @@\n-a\n+b", "Removed line count did not match for hunk at line 1"],
    ["too many lines", `${body} c\n`, "Hunk at line 1 has more lines than expected (expected 1 old lines and 1 new lines)"],
    // diff skips the hunk, returns NaN, or a number that has lost digits.
    ["a header without ranges", "@@ a @@\n", 'Hunk at line 1 does not start with "@@ -start,lines +start,lines @@"'],
    ["only @@", "@@\n-a\n+b\n", 'Hunk at line 1 does not start with "@@ -start,lines +start,lines @@"'],
    ["a header that is not closed", "@@ -1 +1\n", 'Hunk at line 1 does not start with "@@ -start,lines +start,lines @@"'],
    ["a number past 2 ** 31 - 1", "@@ -2147483648 +1 @@\n-a\n+b\n", 'Hunk at line 1 does not start with "@@ -start,lines +start,lines @@"'],
    ["2 ** 31 - 1", "@@ -2147483647 +1 @@\n-a\n+b\n", [{ hunks: [{ ...hunk, oldStart: 2 ** 31 - 1 }] }]],
    // diff takes the signature for a removed line.
    ["git format-patch", `Subject: x\n\n---\n f | 2 +-\n\ndiff --git a/f b/f\n${body}-- \n2.43.0\n`, [{ isGit: true, oldFileName: "a/f", newFileName: "b/f", hunks: [hunk] }]],
    ["more than a signature", `${body}-- a\n`, "Hunk at line 1 has more lines than expected (expected 1 old lines and 1 new lines)"],
    ["an octal escape past 377", '--- "\\456"\n+++ "\\377"\n', [{ oldFileName: '"\\456"', oldHeader: "", newFileName: "\ufffd", newHeader: "", hunks: [] }]],
    ["a long invalid line", `@@ -1 +1 @@\n${"x".repeat(300)}`, `Hunk at line 1 contained invalid line ${"x".repeat(256)}`],
    ["a long name", `--- ${"x".repeat(300)}`, `Missing "+++ ..." file header for ${"x".repeat(256)}`],
    // diff takes them for file headers.
    ["--- and +++ in commit messages", `--- Original Message ---\n> x\n*** w\n--- \n+++y\n+++ y\n--- z\ndiff --git a/x b/y\nrename from x\nrename to y\n-- \n\n--- x\n\ndiff --git a/f b/f\n--- a/f\n+++ b/f\n${body}-- \n\n+++ x\n\ndiff --git a/g b/g\n`, [
      { isGit: true, isRename: true, oldFileName: "a/x", newFileName: "b/y", hunks: [] },
      { isGit: true, oldFileName: "a/f", oldHeader: "", newFileName: "b/f", newHeader: "", hunks: [hunk] },
      { isGit: true, oldFileName: "a/g", newFileName: "b/g", hunks: [] },
    ]],
    ["a removed line too many that starts with --", `${body}--- x\ndiff --git a/f b/f\n`, "Hunk at line 1 has more lines than expected (expected 1 old lines and 1 new lines)"],
    // diff makes two entries of each file.
    ["svn diff --git", `Index: e\n${"=".repeat(67)}\ndiff --git a/e b/e\nnew file mode 100644\nIndex: f\n${"=".repeat(67)}\ndiff --git a/f b/f\n--- a/f\t(revision 1)\n+++ b/f\t(working copy)\n${body}`, [
      { index: "e", isGit: true, isCreate: true, newMode: "100644", oldFileName: "a/e", newFileName: "b/e", hunks: [] },
      { index: "f", isGit: true, oldFileName: "a/f", oldHeader: "(revision 1)", newFileName: "b/f", newHeader: "(working copy)", hunks: [hunk] },
    ]],
    // diff leaves isBinary out.
    ["git: binary patch", "diff --git a/f b/f\nGIT binary patch\nliteral 1\nIcmZPo000310RR91\n", [{ isGit: true, isBinary: true, oldFileName: "a/f", newFileName: "b/f", hunks: [] }]],
  ])("%s", (_, patch, expected) => {
    if (typeof expected === "string") expect(() => diff.parsePatch(patch)).toThrow(new SyntaxError(expected));
    else expect(diff.parsePatch(patch)).toStrictEqual(expected);
  });

  test("many lines of a commit message start with ---", () => {
    const message = Buffer.alloc(6 * 8000, "--- a\n").toString();
    expect(diff.parsePatch(`${message}diff --git a/f b/f\n`)).toHaveLength(1);
  });

  // diff throws, or leaves the \r in a name.
  const withCR = { ...hunk, lines: ["-a\r", "+b\r"] };
  // prettier-ignore
  test.each([
    ["git format-patch", `Subject: x\n\n---\n f | 2 +-\n\ndiff --git a/f b/f\n--- a/f\n+++ b/f\n${body}-- \n2.43.0\n`, [{ isGit: true, oldFileName: "a/f", oldHeader: "", newFileName: "b/f", newHeader: "", hunks: [withCR] }]],
    ["markers alone in the text around the hunks", `+++\nIndex:\ndiff -r abc\n${body}\n---\n+++\n`, [{ hunks: [withCR] }]],
    ["names from diff --git", 'diff --git a/f b/f\ndiff --git "a/\\t" b/世\n', [
      { isGit: true, oldFileName: "a/f", newFileName: "b/f", hunks: [] },
      { isGit: true, oldFileName: "a/\t", newFileName: "b/世", hunks: [] },
    ]],
    ["a kept line without its space", "@@ -1,2 +1,2 @@\n\n-a\n+b\n", [{ hunks: [{ ...hunk, oldLines: 2, newLines: 2, lines: ["\r", "-a\r", "+b\r"] }] }]],
    ["an invalid line", "@@ -1 +1 @@\nx\n", "Hunk at line 1 contained invalid line x"],
    ["cut after a newline", "@@ -1,2 +1,2 @@\n-a\n+b\n\r", "Hunk at line 1 contained invalid line "],
    ["only @@", "@@\n-a\n+b\n", 'Hunk at line 1 does not start with "@@ -start,lines +start,lines @@"'],
  ])("converted to CRLF: %s", (_, patch, expected) => {
    const converted = patch.replaceAll("\n", "\r\n");
    if (typeof expected === "string") expect(() => diff.parsePatch(converted)).toThrow(new SyntaxError(expected));
    else expect(diff.parsePatch(converted)).toStrictEqual(expected);
  });
});

describe("applyPatch", () => {
  const marker = "\\ No newline at end of file";
  const replace = (oldStart: number) => ({ oldStart, lines: ["-a", "+b"] });

  // prettier-ignore
  test.each([
    ["no hunks", "a\r\nb", [], "a\r\nb"],
    ["at oldStart", "a\na\na\n", [replace(2)], "a\nb\na\n"],
    ["later before earlier", "a\nx\na\n", [replace(2)], "a\nx\nb\n"],
    ["nearer before further", "x\na\nx\nx\na\n", [replace(3)], "x\nb\nx\nx\na\n"],
    ["oldStart past the end", "a\n", [replace(2 ** 32 - 1)], "b\n"],
    ["oldStart 0", "a\n", [replace(0)], "b\n"],
    ["the offset carries over", "x\nx\na\na\na\na\n", [replace(1), replace(3)], "x\nx\nb\na\nb\na\n"],
    ["only after the previous hunk", "a\nc\n", [{ oldStart: 2, lines: ["-c"] }, replace(5)], undefined],
    ["among the lines the previous hunk keeps", "c\na\n", [{ oldStart: 1, lines: ["-c", " a"] }, replace(2)], "b\n"],
    ["no match", "x\n", [replace(1)], undefined],
    ["a kept line does not match", "x\na\n", [{ oldStart: 1, lines: [" y", "-a"] }], undefined],
    ["longer than the source", "a", [{ oldStart: 1, lines: ["-a", "-a"] }], undefined],
    ["an insertion without context", "a\nc\n", [{ oldStart: 2, lines: ["+b"] }], "a\nb\nc\n"],
    ["an insertion at the end", "a\n", [{ oldStart: 2, lines: ["+b"] }], "a\nb\n"],
    ["an empty last line", "a\n\n", [{ oldStart: 2, lines: ["-", "+b"] }], "a\nb\n"],
    ["an empty last line, and its newline", "a\n\n", [{ oldStart: 2, lines: ["-", "+b", marker] }], "a\nb"],
    ["keeps an empty line after the last newline", "a\n\na\n", [{ oldStart: 3, lines: ["-a", "+b", " "] }], "a\n\nb\n"],
    ["keeps a line without newline, before the end", "c\na\nx", [{ oldStart: 1, lines: ["-c", " a", marker] }], "a\nx"],
    ["into an empty source", "", [{ oldStart: 1, lines: ["+a"] }], "a\n"],
    ["a kept line without its space", "\na\n", [{ oldStart: 1, lines: ["", "-a", "+b"] }], "\nb\n"],
    ["adds the last newline", "a", [{ oldStart: 1, lines: ["-a", marker, "+a"] }], "a\n"],
    ["adds a last newline that is there", "a\n", [{ oldStart: 1, lines: ["-a", marker, "+a"] }], undefined],
    ["removes the last newline", "a\n", [{ oldStart: 1, lines: ["-a", "+a", marker] }], "a"],
    ["removes a last newline that is not there", "a", [{ oldStart: 1, lines: ["-a", "+a", marker] }], undefined],
    ["no last newline on either side", "a", [{ oldStart: 1, lines: ["-a", marker, "+b", marker] }], "b"],
    ["the same, but there is one", "a\n", [{ oldStart: 1, lines: ["-a", marker, "+b", marker] }], undefined],
    ["LF patch, CRLF source", "a\r\nc\r\n", [replace(1)], "b\r\nc\r\n"],
    ["LF patch, CRLF source, no last newline", "c\r\na", [{ oldStart: 1, lines: [" c", "-a", marker, "+b", marker] }], "c\r\nb"],
    ["CRLF patch, LF source", "a\nc\n", [{ oldStart: 1, lines: ["-a\r", "+b\r"] }], "b\nc\n"],
    ["LF patch, mixed source", "a\r\nc\n", [replace(1)], undefined],
    ["mixed patch, CRLF source", "a\r\n", [{ oldStart: 1, lines: ["-a\r", "+b"] }], "b\n"],
    ["mixed patch, LF source", "a\n", [{ oldStart: 1, lines: ["-a", "+b\r"] }], "b\r\n"],
    ["CRLF, not at oldStart", "x\r\na\r\r\n", [{ oldStart: 1, lines: ["-a\r\r", "+b\r"] }], "x\r\nb\r\n"],
    ["a line that ends with two CRs", "a\r\n", [{ oldStart: 1, lines: ["-a\r\r"] }], undefined],
    ["UTF-16 patch, Latin-1 source", "é\n", [{ oldStart: 1, lines: ["-é", "+世"] }], "世\n"],
    ["Latin-1 patch, UTF-16 source", "é\n世\n", [{ oldStart: 1, lines: ["-é", "+a"] }], "a\n世\n"],
    // diff writes lines twice, or makes up empty ones.
    ["oldStart before the previous hunk", "a\nc\na\n", [{ oldStart: 2, lines: ["-c"] }, replace(1)], "a\nb\n"],
    ["an insertion before the previous hunk", "a\nc\n", [{ oldStart: 2, lines: ["-c"] }, { oldStart: 1, lines: ["+b"] }], undefined],
    ["an insertion past the end", "a\n", [{ oldStart: 4, lines: ["+b"] }], undefined],
    ["an insertion one line past the end", "a\n", [{ oldStart: 3, lines: ["+b"] }], undefined],
    ["removes an empty line after the last newline", "\na\n", [{ oldStart: 3, lines: ["-", "+b"] }], undefined],
    ["adds after an empty line after the last newline", "a\n", [{ oldStart: 1, lines: [" a", " ", "+b"] }], undefined],
    ["removes an empty line of an empty source", "", [{ oldStart: 1, lines: ["-", "+b"] }], undefined],
    // diff leaves half a line ending.
    ["adds after a last line without CRLF", "x\r\na", [{ oldStart: 3, lines: ["+b"] }], undefined],
    ["removes a last line after CRLF", "y\nx\r\na", [{ oldStart: 3, lines: ["-a"] }], undefined],
    ["replaces a last line that ends with CR", "a\r", [{ oldStart: 1, lines: ["-a\r", "+b\r"] }], "b\r"],
    ["adds a last line after CRLF", "a\r\n", [{ oldStart: 1, lines: ["-a\r", "+b\r"] }, { oldStart: 2, lines: ["+c", marker] }], "b\r\nc"],
    ["a CRLF patch with its end trimmed", "x\na\n", [{ oldStart: 2, lines: ["-a\r", "+b\r", marker] }], "x\nb"],
    ["a CRLF patch of last lines with its end trimmed", "x\na", [{ oldStart: 2, lines: ["-a\r", `${marker}\r`, "+b\r", marker] }], "x\nb"],
    // diff takes the \r for a part of a line ending.
    ["a last line that ends with CR", "x\na\r", [{ oldStart: 2, lines: ["-a\r", marker, "+b\r", marker] }], "x\nb\r"],
    // diff changes the last newline wherever the hunk fits.
    ["removes the last newline, before the end", "a\nx\n", [{ oldStart: 1, lines: ["-a", "+b", marker] }], undefined],
    ["adds the last newline, before the end", "a\nx", [{ oldStart: 1, lines: ["-a", marker, "+b"] }], undefined],
    ["removes the last newline, fits at the end too", "a\na\n", [{ oldStart: 1, lines: ["-a", "+b", marker] }], undefined],
  ])("%s", (_, source, hunks, expected) => {
    expect(diff.applyPatch(source, hunks)).toBe(expected);
  });

  test("a string", () => {
    expect(diff.applyPatch("a\n", "")).toBe("a\n");
    expect(diff.applyPatch("é\n", "--- f\n+++ f\n@@ -1 +1 @@\n-é\n+世\n")).toBe("世\n");
    expect(diff.applyPatch("x\n", "@@ -1 +1 @@\n-a\n+b\n")).toBeUndefined();
    expect(diff.applyPatch("x\n", "@@ -2147483647,0 +1 @@\n+b\n")).toBeUndefined();
    expect(() => diff.applyPatch("a\n", "@@ -1 +1 @@\nx")).toThrow(
      new SyntaxError("Hunk at line 1 contained invalid line x"),
    );
    expect(() => diff.applyPatch("a\n", "Index: a\nIndex: b\n")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: "The argument 'patch' must change one file. Received a patch for 2 files",
      }),
    );
  });

  test("svn diff --git", () => {
    const headers = `Index: f\n${"=".repeat(67)}\ndiff --git a/f b/f\n--- a/f\t(revision 1)\n+++ b/f\t(working copy)\n`;
    expect(diff.applyPatch("a\n", `${headers}@@ -1 +1 @@\n-a\n+b\n`)).toBe("b\n");
  });

  // diff throws.
  test.each([
    ["\na\n", "\nb\n"],
    ["\na\n", "\nb"],
    ["\na", "\nb\n"],
    ["\na", "\nb"],
    ["a\nx", "b\nx"],
    ["a", "b"],
    ["", "b"],
  ])("git format-patch converted to CRLF: %j to %j", (a, b) => {
    const crlf = (text: string) => text.replaceAll("\n", "\r\n");
    const patch = crlf(`Subject: x\n\n---\n f | 2 +-\n\ndiff --git a/f b/f\n${diff.createPatch(a, b)}-- \n2.43.0\n`);
    expect([diff.applyPatch(a, patch), diff.applyPatch(crlf(a), patch)]).toEqual([b, crlf(b)]);
  });

  test("hunks that each search the whole source", () => {
    const source = `x\n${Buffer.alloc(100_000, "a\n")}`;
    const hunks = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ oldStart: i % 2 ? 50_000 : 1, lines: [" x"] }));
    expect(diff.applyPatch(source, hunks(20)) === source).toBeTrue();
    expect(diff.applyPatch(source, hunks(2000))).toBeUndefined();
  });

  test("a hunk with the hash of every place", () => {
    const count = isDebug ? 10_000 : 100_000;
    const patch = `@@ -1,${count + 1} +1,${count + 1} @@\n${Buffer.alloc(3 * count, " a\n")} a\r\n`;
    expect(diff.applyPatch(Buffer.alloc(4 * count, "a\n").toString(), patch)).toBeUndefined();
  });

  test("hunks that are longer than a string", () => {
    const lines = Array(2048).fill(`+${Buffer.alloc(2 ** 20, "a")}`);
    expect(() => diff.applyPatch("", [{ oldStart: 1, lines }])).toThrow(
      expect.objectContaining({ code: "ERR_STRING_TOO_LONG" }),
    );
  });

  test("a binary patch", () => {
    expect(() => diff.applyPatch("a", "diff --git a/f b/f\nBinary files a/f and b/f differ\n")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: "The argument 'patch' must change a text file. Received a binary patch",
      }),
    );
  });

  test.each([-1, 1.5, 2 ** 32, 2 ** 63])("oldStart: %p is refused", oldStart => {
    expect(() => diff.applyPatch("a\n", [replace(oldStart)])).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
  });

  test("a parsed file in place of its hunks", () => {
    expect(() => diff.applyPatch("a\n", diff.parsePatch("")[0] as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message: "patch must be a string or an array of hunks" }),
    );
  });

  test("a line without an operation", () => {
    expect(() => diff.applyPatch("a\n", [replace(1), { oldStart: 2, lines: [" a", "+b", "c"] }])).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: `The property 'patch[1].lines[2]' must start with " ", "-", "+" or "\\"`,
      }),
    );
  });

  test("a long hunk that nearly fits everywhere", () => {
    const kept = Buffer.alloc(200_000, "a\n").toString();
    const lines = [...Array(50_000).fill(" a"), "-b"];
    expect(diff.applyPatch(kept, [{ oldStart: 1, lines }])).toBeUndefined();
    expect(diff.applyPatch(kept + "b\n", [{ oldStart: 1, lines }]) === kept).toBeTrue();
  });

  test("undoes createPatch and hunks", () => {
    const next = random(2);
    for (let i = 0; i < 200; i++) {
      const [a, b] = similarPair(
        next,
        ["a\n", "b\n", "\n", "-- a\n", "++ b\n", "\\\n", "@@ -1 +1 @@\n", "世\n"],
        30,
      ).map(lines => lines.join("") + ["", "end"][next(2)]);
      const options = { context: next(4), oldFileName: "f" };
      const [patch, hunks] = [diff.createPatch(a, b, options), diff.hunks(a, b, options)];
      expect({ a, parsed: diff.parsePatch(patch)[0].hunks, patched: diff.applyPatch(a, patch) }).toEqual({
        a,
        parsed: hunks,
        patched: b,
      });
      expect(diff.applyPatch(a, hunks)).toBe(b);
    }
  });
});

test.each([
  ["lines", [1, "a"]],
  ["lines", ["a"]],
  ["lines", ["a", "b", 1]],
  ["words", [null, "a"]],
  ["chars", ["a", ["a"]]],
  ["arrays", ["a", []]],
  ["arrays", [[], { length: 0 }]],
  ["hunks", ["a", Buffer.from("a")]],
  ["createPatch", ["a", "b", { oldFileName: 1 }]],
  ["parsePatch", []],
  ["applyPatch", ["a"]],
  ["applyPatch", ["a", [{ hunks: [] }]]],
  ["applyPatch", ["a", [{ oldStart: 1, lines: [1] }]]],
] as const)("%s(...%j) is refused", (name, args) => {
  expect(() => (diff[name] as Function)(...args)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
});
