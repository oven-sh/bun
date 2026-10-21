import { jscDescribe } from "bun:jsc";
import { describe, expect, test } from "bun:test";

// Coverage for oven-sh/WebKit#848 (#45860). Every replace loop with a function replacer now keeps
// the replacer's results as JSString cells and writes them into the result string once, instead
// of resolving each one into a WTF::String per match. The first case is the observable difference:
// a rope the replacer returned is still a rope after the call. The other cases pin what has to
// stay the same on each of those loops: the global regexp loop, the generic call loop (bound and
// host callables, non-global regexps), the string search loops, and the string replace cache path
// (a subject of 4096 characters or more).

const rope = (a: string, b: string) => a + b;
const ropeReplacer = (match: string, offset: number) => rope("<" + offset, match + ">");
const wideReplacer = (match: string) => rope("\u2603", match);
const big = Buffer.alloc(6000, "ab").toString();

describe.concurrent("a function replacer's result is written into the result string", () => {
  test("a rope the replacer returned is not resolved by the replace", () => {
    // `rope` concatenates two flat strings at run time, which makes a rope. Before the change,
    // every loop resolved that rope into a flat string as a side effect of the replace.
    const shapes: ((fn: (match: string) => string) => string)[] = [
      fn => "a-b-c".replace(/-/g, fn),
      fn => "a-b-c".replace(/-/, fn),
      fn => "a-b-c".replace(/-/g, fn.bind(null)),
      fn => "a-b-c".replace("-", fn),
      fn => "a-b-c".replaceAll("-", fn),
      fn => big.replace(/b/g, fn),
      fn => big.replace(/(b)/g, fn),
    ];
    for (const shape of shapes) {
      let kept = "";
      shape(match => (kept = rope("<", match)));
      expect(jscDescribe(kept)).toContain("(rope)");
      expect(kept.length).toBe(2);
    }
  });

  test("rope and 16-bit results on every loop", () => {
    for (const fn of [ropeReplacer, ropeReplacer.bind(null)]) {
      expect("a-b-c".replace(/-/g, fn)).toBe("a<1->b<3->c");
      expect("a-b-c".replaceAll(/-/g, fn)).toBe("a<1->b<3->c");
      expect("a-b-c".replace(/-/, fn)).toBe("a<1->b-c");
      expect("a-b-c".replace("-", fn)).toBe("a<1->b-c");
      expect("a-b-c".replaceAll("-", fn)).toBe("a<1->b<3->c");
      expect("\u3042-\u3044".replace(/-/g, fn)).toBe("\u3042<1->\u3044");
    }
    for (const fn of [wideReplacer, wideReplacer.bind(null)]) {
      expect("a-b-c".replace(/-/g, fn)).toBe("a\u2603-b\u2603-c");
      expect("a-b-c".replace(/-/, fn)).toBe("a\u2603-b-c");
      expect("a-b-c".replace("-", fn)).toBe("a\u2603-b-c");
      expect("a-b-c".replaceAll("-", fn)).toBe("a\u2603-b\u2603-c");
    }
    expect("a1a2".replace(/\d/g, parseInt as any)).toBe("aNaNa2");
    expect("a1b22".replace(/(\d)(\d)?/g, (m, a, b, offset) => rope(String(b), a + offset))).toBe("aundefined11b223");
    expect("a1b22".replace(/(?<d>\d)/g, (m, d, offset, string, groups) => rope(groups.d, "!"))).toBe("a1!b2!2!");
    expect("abc".replace(/z/g, ropeReplacer)).toBe("abc");
  });

  test("one match in a short string and in a long string", () => {
    expect("my-file(1)-copy.jpg".replace(/[()]/g, ropeReplacer)).toBe("my-file<7(>1<9)>-copy.jpg");
    const long = "x".repeat(300) + "-" + "y".repeat(300);
    expect(long.replace(/-/g, ropeReplacer)).toBe("x".repeat(300) + "<300->" + "y".repeat(300));
    expect(long.replace(/-/g, wideReplacer)).toBe("x".repeat(300) + "\u2603-" + "y".repeat(300));
    expect(long.replace("-", ropeReplacer)).toBe("x".repeat(300) + "<300->" + "y".repeat(300));
  });

  test("the results survive a GC inside the replacer, with more matches than the inline list holds", () => {
    const subject = "a".repeat(40);
    let expected = "";
    for (let i = 0; i < 40; ++i) expected += "<" + i + "a>";
    const replacer = (match: string, offset: number) => {
      if (offset % 7 === 0) Bun.gc(true);
      return rope("<" + offset, match + ">");
    };
    expect(subject.replace(/a/g, replacer)).toBe(expected);
    expect(subject.replace(/(a)/g, (match, capture, offset) => replacer(capture, offset))).toBe(expected);
    expect(subject.replace(/a/g, replacer.bind(null))).toBe(expected);
    expect(subject.replaceAll("a", replacer)).toBe(expected);
  });

  test("the same cell returned for every match", () => {
    const shallow = rope("<", ">");
    let deep = "";
    for (let i = 0; i < 100; ++i) deep = rope(deep, String.fromCharCode(97 + (i % 26)));
    const subject = "a".repeat(20);
    for (const result of [shallow, deep]) {
      const expected = result.repeat(20);
      const replacer = (match: string, offset: number) => {
        if (offset % 5 === 0) Bun.gc(true);
        return result;
      };
      expect(subject.replace(/a/g, replacer)).toBe(expected);
      expect(subject.replace(/(a)/g, replacer)).toBe(expected);
      expect(subject.replace(/a/g, replacer.bind(null))).toBe(expected);
      expect(subject.replaceAll("a", replacer)).toBe(expected);
      expect(subject.replace(/a/, replacer)).toBe(result + "a".repeat(19));
      expect(subject.replace("a", replacer)).toBe(result + "a".repeat(19));
    }
  });

  test("an object result is converted once per match, in order, and a throw discards the result", () => {
    const log: number[] = [];
    const replacer = (match: string, offset: number) => ({
      toString() {
        log.push(offset);
        return rope("[", offset + "]");
      },
    });
    expect("a-b-c-d".replace(/-/g, replacer as any)).toBe("a[1]b[3]c[5]d");
    expect("a-b-c-d".replace(/-/g, replacer.bind(null) as any)).toBe("a[1]b[3]c[5]d");
    expect("a-b-c-d".replaceAll("-", replacer as any)).toBe("a[1]b[3]c[5]d");
    expect(log).toEqual([1, 3, 5, 1, 3, 5, 1, 3, 5]);

    const throwing = (match: string, offset: number) => ({
      toString() {
        if (offset === 3) throw new Error("toString at " + offset);
        return "x";
      },
    });
    expect(() => "a-b-c-d".replace(/-/g, throwing as any)).toThrow("toString at 3");
    expect(() => "a-b-c-d".replace(/-/g, throwing.bind(null) as any)).toThrow("toString at 3");
    expect(() => "a-b-c-d".replaceAll("-", throwing as any)).toThrow("toString at 3");
    expect(() => "a-b-c-d".replace(/-/g, () => Symbol() as any)).toThrow(TypeError);
  });

  test("the string replace cache path, with and without captures", () => {
    expect(big.replace(/b/g, c => c + c)).toBe("abb".repeat(3000));
    expect(big.replace(/b/g, (c, i) => (i === 11 ? "\u2603" : c))).toBe("ab".repeat(5) + "a\u2603" + "ab".repeat(2994));
    expect(big.replace(/(a)(b)/g, (m, a, b, i) => b + a + (i % 7)).slice(0, 12)).toBe("ba0ba2ba4ba6");
    expect(big.replace(/(a)(b)/g, (m, a, b, i) => (i === 0 ? "\u2603" : "")).length).toBe(1);
    const log: number[] = [];
    expect(big.replace(/(a)(b)/g, (m, a, b, i) => ({ toString: () => (log.push(i), "x") }) as any).slice(-3)).toBe(
      "xxx",
    );
    expect(log.length).toBe(3000);
    expect(() =>
      big.replace(/(a)(b)/g, (m, a, b, i) => {
        if (i === 100) throw new Error("at 100");
        return "x";
      }),
    ).toThrow("at 100");
    expect(big.replace(/z/g, () => "x")).toBe(big);
  });
});
