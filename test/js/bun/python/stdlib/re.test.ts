// Translated from CPython 3.15's Lib/test/test_re.py: of ReTests, the tests named below (some thirty of about two hundred).
// They are those of the functions of the module and of match objects; the tests of the syntax of patterns do not gain by being
// driven from another language.
// `r` is for raw strings: r`\d+` is r'\d+'.
import { kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import {
  DeprecationWarning,
  IndexError,
  TypeError as PyTypeError,
  bytearray,
  bytes,
  int,
  isinstance,
  len,
  list,
  memoryview,
  repr,
  str,
  tuple,
  type,
} from "python:builtins";
import { getitem, setitem } from "python:operator";
import re from "python:re";
import { b, makeClass, raises, t, warns } from "./helpers";

const r = String.raw;

const S: any = makeClass("S", [str], {
  __getitem__(index: any) {
    return S(str.__getitem__(this, index));
  },
});

const B: any = makeClass("B", [bytes], {
  __getitem__(index: any) {
    return B(bytes.__getitem__(this, index));
  },
});

function assertTypedEqual(actual: any, expected: any) {
  expect(actual).toEqual(expected);
  const recurse = (actual: any, expected: any) => {
    if (isinstance(expected, t(tuple, list))) for (const [i, y] of [...expected].entries()) recurse(actual[i], y);
    else expect(type(actual)).toBe(type(expected));
  };
  recurse(actual, expected);
}

describe("ReTests", () => {
  test("test_search_star_plus", () => {
    expect(re.search("x*", "axx").span(0)).toEqual(t(0, 0));
    expect(re.search("x*", "axx").span()).toEqual(t(0, 0));
    expect(re.search("x+", "axx").span(0)).toEqual(t(1, 3));
    expect(re.search("x+", "axx").span()).toEqual(t(1, 3));
    expect(re.search("x", "aaa")).toBeUndefined();
    expect(re.match("a*", "xxx").span(0)).toEqual(t(0, 0));
    expect(re.prefixmatch("a*", "xxx").span(0)).toEqual(t(0, 0));
    expect(re.match("a*", "xxx").span()).toEqual(t(0, 0));
    expect(re.match("x*", "xxxa").span(0)).toEqual(t(0, 3));
    expect(re.prefixmatch("x*", "xxxa").span(0)).toEqual(t(0, 3));
    expect(re.match("x*", "xxxa").span()).toEqual(t(0, 3));
    expect(re.match("a+", "xxx")).toBeUndefined();
    expect(re.prefixmatch("a+", "xxx")).toBeUndefined();
  });

  // Test expressions using the OR ('|') operator.
  test("test_branching", () => {
    expect(re.match("(ab|ba)", "ab").span()).toEqual(t(0, 2));
    expect(re.match("(ab|ba)", "ba").span()).toEqual(t(0, 2));
    expect(re.match("(abc|bac|ca|cb)", "abc").span()).toEqual(t(0, 3));
    expect(re.match("(abc|bac|ca|cb)", "bac").span()).toEqual(t(0, 3));
    expect(re.match("(abc|bac|ca|cb)", "ca").span()).toEqual(t(0, 2));
    expect(re.match("(abc|bac|ca|cb)", "cb").span()).toEqual(t(0, 2));
    expect(re.match("((a)|(b)|(c))", "a").span()).toEqual(t(0, 1));
    expect(re.match("((a)|(b)|(c))", "b").span()).toEqual(t(0, 1));
    expect(re.match("((a)|(b)|(c))", "c").span()).toEqual(t(0, 1));
  });

  const bump_num = (matchobj: any) => {
    const int_value = int(matchobj.group(0));
    return str(int_value + 1);
  };

  test("test_basic_re_sub", () => {
    assertTypedEqual(re.sub("y", "a", "xyz"), "xaz");
    assertTypedEqual(re.sub("y", S("a"), S("xyz")), "xaz");
    assertTypedEqual(re.sub(b("y"), b("a"), b("xyz")), b("xaz"));
    assertTypedEqual(re.sub(b("y"), B(b("a")), B(b("xyz"))), b("xaz"));
    assertTypedEqual(re.sub(b("y"), bytearray(b("a")), bytearray(b("xyz"))), b("xaz"));
    assertTypedEqual(re.sub(b("y"), memoryview(b("a")), memoryview(b("xyz"))), b("xaz"));
    assertTypedEqual(re.sub(b("y"), Buffer.from("a"), Buffer.from("xyz")), b("xaz"));
    for (const y of ["\xe0", "а", "\u{1d49c}"]) expect(re.sub(y, "a", `x${y}z`)).toBe("xaz");

    expect(re.sub("(?i)b+", "x", "bbbb BBBB")).toBe("x x");
    expect(re.sub(r`\d+`, bump_num, "08.2 -2 23x99y")).toBe("9.3 -3 24x100y");
    expect(
      warns(DeprecationWarning, () => expect(re.sub(r`\d+`, bump_num, "08.2 -2 23x99y", 3)).toBe("9.3 -3 23x99y")),
    ).toHaveLength(1);
    expect(re.sub(r`\d+`, bump_num, "08.2 -2 23x99y", kwargs({ count: 3 }))).toBe("9.3 -3 23x99y");

    expect(re.sub(".", () => r`\n`, "x")).toBe("\\n");
    expect(re.sub(".", r`\n`, "x")).toBe("\n");

    const s = r`\1\1`;
    expect(re.sub("(.)", s, "x")).toBe("xx");
    expect(re.sub("(.)", s.replaceAll("\\", r`\\`), "x")).toBe(s);
    expect(re.sub("(.)", () => s, "x")).toBe(s);

    expect(re.sub("(?P<a>x)", r`\g<a>\g<a>`, "xx")).toBe("xxxx");
    expect(re.sub("(?P<a>x)", r`\g<a>\g<1>`, "xx")).toBe("xxxx");
    expect(re.sub("(?P<unk>x)", r`\g<unk>\g<unk>`, "xx")).toBe("xxxx");
    expect(re.sub("(?P<unk>x)", r`\g<1>\g<1>`, "xx")).toBe("xxxx");
    expect(re.sub("()x", r`\g<0>\g<0>`, "xx")).toBe("xxxx");

    expect(re.sub("a", r`\t\n\v\r\f\a\b`, "a")).toBe("\t\n\v\r\f\x07\b");
    expect(re.sub("a", "\t\n\v\r\f\x07\b", "a")).toBe("\t\n\v\r\f\x07\b");
    expect(re.sub("a", "\t\n\v\r\f\x07\b", "a")).toBe(String.fromCharCode(9, 10, 11, 13, 12, 7, 8));
    for (const c of "cdehijklmopqsuwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
      expect(() => re.sub("a", "\\" + c, "a")).toThrow(re.PatternError);

    expect(re.sub(r`^\s*`, "X", "test")).toBe("Xtest");
  });

  test("test_re_subn", () => {
    expect(re.subn("(?i)b+", "x", "bbbb BBBB")).toEqual(t("x x", 2));
    expect(re.subn("b+", "x", "bbbb BBBB")).toEqual(t("x BBBB", 1));
    expect(re.subn("b+", "x", "xyz")).toEqual(t("xyz", 0));
    expect(re.subn("b*", "x", "xyz")).toEqual(t("xxxyxzx", 4));
    expect(warns(DeprecationWarning, () => expect(re.subn("b*", "x", "xyz", 2)).toEqual(t("xxxyz", 2)))).toHaveLength(
      1,
    );
    expect(re.subn("b*", "x", "xyz", kwargs({ count: 2 }))).toEqual(t("xxxyz", 2));

    raises(
      PyTypeError,
      () => re.subn("a", "b", "aaaaa", 1, kwargs({ count: 1 })),
      /subn\(\) got multiple values for argument 'count'/,
    );
    raises(
      PyTypeError,
      () => re.subn("a", "b", "aaaaa", 1, 0, kwargs({ flags: 0 })),
      /subn\(\) got multiple values for argument 'flags'/,
    );
    raises(
      PyTypeError,
      () => re.subn("a", "b", "aaaaa", 1, 0, 0),
      /subn\(\) takes from 3 to 5 positional arguments but 6 were given/,
    );
  });

  test("test_re_split", () => {
    for (const string of [":a:b::c", S(":a:b::c")]) {
      assertTypedEqual(re.split(":", string), ["", "a", "b", "", "c"]);
      assertTypedEqual(re.split(":+", string), ["", "a", "b", "c"]);
      assertTypedEqual(re.split("(:+)", string), ["", ":", "a", ":", "b", "::", "c"]);
    }
    for (const string of [
      b(":a:b::c"),
      B(b(":a:b::c")),
      bytearray(b(":a:b::c")),
      memoryview(b(":a:b::c")),
      Buffer.from(":a:b::c"),
    ]) {
      assertTypedEqual(re.split(b(":"), string), [b(""), b("a"), b("b"), b(""), b("c")]);
      assertTypedEqual(re.split(b(":+"), string), [b(""), b("a"), b("b"), b("c")]);
      assertTypedEqual(re.split(b("(:+)"), string), [b(""), b(":"), b("a"), b(":"), b("b"), b("::"), b("c")]);
    }
    for (const [a, b, c] of ["\xe0\xdf\xe7", "абв", "\u{1d49c}\u{1d49e}\u{1d4b5}"]) {
      const string = `:${a}:${b}::${c}`;
      expect(re.split(":", string)).toEqual(["", a, b, "", c]);
      expect(re.split(":+", string)).toEqual(["", a, b, c]);
      expect(re.split("(:+)", string)).toEqual(["", ":", a, ":", b, "::", c]);
    }

    expect(re.split("(?::+)", ":a:b::c")).toEqual(["", "a", "b", "c"]);
    expect(re.split("(:)+", ":a:b::c")).toEqual(["", ":", "a", ":", "b", ":", "c"]);
    expect(re.split("([b:]+)", ":a:b::c")).toEqual(["", ":", "a", ":b::", "c"]);
    const None = undefined;
    expect(re.split("(b)|(:+)", ":a:b::c")).toEqual([
      "",
      None,
      ":",
      "a",
      None,
      ":",
      "",
      "b",
      None,
      "",
      None,
      "::",
      "c",
    ]);
    expect(re.split("(?:b)|(?::+)", ":a:b::c")).toEqual(["", "a", "", "", "c"]);

    for (const [sep, expected] of [
      [":*", ["", "", "a", "", "b", "", "c", ""]],
      ["(?::*)", ["", "", "a", "", "b", "", "c", ""]],
      ["(:*)", ["", ":", "", "", "a", ":", "", "", "b", "::", "", "", "c", "", ""]],
      ["(:)*", ["", ":", "", None, "a", ":", "", None, "b", ":", "", None, "c", None, ""]],
    ])
      assertTypedEqual(re.split(sep, ":a:b::c"), expected);

    for (const [sep, expected] of [
      ["", ["", ":", "a", ":", "b", ":", ":", "c", ""]],
      [r`\b`, [":", "a", ":", "b", "::", "c", ""]],
      [r`(?=:)`, ["", ":a", ":b", ":", ":c"]],
      [r`(?<=:)`, [":", "a:", "b:", ":", "c"]],
    ])
      assertTypedEqual(re.split(sep, ":a:b::c"), expected);
  });

  test("test_qualified_re_split", () => {
    expect(
      warns(DeprecationWarning, () => expect(re.split(":", ":a:b::c", 2)).toEqual(["", "a", "b::c"])),
    ).toHaveLength(1);
    expect(re.split(":", ":a:b::c", kwargs({ maxsplit: 2 }))).toEqual(["", "a", "b::c"]);
    expect(re.split(":", "a:b:c:d", kwargs({ maxsplit: 2 }))).toEqual(["a", "b", "c:d"]);
    expect(re.split("(:)", ":a:b::c", kwargs({ maxsplit: 2 }))).toEqual(["", ":", "a", ":", "b::c"]);
    expect(re.split("(:+)", ":a:b::c", kwargs({ maxsplit: 2 }))).toEqual(["", ":", "a", ":", "b::c"]);
    expect(re.split("(:*)", ":a:b::c", kwargs({ maxsplit: 2 }))).toEqual(["", ":", "", "", "a:b::c"]);

    raises(
      PyTypeError,
      () => re.split(":", ":a:b::c", 2, kwargs({ maxsplit: 2 })),
      /split\(\) got multiple values for argument 'maxsplit'/,
    );
    raises(
      PyTypeError,
      () => re.split(":", ":a:b::c", 2, 0, kwargs({ flags: 0 })),
      /split\(\) got multiple values for argument 'flags'/,
    );
    raises(
      PyTypeError,
      () => re.split(":", ":a:b::c", 2, 0, 0),
      /split\(\) takes from 2 to 4 positional arguments but 5 were given/,
    );
  });

  test("test_re_findall", () => {
    expect(re.findall(":+", "abc")).toEqual([]);
    for (const string of ["a:b::c:::d", S("a:b::c:::d")]) {
      assertTypedEqual(re.findall(":+", string), [":", "::", ":::"]);
      assertTypedEqual(re.findall("(:+)", string), [":", "::", ":::"]);
      assertTypedEqual(re.findall("(:)(:*)", string), [t(":", ""), t(":", ":"), t(":", "::")]);
    }
    for (const string of [
      b("a:b::c:::d"),
      B(b("a:b::c:::d")),
      bytearray(b("a:b::c:::d")),
      memoryview(b("a:b::c:::d")),
    ]) {
      assertTypedEqual(re.findall(b(":+"), string), [b(":"), b("::"), b(":::")]);
      assertTypedEqual(re.findall(b("(:+)"), string), [b(":"), b("::"), b(":::")]);
      assertTypedEqual(re.findall(b("(:)(:*)"), string), [t(b(":"), b("")), t(b(":"), b(":")), t(b(":"), b("::"))]);
    }
    for (const x of ["\xe0", "а", "\u{1d49c}"]) {
      const xx = x.repeat(2);
      const xxx = x.repeat(3);
      const string = `a${x}b${xx}c${xxx}d`;
      expect(re.findall(`${x}+`, string)).toEqual([x, xx, xxx]);
      expect(re.findall(`(${x}+)`, string)).toEqual([x, xx, xxx]);
      expect(re.findall(`(${x})(${x}*)`, string)).toEqual([t(x, ""), t(x, x), t(x, xx)]);
    }
  });

  test("test_bug_117612", () => {
    expect(re.findall(r`(a|(b))`, "aba")).toEqual([t("a", ""), t("b", "b"), t("a", "")]);
  });

  test("test_re_match", () => {
    for (const string of ["a", S("a")]) {
      expect(re.match("a", string).groups()).toEqual(t());
      expect(re.match("(a)", string).groups()).toEqual(t("a"));
      expect(re.match("(a)", string).group(0)).toEqual("a");
      expect(re.match("(a)", string).group(1)).toEqual("a");
      expect(re.match("(a)", string).group(1, 1)).toEqual(t("a", "a"));
    }
    for (const string of [b("a"), B(b("a")), bytearray(b("a")), memoryview(b("a"))]) {
      expect(re.match(b("a"), string).groups()).toEqual(t());
      expect(re.match(b("(a)"), string).groups()).toEqual(t(b("a")));
      expect(re.match(b("(a)"), string).group(0)).toEqual(b("a"));
      expect(re.match(b("(a)"), string).group(1)).toEqual(b("a"));
      expect(re.match(b("(a)"), string).group(1, 1)).toEqual(t(b("a"), b("a")));
      expect(re.prefixmatch(b("(a)"), string).group(1, 1)).toEqual(t(b("a"), b("a")));
    }
    for (const a of ["\xe0", "а", "\u{1d49c}"]) {
      expect(re.match(a, a).groups()).toEqual(t());
      expect(re.match(`(${a})`, a).groups()).toEqual(t(a));
      expect(re.match(`(${a})`, a).group(0)).toBe(a);
      expect(re.match(`(${a})`, a).group(1)).toBe(a);
      expect(re.match(`(${a})`, a).group(1, 1)).toEqual(t(a, a));
    }

    const None = undefined;
    let pat = re.compile("((a)|(b))(c)?");
    expect(pat.match("a").groups()).toEqual(t("a", "a", None, None));
    expect(pat.match("b").groups()).toEqual(t("b", None, "b", None));
    expect(pat.match("ac").groups()).toEqual(t("a", "a", None, "c"));
    expect(pat.match("bc").groups()).toEqual(t("b", None, "b", "c"));
    expect(pat.match("bc").groups("")).toEqual(t("b", "", "b", "c"));

    pat = re.compile("(?:(?P<a1>a)|(?P<b2>b))(?P<c3>c)?");
    expect(pat.match("a").group(1, 2, 3)).toEqual(t("a", None, None));
    expect(pat.match("b").group("a1", "b2", "c3")).toEqual(t(None, "b", None));
    expect(pat.match("ac").group(1, "b2", 3)).toEqual(t("a", None, "c"));
  });

  function do_test_match_getitem(match_fn: (string: string) => any) {
    let m = match_fn("a");
    expect(getitem(m, "a1")).toBe("a");
    expect(getitem(m, "b2")).toBeUndefined();
    expect(getitem(m, "c3")).toBeUndefined();
    expect(str.format_map("a1={a1} b2={b2} c3={c3}", m)).toBe("a1=a b2=None c3=None");
    expect(getitem(m, 0)).toBe("a");
    expect(getitem(m, 1)).toBe("a");
    expect(getitem(m, 2)).toBeUndefined();
    expect(getitem(m, 3)).toBeUndefined();
    raises(IndexError, () => getitem(m, "X"), "no such group");
    raises(IndexError, () => getitem(m, -1), "no such group");
    raises(IndexError, () => getitem(m, 4), "no such group");
    raises(IndexError, () => getitem(m, t(0, 1)), "no such group");
    raises(IndexError, () => getitem(m, t(0)), "no such group");
    raises(IndexError, () => str.format_map("a1={a2}", m), "no such group");

    m = match_fn("ac");
    expect(getitem(m, "a1")).toBe("a");
    expect(getitem(m, "b2")).toBeUndefined();
    expect(getitem(m, "c3")).toBe("c");
    expect(str.format_map("a1={a1} b2={b2} c3={c3}", m)).toBe("a1=a b2=None c3=c");
    expect(getitem(m, 0)).toBe("ac");
    expect(getitem(m, 1)).toBe("a");
    expect(getitem(m, 2)).toBeUndefined();
    expect(getitem(m, 3)).toBe("c");

    // Cannot assign.
    expect(() => setitem(m, 0, 1)).toThrow(PyTypeError);
    expect(() => {
      m[0] = 1;
    }).toThrow(PyTypeError);

    // No len().
    expect(() => len(m)).toThrow(PyTypeError);
    expect(m.length).toBeUndefined();

    // With the brackets of JavaScript a number is a subscript, and what there is none for is undefined. A name is an attribute,
    // but of a mapping, which this is not.
    expect(m[0]).toBe("ac");
    expect(m[3]).toBe("c");
    expect(m[4]).toBeUndefined();
    expect(m["a1"]).toBeUndefined();
  }

  test("test_match_getitem", () => {
    const pat = re.compile("(?:(?P<a1>a)|(?P<b2>b))(?P<c3>c)?");
    do_test_match_getitem(pat.match);
  });

  test("test_prefixmatch_getitem", () => {
    const pat = re.compile("(?:(?P<a1>a)|(?P<b2>b))(?P<c3>c)?");
    do_test_match_getitem(pat.prefixmatch);
  });

  test("test_re_fullmatch", () => {
    // Issue 16203: Proposal: add re.fullmatch() method.
    expect(re.fullmatch(r`a`, "a").span()).toEqual(t(0, 1));
    for (const string of ["ab", S("ab")]) expect(re.fullmatch(r`a|ab`, string).span()).toEqual(t(0, 2));
    for (const string of [b("ab"), B(b("ab")), bytearray(b("ab")), memoryview(b("ab"))])
      expect(re.fullmatch(b("a|ab"), string).span()).toEqual(t(0, 2));
    for (const [a, b] of ["\xe0\xdf", "аб", "\u{1d49c}\u{1d49e}"])
      expect(re.fullmatch(`${a}|${a + b}`, a + b).span()).toEqual(t(0, 2));
    expect(re.fullmatch(r`.*?$`, "abc").span()).toEqual(t(0, 3));
    expect(re.fullmatch(r`.*?`, "abc").span()).toEqual(t(0, 3));
    expect(re.fullmatch(r`a.*?b`, "ab").span()).toEqual(t(0, 2));
    expect(re.fullmatch(r`a.*?b`, "abb").span()).toEqual(t(0, 3));
    expect(re.fullmatch(r`a.*?b`, "axxb").span()).toEqual(t(0, 4));
    expect(re.fullmatch(r`a+`, "ab")).toBeUndefined();
    expect(re.fullmatch(r`abc$`, "abc\n")).toBeUndefined();
    expect(re.fullmatch(r`abc\z`, "abc\n")).toBeUndefined();
    expect(re.fullmatch(r`abc\Z`, "abc\n")).toBeUndefined();
    expect(re.fullmatch(r`(?m)abc$`, "abc\n")).toBeUndefined();
    expect(re.fullmatch(r`ab(?=c)cd`, "abcd").span()).toEqual(t(0, 4));
    expect(re.fullmatch(r`ab(?<=b)cd`, "abcd").span()).toEqual(t(0, 4));
    expect(re.fullmatch(r`(?=a|ab)ab`, "ab").span()).toEqual(t(0, 2));

    expect(
      re
        .compile(r`bc`)
        .fullmatch("abcd", kwargs({ pos: 1, endpos: 3 }))
        .span(),
    ).toEqual(t(1, 3));
    expect(
      re
        .compile(r`.*?$`)
        .fullmatch("abcd", kwargs({ pos: 1, endpos: 3 }))
        .span(),
    ).toEqual(t(1, 3));
    expect(
      re
        .compile(r`.*?`)
        .fullmatch("abcd", kwargs({ pos: 1, endpos: 3 }))
        .span(),
    ).toEqual(t(1, 3));
  });

  test("test_groupdict", () => {
    expect(re.match("(?P<first>first) (?P<second>second)", "first second").groupdict()).toEqual({
      first: "first",
      second: "second",
    });
  });

  test("test_expand", () => {
    expect(re.match("(?P<first>first) (?P<second>second)", "first second").expand(r`\2 \1 \g<second> \g<first>`)).toBe(
      "second first second first",
    );
    expect(re.match("(?P<first>first)|(?P<second>second)", "first").expand(r`\2 \g<second>`)).toBe(" ");
  });

  test("test_finditer", () => {
    const groups = (iter: Iterable<any>) => Array.from(iter, item => item.group(0));
    expect(groups(re.finditer(r`:+`, "a:b::c:::d"))).toEqual([":", "::", ":::"]);

    const pat = re.compile(r`:+`);
    expect(groups(pat.finditer("a:b::c:::d", 1, 10))).toEqual([":", "::", ":::"]);
    expect(groups(pat.finditer("a:b::c:::d", kwargs({ pos: 1, endpos: 10 })))).toEqual([":", "::", ":::"]);
    expect(groups(pat.finditer("a:b::c:::d", kwargs({ endpos: 10, pos: 1 })))).toEqual([":", "::", ":::"]);
    expect(groups(pat.finditer("a:b::c:::d", kwargs({ pos: 3, endpos: 8 })))).toEqual(["::", "::"]);
  });

  test("test_match_repr", () => {
    for (const string of ["[abracadabra]", S("[abracadabra]")]) {
      const m = re.search(r`(.+)(.*?)\1`, string);
      expect(repr(m)).toBe("<re.Match object; span=(1, 12), match='abracadabra'>");
    }
    for (const string of [
      b("[abracadabra]"),
      B(b("[abracadabra]")),
      bytearray(b("[abracadabra]")),
      memoryview(b("[abracadabra]")),
    ]) {
      const m = re.search(b(r`(.+)(.*?)\1`), string);
      expect(repr(m)).toBe("<re.Match object; span=(1, 12), match=b'abracadabra'>");
    }

    const [first, second] = list(re.finditer("(aa)|(bb)", "aa bb"));
    expect(repr(first)).toBe("<re.Match object; span=(0, 2), match='aa'>");
    expect(repr(second)).toBe("<re.Match object; span=(3, 5), match='bb'>");
    expect(Bun.inspect(second)).toBe(repr(second));
  });

  test("test_zerowidth", () => {
    // Issues 852532, 1647489, 3262, 25054.
    expect(re.split(r`\b`, "a::bc")).toEqual(["", "a", "::", "bc", ""]);
    expect(re.split(r`\b|:+`, "a::bc")).toEqual(["", "a", "", "", "bc", ""]);
    expect(re.split(r`(?<!\w)(?=\w)|:+`, "a::bc")).toEqual(["", "a", "", "bc"]);
    expect(re.split(r`(?<=\w)(?!\w)|:+`, "a::bc")).toEqual(["a", "", "bc", ""]);

    expect(re.sub(r`\b`, "-", "a::bc")).toBe("-a-::-bc-");
    expect(re.sub(r`\b|:+`, "-", "a::bc")).toBe("-a---bc-");
    expect(re.sub(r`(\b|:+)`, r`[\1]`, "a::bc")).toBe("[]a[][::][]bc[]");

    expect(re.findall(r`\b|:+`, "a::bc")).toEqual(["", "", "::", "", ""]);
    expect(re.findall(r`\b|\w+`, "a::bc")).toEqual(["", "a", "", "", "bc", ""]);

    expect(Array.from(re.finditer(r`\b|:+`, "a::bc"), (m: any) => m.span())).toEqual([
      t(0, 0),
      t(1, 1),
      t(1, 3),
      t(3, 3),
      t(5, 5),
    ]);
    expect(Array.from(re.finditer(r`\b|\w+`, "a::bc"), (m: any) => m.span())).toEqual([
      t(0, 0),
      t(0, 1),
      t(1, 1),
      t(3, 3),
      t(3, 5),
      t(5, 5),
    ]);
  });

  test("test_bug_2537", () => {
    // issue 2537: empty submatches
    for (const outer_op of ["{0,}", "*", "+", "{1,187}"]) {
      for (const inner_op of ["{0,}", "*", "?"]) {
        const pattern = re.compile(`^((x|y)${inner_op})${outer_op}`);
        const m = pattern.match("xyyzy");
        expect(m.group(0)).toBe("xyy");
        expect(m.group(1)).toBe("");
        expect(m.group(2)).toBe("y");
      }
    }
  });

  test("test_keyword_parameters", () => {
    // Issue #20283: Accepting the string keyword parameter.
    const pat = re.compile(r`(ab)`);
    expect(pat.match(kwargs({ string: "abracadabra", pos: 7, endpos: 10 })).span()).toEqual(t(7, 9));
    expect(pat.fullmatch(kwargs({ string: "abracadabra", pos: 7, endpos: 9 })).span()).toEqual(t(7, 9));
    expect(pat.search(kwargs({ string: "abracadabra", pos: 3, endpos: 10 })).span()).toEqual(t(7, 9));
    expect(pat.findall(kwargs({ string: "abracadabra", pos: 3, endpos: 10 }))).toEqual(["ab"]);
    expect(pat.split(kwargs({ string: "abracadabra", maxsplit: 1 }))).toEqual(["", "ab", "racadabra"]);
    expect(
      pat
        .scanner(kwargs({ string: "abracadabra", pos: 3, endpos: 10 }))
        .search()
        .span(),
    ).toEqual(t(7, 9));
  });
});

describe("between the languages", () => {
  test("positions count characters, where JavaScript counts units of UTF-16", () => {
    const text = "a\u{1f600}b";
    const m = re.search("b", text);
    expect(m.start()).toBe(2);
    expect(text.indexOf("b")).toBe(3);
    expect(getitem(text, m.start())).toBe("b");
    expect(text[m.start()]).not.toBe("b");
    expect([...text][m.start()]).toBe("b");
  });

  test("a RegExp is no pattern", () => {
    expect(() => re.search(/b/, "abc")).toThrow(PyTypeError);
  });

  test("flags are combined with |", () => {
    const flags = re.IGNORECASE | re.MULTILINE;
    expect(type(flags)).toBe(re.RegexFlag);
    expect(re.findall("^a", "A\na", flags)).toEqual(["A", "a"]);
    expect(re.compile("a", flags).flags & re.IGNORECASE).toEqual(re.IGNORECASE);
  });
});
