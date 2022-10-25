import { OnigurumaRegExp } from "bun";
import { expect, it, test } from "bun:test";
import { gc as gcTrace } from "./gc";

it("escaped characters in character classes", () => {
  let r1 = new RegExp("^([[(]-?[\\d]+)?,?(-?[\\d]+[\\])])?$").exec("(1,1]");
  let r2 = new OnigurumaRegExp("^([[(]-?[\\d]+)?,?(-?[\\d]+[\\])])?$").exec("(1,1]");
  expect(r1[0]).toBe(r2[0]);

  let r3 = new RegExp("[\\d],[\\d]").exec("1,2");
  let r4 = new OnigurumaRegExp("[\\d],[\\d]").exec("1,2");
  expect(r3[0]).toBe(r4[0]);

  let r5 = new RegExp("^[(],[)]?$").exec("(,");
  let r6 = new OnigurumaRegExp("^[(],[)]?$").exec("(,");
  expect(r5[0]).toBe(r6[0]);

  let r9 = new RegExp("[([],[)\\]]").exec("[,]");
  let r10 = new OnigurumaRegExp("[([],[)\\]]").exec("[,]");
  expect(r9[0]).toBe(r10[0]);

  let r13 = new RegExp("\\[").exec("[");
  let r14 = new OnigurumaRegExp("\\[").exec("[");
  expect(r13[0]).toBe(r14[0]);

  let r15 = new RegExp("\\]").exec("]");
  let r16 = new OnigurumaRegExp("\\]").exec("]");
  expect(r15[0]).toBe(r16[0]);

  let r17 = new RegExp("]").exec("]");
  let r18 = new OnigurumaRegExp("]").exec("]");
  expect(r17[0]).toBe(r18[0]);

  let r21 = new RegExp("[\\]]").exec("]");
  let r22 = new OnigurumaRegExp("[\\]]").exec("]");
  expect(r21[0]).toBe(r22[0]);

  let r23 = new RegExp("[\\[]").exec("[");
  let r24 = new OnigurumaRegExp("[\\[]").exec("[");
  expect(r23[0]).toBe(r24[0]);

  let r25 = new RegExp("[[][[]").exec("[[");
  let r26 = new OnigurumaRegExp("[[][[]").exec("[[");
  expect(r25[0]).toBe(r26[0]);

  let r27 = new RegExp("[[\\]][[\\]]").exec("[]");
  let r28 = new OnigurumaRegExp("[[\\]][[\\]]").exec("[]");
  expect(r27[0]).toBe(r28[0]);

  let r29 = new RegExp("[[\\]][[\\]]").exec("][");
  let r30 = new OnigurumaRegExp("[[\\]][[\\]]").exec("][");
  expect(r29[0]).toBe(r30[0]);

  let r31 = new RegExp("[[\\]][[\\]]").exec("]]");
  let r32 = new OnigurumaRegExp("[[\\]][[\\]]").exec("]]");
  expect(r31[0]).toBe(r32[0]);
  
  let r33 = new RegExp("[\\]][\\]]").exec("]]");
  let r34 = new OnigurumaRegExp("[\\]][\\]]").exec("]]");
  expect(r33[0]).toBe(r34[0]);
  
  let r35 = new RegExp("[a-z&&[^aeiou]").exec("a");
  let r36 = new OnigurumaRegExp("[a-z&&[^aeiou]").exec("a");
  expect(r35[0]).toBe(r36[0]);
  
  let r37 = new RegExp("[a-z&&[^aeiou]]").exec("a]");
  let r38 = new OnigurumaRegExp("[a-z&&[^aeiou]]").exec("a]");
  expect(r37[0]).toBe(r38[0]);
});

it("OnigurumaRegExp.prototype.exec()", () => {
  let a1 = new OnigurumaRegExp("\x3e", "gd");
  let a1_1 = a1.exec("table fo\x3eotball, fo\x3eosball");
  a1_1 = a1.exec("table fo\x3eotball, fo\x3eosball");

  let a2 = new RegExp("\x3e", "gd");
  let a2_1 = a2.exec("table fo\x3eotball, fo\x3eosball");
  a2_1 = a2.exec("table fo\x3eotball, fo\x3eosball");

  expect(a1_1[0]).toBe(a2_1[0]);
  expect(a1_1[1]).toBe(a2_1[1]);
  expect(a1_1.index).toBe(a2_1.index);
  expect(a1_1.input).toBe(a2_1.input);
  expect(a1.lastIndex).toBe(a2.lastIndex);
  expect(a1_1.groups).toBe(a2_1.groups);
  expect(a1_1.indices[0][0]).toBe(a2_1.indices[0][0]);
  expect(a1_1.indices[0][1]).toBe(a2_1.indices[0][1]);
});

test("OnigurumaRegExp.prototype.exec() 2", () => {
  let a1 = new OnigurumaRegExp("\x3e\\x5e", "gd");
  let a1_1 = a1.exec("table fo\x3e\x5eotball, fo\x3e\x5eosball");
  a1_1 = a1.exec("table fo\x3e\x5eotball, fo\x3e\x5eosball");

  let a2 = new RegExp("\x3e\\x5e", "gd");
  let a2_1 = a2.exec("table fo\x3e\x5eotball, fo\x3e\x5eosball");
  a2_1 = a2.exec("table fo\x3e\x5eotball, fo\x3e\x5eosball");

  expect(a1_1[0]).toBe(a2_1[0]);
  expect(a1_1[1]).toBe(a2_1[1]);
  expect(a1_1.index).toBe(a2_1.index);
  expect(a1_1.input).toBe(a2_1.input);
  expect(a1.lastIndex).toBe(a2.lastIndex);
  expect(a1_1.groups).toBe(a2_1.groups);
  expect(a1_1.indices[0][0]).toBe(a2_1.indices[0][0]);
  expect(a1_1.indices[0][1]).toBe(a2_1.indices[0][1]);
});

test("OnigurumaRegExp.prototype.exec() 3", () => {

  let a22 = new OnigurumaRegExp("\\x9\\x5e", "gd");
  let a22_1 = a22.exec("table fox9\^otball, fox9\^osball");
  expect(a22_1[0]).toBe("x9^");

  let a1 = new OnigurumaRegExp("x3\\x5e", "gd");
  let a1_1 = a1.exec("table fo\\x3\x5eotball, fo\\x3\x5eosball");

  let a2 = new RegExp("\\x3\\x5e", "gd");
  let a2_1 = a2.exec("table fo\\x3\x5eotball, fo\\x3\x5eosball");

  expect(a1_1[0]).toBe(a2_1[0]);
  expect(a1_1[1]).toBe(a2_1[1]);
  expect(a1_1.index).toBe(a2_1.index);
  expect(a1_1.input).toBe(a2_1.input);
  expect(a1.lastIndex).toBe(a2.lastIndex);
  expect(a1_1.groups).toBe(a2_1.groups);
  expect(a1_1.indices[0][0]).toBe(a2_1.indices[0][0]);
  expect(a1_1.indices[0][1]).toBe(a2_1.indices[0][1]);
});

test("OnigurumaRegExp.prototype.exec() 4", () => {
  let a2 = new RegExp("\\x3\\x5e", "gd");
  let a2_1 = a2.exec("table fox3\^otball, fox3\^osball");
  a2_1 = a2.exec("table fox3\^otball, fox3\^osball");

  for (const RegExpConstructor of [OnigurumaRegExp, RegExp]) {
    let a2 = new RegExpConstructor("\\x3\\x5e", "gd");
    let a2_1 = a2.exec("table fox3\^otball, fox3\^osball");
    expect(a2_1[0]).toBe("x3^");

    expect(new RegExpConstructor("\\x3").source).toBe("\\x3");
    expect(new RegExpConstructor("\\x").source).toBe("\\x");
    expect(new RegExpConstructor("\\a").source).toBe("\\a");
    expect(new RegExpConstructor("j\\x3\\x2").source).toBe("j\\x3\\x2");
    expect(new RegExpConstructor("\\x3\\x5\\j").source).toBe("\\x3\\x5\\j");
    expect(new RegExpConstructor("\\x3\\x7\\xa").source).toBe("\\x3\\x7\\xa");
    expect(new RegExpConstructor("\\j323\\x7\\xa").source).toBe("\\j323\\x7\\xa");
    expect(new RegExpConstructor("\\x56").test("V")).toBe(true);
  }
});

test("OnigurumaRegExp.prototype.test()", () => {
  expect(new RegExp("\\\\(?![*+?^${}(|)[\\]])", "g").test('\\')).toBe(true);
  expect(new OnigurumaRegExp("\\\\(?![*+?^${}(|)[\\]])", "g").test('\\')).toBe(true);

  expect(new RegExp("\\x56").test("V")).toBe(true);
  expect(new OnigurumaRegExp("\\x56").test("V")).toBe(true);

  expect(new RegExp('//').compile('\\\\(?![*+?^${}(|)[\\]])', 'g').test('\\')).toBe(true);
  let r = new OnigurumaRegExp('//');
  expect(r.compile('\\\\(?![*+?^${}(|)[\\]])', 'g').test('\\')).toBe(true);
  expect(new OnigurumaRegExp('').compile('\\\\(?![*+?^${}(|)[\\]])', 'g').test('\\')).toBe(true);
});

test("OnigurumaRegExp flag order", () => {
  expect(new OnigurumaRegExp("a", "gd").toString()).toBe("/a/dg");
  expect(new OnigurumaRegExp("a", "ydmg").toString()).toBe("/a/dgmy");
});

test("OnigurumaRegExp.prototype.source", () => {
  let a1 = new OnigurumaRegExp("(foo)", "gd");
  let a2 = new RegExp("(foo)", "dg");
  expect(a1.source).toBe(a2.source);

  expect(new OnigurumaRegExp("/").source).toBe("\\/");
  expect(new RegExp("/").source).toBe("\\/");

  expect(new OnigurumaRegExp().source).toBe(new RegExp().source);
  expect(new OnigurumaRegExp("").source).toBe(new RegExp("").source);
  expect(new OnigurumaRegExp("a").source).toBe(new RegExp("a").source);
  expect(new OnigurumaRegExp("a", "g").source).toBe(
    new RegExp("a", "g").source
  );
  expect(new OnigurumaRegExp("/").source).toBe(new RegExp("/").source);
  expect(new OnigurumaRegExp("\n").source).toBe(new RegExp("\n").source);
  expect(new OnigurumaRegExp("\r").source).toBe(new RegExp("\r").source);
});

test("OnigurumaRegExp.prototype.toString()", () => {
  expect(new OnigurumaRegExp().toString()).toBe(new RegExp().toString());
  expect(new OnigurumaRegExp("").toString()).toBe(new RegExp("").toString());
  expect(new OnigurumaRegExp("a").toString()).toBe(new RegExp("a").toString());
  expect(new OnigurumaRegExp("a", "g").toString()).toBe(
    new RegExp("a", "g").toString()
  );
  expect(new OnigurumaRegExp("/").toString()).toBe(new RegExp("/").toString());
  expect(new OnigurumaRegExp("\n").toString()).toBe(
    new RegExp("\n").toString()
  );
  expect(new OnigurumaRegExp("\r").toString()).toBe(
    new RegExp("\r").toString()
  );
  expect(
    new OnigurumaRegExp(
      "jf/.a.,voejpjoajglz;/qwjopeiv\\//\\/jpoqaj/Zdkj"
    ).toString()
  ).toBe(
    new RegExp("jf/.a.,voejpjoajglz;/qwjopeiv\\//\\/jpoqaj/Zdkj").toString()
  );
});

test("OnigurumaRegExp flags", () => {
  // multiline option
  for (const RegExpConstructor of [OnigurumaRegExp, RegExp]) {
    expect(new RegExpConstructor("boat").test("sailor\nboat")).toBe(true);
    expect(new RegExpConstructor("^boat").test("sailor\nboat")).toBe(false);
    expect(new RegExpConstructor("^boat", "m").test("sailor\nboat")).toBe(true);
  }

  // sticky option
  for (const RegExpConstructor of [RegExp]) {
    let str2 = "sailor";
    let h3 = new RegExpConstructor("or");
    let h4 = new RegExpConstructor("or", "y");
    expect(h3.test(str2)).toBe(true);
    expect(h4.test(str2)).toBe(false);
    let g1 = new RegExpConstructor("sail");
    let g2 = new RegExpConstructor("sail", "y");
    expect(g1.test(str2)).toBe(true);
    expect(g2.test(str2)).toBe(true);
  }

  expect(/a/s.toString()).toBe("/a/s");
  expect(/a/g.toString()).toBe("/a/g");
  expect(/a/y.toString()).toBe("/a/y");
  expect(/a/m.toString()).toBe("/a/m");
  expect(/a/sg.toString()).toBe("/a/gs");
  expect(/a/ys.toString()).toBe("/a/sy");
  expect(/a/gm.toString()).toBe("/a/gm");
  expect(/a/sgy.toString()).toBe("/a/gsy");
  expect(/a/sgm.toString()).toBe("/a/gms");
  expect(/a/ymg.toString()).toBe("/a/gmy");
  // expect(/a/d.toString()).toBe("/a/d");
  // expect(/a/dgimsuy.toString()).toBe("/a/dgimsuy");


  // case insensitive option
  for (const RegExpConstructor of [OnigurumaRegExp, RegExp]) {
    expect(new RegExpConstructor("Is ThIs SqL?").test("IS THIS SQL?")).toBe(
      false
    );
    expect(
      new RegExpConstructor("Is ThIs SqL?", "i").test("IS THIS SQL?")
    ).toBe(true);
  }

  // dotall option
  for (const RegExpConstructor of [OnigurumaRegExp, RegExp]) {
    expect(new RegExpConstructor("a.b").test("a\nb")).toBe(false);
    expect(new RegExpConstructor("a.b", "s").test("a\nb")).toBe(true);
  }

  // indices option
  for (const RegExpConstructor of [OnigurumaRegExp, RegExp]) {
    expect(new RegExpConstructor("a", "g").exec("a").indices).toBe(undefined);
    expect(new RegExpConstructor("a", "gd").exec("a").index).toBe(0);
    expect(new RegExpConstructor("a", "dg").exec("a").index).toBe(0);
  }
});

test("OnigurumaRegExp.lastIndex", () => {
  for (const RegExpConstructor of [RegExp, OnigurumaRegExp]) {
    let a = new RegExpConstructor("foo", "g");
    expect(a.lastIndex).toBe(0);
    a.lastIndex = 1;
    expect(a.lastIndex).toBe(1);
    a.lastIndex = 0;
    expect(a.lastIndex).toBe(0);
    a.lastIndex = 1;
    expect(a.lastIndex).toBe(1);
    a.test("kfjekf");
    expect(a.lastIndex).toBe(0);
    a.test("o");
    expect(a.lastIndex).toBe(0);
  }

  let p1 = new OnigurumaRegExp("a");
  expect(p1.lastIndex).toBe(0);
  p1.lastIndex = 2;
  expect(p1.lastIndex).toBe(2);
  let p2 = new OnigurumaRegExp("b");
  expect(p2.lastIndex).toBe(0);
  p2.lastIndex = 2348;
  expect(p2.lastIndex).toBe(2348);
  expect(p1.lastIndex).toBe(2);

  for (const RegExpConstructor of [RegExp, OnigurumaRegExp]) {
    let a = new RegExpConstructor("foo", "g");
    a.lastIndex = 33;
    expect(a.lastIndex).toBe(33);
    a.compile("bar");
    expect(a.lastIndex).toBe(0);
    a.lastIndex = 44;
    expect(a.lastIndex).toBe(44);
  }

  for (const RegExpConstructor of [OnigurumaRegExp]) {
    let a = new RegExpConstructor("foo", "g");
    expect(a.lastIndex).toBe(0);
    a.test("kfjekfoofjekf");
    expect(a.lastIndex).toBe(8);
    a.test("kejfkjs");
    expect(a.lastIndex).toBe(0);
    a.exec("kfjekfoofjekf");
    expect(a.lastIndex).toBe(8);
    a.exec("kejfkjs");
    expect(a.lastIndex).toBe(0);
  }
});

test("OnigurumaRegExp errors", () => {
  let r = new OnigurumaRegExp("a", "igsym");
  let b = new OnigurumaRegExp("l", "m");
  try {
    r.compile(b, "g");
  } catch (e) {
    expect(e.message).toBe(
      "Cannot supply flags when constructing one RegExp from another."
    );
  }
  try {
    r.compile("ll", "a");
  } catch (e) {
    expect(e.message).toBe("Invalid flags supplied to RegExp constructor.");
  }
  try {
    new OnigurumaRegExp("c", "a");
  } catch (e) {
    expect(e.message).toBe("Invalid flags supplied to RegExp constructor.");
  }
  const invalidRegExpError = "Invalid regular expression: ";
  try {
    new OnigurumaRegExp("?", "g");
  } catch (e) {
    expect(e.message.substring(0, invalidRegExpError.length)).toBe(
      invalidRegExpError
    );
  }
  try {
    new OnigurumaRegExp("?");
  } catch (e) {
    expect(e.message.substring(0, invalidRegExpError.length)).toBe(
      invalidRegExpError
    );
  }
  try {
    r.compile("?", "g");
  } catch (e) {
    expect(e.message.substring(0, invalidRegExpError.length)).toBe(
      invalidRegExpError
    );
  }
  try {
    r.compile("?");
  } catch (e) {
    expect(e.message.substring(0, invalidRegExpError.length)).toBe(
      invalidRegExpError
    );
  }

  try {
    new OnigurumaRegExp("\\");
  } catch (e) {
    expect(e.message.substring(0, invalidRegExpError.length)).toBe(
      invalidRegExpError
    );
  }
});

test("OnigurumaRegExp random", () => {
  expect(new OnigurumaRegExp("love").test("I love JavaScript")).toBe(true);
  expect(new RegExp("love").test("I love JavaScript")).toBe(true);

  expect(new OnigurumaRegExp("a").test("sailor")).toBe(true);
  expect(new OnigurumaRegExp("or").test("sailor")).toBe(true);
  expect(new RegExp("a").test("sailor")).toBe(true);
  expect(new RegExp("or").test("sailor")).toBe(true);

  expect(new OnigurumaRegExp("a").test("a")).toBe(true);
  expect(new OnigurumaRegExp("a").test("b")).toBe(false);
  expect(new OnigurumaRegExp("a", "i").test("a")).toBe(true);
  expect(new OnigurumaRegExp("a", "i").test("A")).toBe(true);
  expect(new OnigurumaRegExp("a", "g").test("A")).toBe(false);
  expect(new OnigurumaRegExp("A", "i").test("a")).toBe(true);
  expect(new OnigurumaRegExp("A", "g").test("a")).toBe(false);
  expect(new OnigurumaRegExp("afasdfebadf", "i").test("b")).toBe(false);

  let r = new OnigurumaRegExp("a", "g");
  expect(r.source).toBe("a");
  expect(r.flags).toBe("g");
  expect(r.toString()).toBe("/a/g");

  r.compile("b", "i");
  expect(r.source).toBe("b");
  expect(r.flags).toBe("i");
  expect(r.toString()).toBe("/b/i");

  let b = new OnigurumaRegExp("l", "m");
  expect(r.compile(b) instanceof OnigurumaRegExp).toBe(true);
  expect(r.source).toBe("l");
  expect(r.flags).toBe("m");
  expect(r.toString()).toBe("/l/m");

  expect(new OnigurumaRegExp("a", "d").hasIndices).toBe(true);
  expect(new OnigurumaRegExp("a", "i").hasIndices).toBe(false);
  expect(new OnigurumaRegExp("a", "s").dotAll).toBe(true);
  expect(new OnigurumaRegExp("a", "i").dotAll).toBe(false);
  expect(new OnigurumaRegExp("a", "i").ignoreCase).toBe(true);
  expect(new OnigurumaRegExp("a", "s").ignoreCase).toBe(false);
  expect(new OnigurumaRegExp("a", "g").global).toBe(true);
  expect(new OnigurumaRegExp("a", "s").global).toBe(false);
  expect(new OnigurumaRegExp("a", "m").multiline).toBe(true);
  expect(new OnigurumaRegExp("a", "s").multiline).toBe(false);
  expect(new OnigurumaRegExp("a", "y").sticky).toBe(true);
  expect(new OnigurumaRegExp("a", "i").sticky).toBe(false);
  expect(new OnigurumaRegExp("a", "u").unicode).toBe(true);
  expect(new OnigurumaRegExp("a", "d").unicode).toBe(false);
  expect(new RegExp("a", "d").hasIndices).toBe(true);
  expect(new RegExp("a", "i").hasIndices).toBe(false);
  expect(new RegExp("a", "s").dotAll).toBe(true);
  expect(new RegExp("a", "i").dotAll).toBe(false);
  expect(new RegExp("a", "i").ignoreCase).toBe(true);
  expect(new RegExp("a", "s").ignoreCase).toBe(false);
  expect(new RegExp("a", "g").global).toBe(true);
  expect(new RegExp("a", "s").global).toBe(false);
  expect(new RegExp("a", "m").multiline).toBe(true);
  expect(new RegExp("a", "s").multiline).toBe(false);
  expect(new RegExp("a", "y").sticky).toBe(true);
  expect(new RegExp("a", "i").sticky).toBe(false);
  expect(new RegExp("a", "u").unicode).toBe(true);
  expect(new RegExp("a", "d").unicode).toBe(false);
});

it("String.prototype.replace", () => {
  for (let RegExpConstructor of [OnigurumaRegExp, RegExp]) {
    const r = new RegExpConstructor("a", "g");
    expect("a".replace(r, "b")).toBe("b");
    expect("a".replace(r, () => "b")).toBe("b");
    expect(
      "a".replace(r, (match, offset, string) => {
        expect(match).toBe("a");
        expect(offset).toBe(0);
        expect(string).toBe("a");
        return "b";
      })
    ).toBe("b");
  }

  expect("aaaaaa".replace(new OnigurumaRegExp("a", "g"), "b")).toBe("bbbbbb");
  expect("aaaaaa".replace(new OnigurumaRegExp("a"), "b")).toBe("baaaaa");
  // case sensitive
  expect("aaaaaa".replace(new OnigurumaRegExp("A", "i"), "b")).toBe("baaaaa");
  expect("aaaaaa".replace(new OnigurumaRegExp("A"), "b")).toBe("aaaaaa");

  expect("aaaaaa".replace(new RegExp("a", "g"), "b")).toBe("bbbbbb");
  expect("aaaaaa".replace(new RegExp("a"), "b")).toBe("baaaaa");
});

it("Strings.prototype.match", () => {
  let str = "The rain in SPAIN stays mainly in the plain";
  for (let RegExpConstructor of [OnigurumaRegExp, RegExp]) {
    let r1 = new RegExpConstructor("ain", "g");
    let m1 = str.match(r1);
    expect(m1[0]).toBe("ain");
    expect(m1[1]).toBe("ain");
    expect(m1[2]).toBe("ain");

    r1.compile("ain", "ig");
    m1 = str.match(r1);
    expect(m1[0]).toBe("ain");
    expect(m1[1]).toBe("AIN");
    expect(m1[2]).toBe("ain");
    expect(m1[3]).toBe("ain");
  }
});

it("String.prototype.matchAll", () => {
  let str = "test1test2";
  for (let RegExpConstructor of [RegExp, OnigurumaRegExp]) {
    const regexp = new RegExpConstructor("t(e)(st(d?))", "g");
    const array = [...str.matchAll(regexp)];
    expect(array[0][0]).toBe("test");
    expect(array[0][1]).toBe("e");
    expect(array[0][2]).toBe("st");
    expect(array[0][3]).toBe("");
    expect(array[1][0]).toBe("test");
    expect(array[1][1]).toBe("e");
    expect(array[1][2]).toBe("st");
    expect(array[1][3]).toBe("");
  }
});

it("String.prototype.search", () => {
  let str = "The rain in SPAIN stays mainly in the plain";
  for (let RegExpConstructor of [OnigurumaRegExp, RegExp]) {
    let r1 = new RegExpConstructor("ain", "g");
    expect(str.search(r1)).toBe(5);
    r1.compile("ain", "ig");
    expect(str.search(r1)).toBe(5);
  }
});

it("String.prototype.split", () => {
  let str = "Hello World. How are you doing?";
  for (let RegExpConstructor of [RegExp, OnigurumaRegExp]) {
    let r1 = new RegExpConstructor("\\s", "g");
    let m1 = str.split(r1);
    expect(m1[0]).toBe("Hello");
    expect(m1[1]).toBe("World.");
    expect(m1[2]).toBe("How");
    expect(m1[3]).toBe("are");
    expect(m1[4]).toBe("you");
    expect(m1[5]).toBe("doing?");
  }
});

it("escapes characters, unicode, and hex", () => {
  for (const RegExpConstructor of [OnigurumaRegExp, RegExp]) {
    expect(new RegExpConstructor("[\\x00-\\x1F]").toString()).toBe("/[\\x00-\\x1F]/");
    expect(new RegExpConstructor("[\\u0000-\\u001F]").toString()).toBe("/[\\u0000-\\u001F]/");
    var s = /\\x{7HHHHHHH}(?=\\u{1233})/
    let a = new RegExpConstructor('\u{0001F46E}');
    expect(a.exec('👮')[0]).toBe('👮');
  }

  let y = new OnigurumaRegExp('[👮\\x7F](?<=👮)');
  expect(y.exec('👮\\x{7F}')[0]).toBe('👮');

  let by = new OnigurumaRegExp('[👮\\cx7f](?<=👮)');
  expect(y.exec('👮\\x{7F}')[0]).toBe('👮');

  let bz = new OnigurumaRegExp('[👮\\x7](?<=👮)');

  let d = new OnigurumaRegExp('[\u{0001F46E}\x7F](?<=\u{0001F46E})');
  expect(d.exec('👮\x7F')[0]).toBe('👮');

  let y_2 = /[[👮\x7F](?<=👮)]/;
  expect(y_2.exec('👮\x7F')[0]).toBe('👮');

  let a1 = new OnigurumaRegExp("(f\xf3oo)", "gd");
  let a1_1 = a1.exec("table f\xf3ootball, f\xf3oosball");
  a1_1 = a1.exec("table f\xf3ootball, f\xf3oosball");
  
  let a2 = new RegExp("(f\xf3oo)", "dg");
  let a2_1 = a2.exec("table f\xf3ootball, f\xf3oosball");
  a2_1 = a2.exec("table f\xf3ootball, f\xf3oosball");

  expect(a1_1[0]).toBe(a2_1[0]);
  expect(a1_1[1]).toBe(a2_1[1]);
  expect(a1_1.index).toBe(a2_1.index);
  expect(a1_1.input).toBe(a2_1.input);
  expect(a1.lastIndex).toBe(a2.lastIndex);
  expect(a1_1.groups).toBe(a2_1.groups);
  expect(a1_1.indices[0][0]).toBe(a2_1.indices[0][0]);
  expect(a1_1.indices[0][1]).toBe(a2_1.indices[0][1]);
  expect(a1_1.indices[1][0]).toBe(a2_1.indices[1][0]);
  expect(a1_1.indices[1][1]).toBe(a2_1.indices[1][1]);
});

it("lookbehinds", () => {
  expect(/\d+(?=%)/.source).toBe("\\d+(?=%)");
  expect(/\d+(?!%)/.source).toBe("\\d+(?!%)");
  expect(/(?<=\$)\d+/.source).toBe("(?<=\\$)\\d+");
  expect(/(?<!\$)\d+/.source).toBe("(?<!\\$)\\d+");
  expect(/h(?=(\w)+)/.source).toBe("h(?=(\\w)+)");
  expect(/(?<=(\w)+)r/.source).toBe("(?<=(\\w)+)r");
  expect(/(?<=(o)d\1)r/.source).toBe("(?<=(o)d\\1)r");
  expect(/(?<=\1d(o))r/.source).toBe("(?<=\\1d(o))r");

  let small = /(?:)/;
  expect(small instanceof OnigurumaRegExp).toBe(false);

  expect(/[\x00-\x1F\x27\x5C\x7F-\x9F]|[\uD800-\uDBFF]\(?<=[\uDC00-\uDFFF]\)|(?!.*[\uD800-\uDBFF][\uDC00-\uDFFF]).*[\uDC00-\uDFFF]/ instanceof RegExp).toBe(true);
  expect(/[\x00-\x1F\x27\x5C\x7F-\x9F]|[\uD800-\uDBFF](?<=[\uDC00-\uDFFF])|(?!.*[\uD800-\uDBFF][\uDC00-\uDFFF]).*[\uDC00-\uDFFF]/ instanceof OnigurumaRegExp).toBe(true);

  expect(/(?<=\1d(o))/ instanceof OnigurumaRegExp).toBe(true);
  expect(/\(?<=\1d(o)\)/ instanceof OnigurumaRegExp).toBe(false);
  expect(/(?!.*[\uD800-\uDBFF][\uDC00-\uDFFF]).*[\uDC00-\uDFFF]/ instanceof RegExp).toBe(true);
  expect(/\(?!.*[\uD800-\uDBFF][\uDC00-\uDFFF]\).*[\uDC00-\uDFFF]/ instanceof RegExp).toBe(true);

  let e = new OnigurumaRegExp('\(?<=\)');
  expect(e.source).toBe('(?<=)');
  expect(new OnigurumaRegExp('(?<=)').source).toBe('(?<=)');

  expect(/\(?<=\)/.source).toBe("\\(?<=\\)");
  expect(/(?<=)/.source).toBe("(?<=)");
});
