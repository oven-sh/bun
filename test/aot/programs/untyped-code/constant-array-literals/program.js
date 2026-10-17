function say(name, f) { let r; try { r = f(); } catch (e) { r = "threw " + e.name; } console.log(name + ": " + r); }
const T = v => typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v);
const S = a => "[" + Array.from(a, T).join(",") + "]" + a.length;
let junk = []; function garbage() { for (let i = 0; i < 300; i++) junk.push({ i, s: "g" + i, a: [i, "x" + i] }); if (junk.length > 4000) junk = []; }
function collect() { for (let i = 0; i < 8; i++) garbage(); if (typeof gc === "function") gc(); for (let i = 0; i < 4; i++) garbage(); }
function shared1() { return ["", "a", "\0", "\x7f", "\x80", "\u00e9", "\u2603", "\ud83d\ude00", "ab", "a longer text that is no atom, with spaces", "length", "constructor", "__proto__", "0", "-0", "repeated", "repeated", "repeated"]; }
function written1(v) { const a = ["", "a", "\0", "\x7f", "\x80", "\u00e9", "\u2603", "\ud83d\ude00", "ab", "a longer text that is no atom, with spaces", "length", "constructor", "__proto__", "0", "-0", "repeated", "repeated", "repeated"]; a[0] = v; return a; }
function pushed1(v) { const a = ["", "a", "\0", "\x7f", "\x80", "\u00e9", "\u2603", "\ud83d\ude00", "ab", "a longer text that is no atom, with spaces", "length", "constructor", "__proto__", "0", "-0", "repeated", "repeated", "repeated"]; a.push(v); return a; }
say("strings" + ", first", () => S(shared1()));
say("strings" + ", two are two", () => { const a = shared1(), b = shared1(); return (a !== b) + " " + (S(a) === S(b)); });
say("strings" + ", behind collections", () => { collect(); return S(shared1()); });
say("strings" + ", written to from outside, then fresh", () => { const a = shared1(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared1(); return S(b) + " " + T(a[0]) + a.length; });
say("strings" + ", sorted, reversed, cut, then fresh", () => { shared1().sort(); shared1().reverse(); shared1().length = 0; shared1().fill(9); shared1().splice(0, 1); shared1().shift(); return S(shared1()); });
say("strings" + ", frozen, then fresh", () => { const a = Object.freeze(shared1()); const b = shared1(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared1()); });
say("strings" + ", written to in place", () => S(written1("W")) + S(written1(1)) + S(written1(1.5)) + S(written1(undefined)));
say("strings" + ", pushed to in place", () => S(pushed1("P")) + S(pushed1(1)) + S(pushed1(1.5)));
say("strings" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared1().length + written1(i).length + pushed1(i).length; if (i % 50 === 0) garbage(); } return t + S(shared1()); });
function shared2() { return [0, -0, 1, -1, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e21, 5e-324, 1.5, -1.5, 0.1, NaN, Infinity, -Infinity, 1.7976931348623157e308]; }
function written2(v) { const a = [0, -0, 1, -1, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e21, 5e-324, 1.5, -1.5, 0.1, NaN, Infinity, -Infinity, 1.7976931348623157e308]; a[0] = v; return a; }
function pushed2(v) { const a = [0, -0, 1, -1, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e21, 5e-324, 1.5, -1.5, 0.1, NaN, Infinity, -Infinity, 1.7976931348623157e308]; a.push(v); return a; }
say("numbers" + ", first", () => S(shared2()));
say("numbers" + ", two are two", () => { const a = shared2(), b = shared2(); return (a !== b) + " " + (S(a) === S(b)); });
say("numbers" + ", behind collections", () => { collect(); return S(shared2()); });
say("numbers" + ", written to from outside, then fresh", () => { const a = shared2(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared2(); return S(b) + " " + T(a[0]) + a.length; });
say("numbers" + ", sorted, reversed, cut, then fresh", () => { shared2().sort(); shared2().reverse(); shared2().length = 0; shared2().fill(9); shared2().splice(0, 1); shared2().shift(); return S(shared2()); });
say("numbers" + ", frozen, then fresh", () => { const a = Object.freeze(shared2()); const b = shared2(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared2()); });
say("numbers" + ", written to in place", () => S(written2("W")) + S(written2(1)) + S(written2(1.5)) + S(written2(undefined)));
say("numbers" + ", pushed to in place", () => S(pushed2("P")) + S(pushed2(1)) + S(pushed2(1.5)));
say("numbers" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared2().length + written2(i).length + pushed2(i).length; if (i % 50 === 0) garbage(); } return t + S(shared2()); });
function shared3() { return [undefined, null, true, false]; }
function written3(v) { const a = [undefined, null, true, false]; a[0] = v; return a; }
function pushed3(v) { const a = [undefined, null, true, false]; a.push(v); return a; }
say("others" + ", first", () => S(shared3()));
say("others" + ", two are two", () => { const a = shared3(), b = shared3(); return (a !== b) + " " + (S(a) === S(b)); });
say("others" + ", behind collections", () => { collect(); return S(shared3()); });
say("others" + ", written to from outside, then fresh", () => { const a = shared3(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared3(); return S(b) + " " + T(a[0]) + a.length; });
say("others" + ", sorted, reversed, cut, then fresh", () => { shared3().sort(); shared3().reverse(); shared3().length = 0; shared3().fill(9); shared3().splice(0, 1); shared3().shift(); return S(shared3()); });
say("others" + ", frozen, then fresh", () => { const a = Object.freeze(shared3()); const b = shared3(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared3()); });
say("others" + ", written to in place", () => S(written3("W")) + S(written3(1)) + S(written3(1.5)) + S(written3(undefined)));
say("others" + ", pushed to in place", () => S(pushed3("P")) + S(pushed3(1)) + S(pushed3(1.5)));
say("others" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared3().length + written3(i).length + pushed3(i).length; if (i % 50 === 0) garbage(); } return t + S(shared3()); });
function shared4() { return [1, 2, 3]; }
function written4(v) { const a = [1, 2, 3]; a[0] = v; return a; }
function pushed4(v) { const a = [1, 2, 3]; a.push(v); return a; }
say("ints" + ", first", () => S(shared4()));
say("ints" + ", two are two", () => { const a = shared4(), b = shared4(); return (a !== b) + " " + (S(a) === S(b)); });
say("ints" + ", behind collections", () => { collect(); return S(shared4()); });
say("ints" + ", written to from outside, then fresh", () => { const a = shared4(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared4(); return S(b) + " " + T(a[0]) + a.length; });
say("ints" + ", sorted, reversed, cut, then fresh", () => { shared4().sort(); shared4().reverse(); shared4().length = 0; shared4().fill(9); shared4().splice(0, 1); shared4().shift(); return S(shared4()); });
say("ints" + ", frozen, then fresh", () => { const a = Object.freeze(shared4()); const b = shared4(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared4()); });
say("ints" + ", written to in place", () => S(written4("W")) + S(written4(1)) + S(written4(1.5)) + S(written4(undefined)));
say("ints" + ", pushed to in place", () => S(pushed4("P")) + S(pushed4(1)) + S(pushed4(1.5)));
say("ints" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared4().length + written4(i).length + pushed4(i).length; if (i % 50 === 0) garbage(); } return t + S(shared4()); });
function shared5() { return [1.5, 2.5, 3.5]; }
function written5(v) { const a = [1.5, 2.5, 3.5]; a[0] = v; return a; }
function pushed5(v) { const a = [1.5, 2.5, 3.5]; a.push(v); return a; }
say("doubles" + ", first", () => S(shared5()));
say("doubles" + ", two are two", () => { const a = shared5(), b = shared5(); return (a !== b) + " " + (S(a) === S(b)); });
say("doubles" + ", behind collections", () => { collect(); return S(shared5()); });
say("doubles" + ", written to from outside, then fresh", () => { const a = shared5(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared5(); return S(b) + " " + T(a[0]) + a.length; });
say("doubles" + ", sorted, reversed, cut, then fresh", () => { shared5().sort(); shared5().reverse(); shared5().length = 0; shared5().fill(9); shared5().splice(0, 1); shared5().shift(); return S(shared5()); });
say("doubles" + ", frozen, then fresh", () => { const a = Object.freeze(shared5()); const b = shared5(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared5()); });
say("doubles" + ", written to in place", () => S(written5("W")) + S(written5(1)) + S(written5(1.5)) + S(written5(undefined)));
say("doubles" + ", pushed to in place", () => S(pushed5("P")) + S(pushed5(1)) + S(pushed5(1.5)));
say("doubles" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared5().length + written5(i).length + pushed5(i).length; if (i % 50 === 0) garbage(); } return t + S(shared5()); });
function shared6() { return [1.5, NaN, 3.5]; }
function written6(v) { const a = [1.5, NaN, 3.5]; a[0] = v; return a; }
function pushed6(v) { const a = [1.5, NaN, 3.5]; a.push(v); return a; }
say("doubles with NaN" + ", first", () => S(shared6()));
say("doubles with NaN" + ", two are two", () => { const a = shared6(), b = shared6(); return (a !== b) + " " + (S(a) === S(b)); });
say("doubles with NaN" + ", behind collections", () => { collect(); return S(shared6()); });
say("doubles with NaN" + ", written to from outside, then fresh", () => { const a = shared6(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared6(); return S(b) + " " + T(a[0]) + a.length; });
say("doubles with NaN" + ", sorted, reversed, cut, then fresh", () => { shared6().sort(); shared6().reverse(); shared6().length = 0; shared6().fill(9); shared6().splice(0, 1); shared6().shift(); return S(shared6()); });
say("doubles with NaN" + ", frozen, then fresh", () => { const a = Object.freeze(shared6()); const b = shared6(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared6()); });
say("doubles with NaN" + ", written to in place", () => S(written6("W")) + S(written6(1)) + S(written6(1.5)) + S(written6(undefined)));
say("doubles with NaN" + ", pushed to in place", () => S(pushed6("P")) + S(pushed6(1)) + S(pushed6(1.5)));
say("doubles with NaN" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared6().length + written6(i).length + pushed6(i).length; if (i % 50 === 0) garbage(); } return t + S(shared6()); });
function shared7() { return [1.5, -0, 3.5]; }
function written7(v) { const a = [1.5, -0, 3.5]; a[0] = v; return a; }
function pushed7(v) { const a = [1.5, -0, 3.5]; a.push(v); return a; }
say("doubles with -0" + ", first", () => S(shared7()));
say("doubles with -0" + ", two are two", () => { const a = shared7(), b = shared7(); return (a !== b) + " " + (S(a) === S(b)); });
say("doubles with -0" + ", behind collections", () => { collect(); return S(shared7()); });
say("doubles with -0" + ", written to from outside, then fresh", () => { const a = shared7(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared7(); return S(b) + " " + T(a[0]) + a.length; });
say("doubles with -0" + ", sorted, reversed, cut, then fresh", () => { shared7().sort(); shared7().reverse(); shared7().length = 0; shared7().fill(9); shared7().splice(0, 1); shared7().shift(); return S(shared7()); });
say("doubles with -0" + ", frozen, then fresh", () => { const a = Object.freeze(shared7()); const b = shared7(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared7()); });
say("doubles with -0" + ", written to in place", () => S(written7("W")) + S(written7(1)) + S(written7(1.5)) + S(written7(undefined)));
say("doubles with -0" + ", pushed to in place", () => S(pushed7("P")) + S(pushed7(1)) + S(pushed7(1.5)));
say("doubles with -0" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared7().length + written7(i).length + pushed7(i).length; if (i % 50 === 0) garbage(); } return t + S(shared7()); });
function shared8() { return [1, 2.5, 3]; }
function written8(v) { const a = [1, 2.5, 3]; a[0] = v; return a; }
function pushed8(v) { const a = [1, 2.5, 3]; a.push(v); return a; }
say("ints and a double" + ", first", () => S(shared8()));
say("ints and a double" + ", two are two", () => { const a = shared8(), b = shared8(); return (a !== b) + " " + (S(a) === S(b)); });
say("ints and a double" + ", behind collections", () => { collect(); return S(shared8()); });
say("ints and a double" + ", written to from outside, then fresh", () => { const a = shared8(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared8(); return S(b) + " " + T(a[0]) + a.length; });
say("ints and a double" + ", sorted, reversed, cut, then fresh", () => { shared8().sort(); shared8().reverse(); shared8().length = 0; shared8().fill(9); shared8().splice(0, 1); shared8().shift(); return S(shared8()); });
say("ints and a double" + ", frozen, then fresh", () => { const a = Object.freeze(shared8()); const b = shared8(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared8()); });
say("ints and a double" + ", written to in place", () => S(written8("W")) + S(written8(1)) + S(written8(1.5)) + S(written8(undefined)));
say("ints and a double" + ", pushed to in place", () => S(pushed8("P")) + S(pushed8(1)) + S(pushed8(1.5)));
say("ints and a double" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared8().length + written8(i).length + pushed8(i).length; if (i % 50 === 0) garbage(); } return t + S(shared8()); });
function shared9() { return [1, 2147483648, 3]; }
function written9(v) { const a = [1, 2147483648, 3]; a[0] = v; return a; }
function pushed9(v) { const a = [1, 2147483648, 3]; a.push(v); return a; }
say("ints past int32" + ", first", () => S(shared9()));
say("ints past int32" + ", two are two", () => { const a = shared9(), b = shared9(); return (a !== b) + " " + (S(a) === S(b)); });
say("ints past int32" + ", behind collections", () => { collect(); return S(shared9()); });
say("ints past int32" + ", written to from outside, then fresh", () => { const a = shared9(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared9(); return S(b) + " " + T(a[0]) + a.length; });
say("ints past int32" + ", sorted, reversed, cut, then fresh", () => { shared9().sort(); shared9().reverse(); shared9().length = 0; shared9().fill(9); shared9().splice(0, 1); shared9().shift(); return S(shared9()); });
say("ints past int32" + ", frozen, then fresh", () => { const a = Object.freeze(shared9()); const b = shared9(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared9()); });
say("ints past int32" + ", written to in place", () => S(written9("W")) + S(written9(1)) + S(written9(1.5)) + S(written9(undefined)));
say("ints past int32" + ", pushed to in place", () => S(pushed9("P")) + S(pushed9(1)) + S(pushed9(1.5)));
say("ints past int32" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared9().length + written9(i).length + pushed9(i).length; if (i % 50 === 0) garbage(); } return t + S(shared9()); });
function shared10() { return [1, "a", null, 2.5, undefined, true, "", "text", -0, NaN]; }
function written10(v) { const a = [1, "a", null, 2.5, undefined, true, "", "text", -0, NaN]; a[0] = v; return a; }
function pushed10(v) { const a = [1, "a", null, 2.5, undefined, true, "", "text", -0, NaN]; a.push(v); return a; }
say("mixed" + ", first", () => S(shared10()));
say("mixed" + ", two are two", () => { const a = shared10(), b = shared10(); return (a !== b) + " " + (S(a) === S(b)); });
say("mixed" + ", behind collections", () => { collect(); return S(shared10()); });
say("mixed" + ", written to from outside, then fresh", () => { const a = shared10(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared10(); return S(b) + " " + T(a[0]) + a.length; });
say("mixed" + ", sorted, reversed, cut, then fresh", () => { shared10().sort(); shared10().reverse(); shared10().length = 0; shared10().fill(9); shared10().splice(0, 1); shared10().shift(); return S(shared10()); });
say("mixed" + ", frozen, then fresh", () => { const a = Object.freeze(shared10()); const b = shared10(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared10()); });
say("mixed" + ", written to in place", () => S(written10("W")) + S(written10(1)) + S(written10(1.5)) + S(written10(undefined)));
say("mixed" + ", pushed to in place", () => S(pushed10("P")) + S(pushed10(1)) + S(pushed10(1.5)));
say("mixed" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared10().length + written10(i).length + pushed10(i).length; if (i % 50 === 0) garbage(); } return t + S(shared10()); });
function shared11() { return ["only"]; }
function written11(v) { const a = ["only"]; a[0] = v; return a; }
function pushed11(v) { const a = ["only"]; a.push(v); return a; }
say("one" + ", first", () => S(shared11()));
say("one" + ", two are two", () => { const a = shared11(), b = shared11(); return (a !== b) + " " + (S(a) === S(b)); });
say("one" + ", behind collections", () => { collect(); return S(shared11()); });
say("one" + ", written to from outside, then fresh", () => { const a = shared11(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared11(); return S(b) + " " + T(a[0]) + a.length; });
say("one" + ", sorted, reversed, cut, then fresh", () => { shared11().sort(); shared11().reverse(); shared11().length = 0; shared11().fill(9); shared11().splice(0, 1); shared11().shift(); return S(shared11()); });
say("one" + ", frozen, then fresh", () => { const a = Object.freeze(shared11()); const b = shared11(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared11()); });
say("one" + ", written to in place", () => S(written11("W")) + S(written11(1)) + S(written11(1.5)) + S(written11(undefined)));
say("one" + ", pushed to in place", () => S(pushed11("P")) + S(pushed11(1)) + S(pushed11(1.5)));
say("one" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared11().length + written11(i).length + pushed11(i).length; if (i % 50 === 0) garbage(); } return t + S(shared11()); });
function shared12() { return [7]; }
function written12(v) { const a = [7]; a[0] = v; return a; }
function pushed12(v) { const a = [7]; a.push(v); return a; }
say("one int" + ", first", () => S(shared12()));
say("one int" + ", two are two", () => { const a = shared12(), b = shared12(); return (a !== b) + " " + (S(a) === S(b)); });
say("one int" + ", behind collections", () => { collect(); return S(shared12()); });
say("one int" + ", written to from outside, then fresh", () => { const a = shared12(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared12(); return S(b) + " " + T(a[0]) + a.length; });
say("one int" + ", sorted, reversed, cut, then fresh", () => { shared12().sort(); shared12().reverse(); shared12().length = 0; shared12().fill(9); shared12().splice(0, 1); shared12().shift(); return S(shared12()); });
say("one int" + ", frozen, then fresh", () => { const a = Object.freeze(shared12()); const b = shared12(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared12()); });
say("one int" + ", written to in place", () => S(written12("W")) + S(written12(1)) + S(written12(1.5)) + S(written12(undefined)));
say("one int" + ", pushed to in place", () => S(pushed12("P")) + S(pushed12(1)) + S(pushed12(1.5)));
say("one int" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared12().length + written12(i).length + pushed12(i).length; if (i % 50 === 0) garbage(); } return t + S(shared12()); });
function shared13() { return [undefined]; }
function written13(v) { const a = [undefined]; a[0] = v; return a; }
function pushed13(v) { const a = [undefined]; a.push(v); return a; }
say("one undefined" + ", first", () => S(shared13()));
say("one undefined" + ", two are two", () => { const a = shared13(), b = shared13(); return (a !== b) + " " + (S(a) === S(b)); });
say("one undefined" + ", behind collections", () => { collect(); return S(shared13()); });
say("one undefined" + ", written to from outside, then fresh", () => { const a = shared13(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared13(); return S(b) + " " + T(a[0]) + a.length; });
say("one undefined" + ", sorted, reversed, cut, then fresh", () => { shared13().sort(); shared13().reverse(); shared13().length = 0; shared13().fill(9); shared13().splice(0, 1); shared13().shift(); return S(shared13()); });
say("one undefined" + ", frozen, then fresh", () => { const a = Object.freeze(shared13()); const b = shared13(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared13()); });
say("one undefined" + ", written to in place", () => S(written13("W")) + S(written13(1)) + S(written13(1.5)) + S(written13(undefined)));
say("one undefined" + ", pushed to in place", () => S(pushed13("P")) + S(pushed13(1)) + S(pushed13(1.5)));
say("one undefined" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared13().length + written13(i).length + pushed13(i).length; if (i % 50 === 0) garbage(); } return t + S(shared13()); });
function shared14() { return ["", "a", "b", "\0", "\u00e9"]; }
function written14(v) { const a = ["", "a", "b", "\0", "\u00e9"]; a[0] = v; return a; }
function pushed14(v) { const a = ["", "a", "b", "\0", "\u00e9"]; a.push(v); return a; }
say("small strings" + ", first", () => S(shared14()));
say("small strings" + ", two are two", () => { const a = shared14(), b = shared14(); return (a !== b) + " " + (S(a) === S(b)); });
say("small strings" + ", behind collections", () => { collect(); return S(shared14()); });
say("small strings" + ", written to from outside, then fresh", () => { const a = shared14(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared14(); return S(b) + " " + T(a[0]) + a.length; });
say("small strings" + ", sorted, reversed, cut, then fresh", () => { shared14().sort(); shared14().reverse(); shared14().length = 0; shared14().fill(9); shared14().splice(0, 1); shared14().shift(); return S(shared14()); });
say("small strings" + ", frozen, then fresh", () => { const a = Object.freeze(shared14()); const b = shared14(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared14()); });
say("small strings" + ", written to in place", () => S(written14("W")) + S(written14(1)) + S(written14(1.5)) + S(written14(undefined)));
say("small strings" + ", pushed to in place", () => S(pushed14("P")) + S(pushed14(1)) + S(pushed14(1.5)));
say("small strings" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared14().length + written14(i).length + pushed14(i).length; if (i % 50 === 0) garbage(); } return t + S(shared14()); });
function shared15() { return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; }
function written15(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; a[0] = v; return a; }
function pushed15(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; a.push(v); return a; }
say("15 ints" + ", first", () => S(shared15()));
say("15 ints" + ", two are two", () => { const a = shared15(), b = shared15(); return (a !== b) + " " + (S(a) === S(b)); });
say("15 ints" + ", behind collections", () => { collect(); return S(shared15()); });
say("15 ints" + ", written to from outside, then fresh", () => { const a = shared15(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared15(); return S(b) + " " + T(a[0]) + a.length; });
say("15 ints" + ", sorted, reversed, cut, then fresh", () => { shared15().sort(); shared15().reverse(); shared15().length = 0; shared15().fill(9); shared15().splice(0, 1); shared15().shift(); return S(shared15()); });
say("15 ints" + ", frozen, then fresh", () => { const a = Object.freeze(shared15()); const b = shared15(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared15()); });
say("15 ints" + ", written to in place", () => S(written15("W")) + S(written15(1)) + S(written15(1.5)) + S(written15(undefined)));
say("15 ints" + ", pushed to in place", () => S(pushed15("P")) + S(pushed15(1)) + S(pushed15(1.5)));
say("15 ints" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared15().length + written15(i).length + pushed15(i).length; if (i % 50 === 0) garbage(); } return t + S(shared15()); });
function shared16() { return ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14"]; }
function written16(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14"]; a[0] = v; return a; }
function pushed16(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14"]; a.push(v); return a; }
say("15 strings" + ", first", () => S(shared16()));
say("15 strings" + ", two are two", () => { const a = shared16(), b = shared16(); return (a !== b) + " " + (S(a) === S(b)); });
say("15 strings" + ", behind collections", () => { collect(); return S(shared16()); });
say("15 strings" + ", written to from outside, then fresh", () => { const a = shared16(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared16(); return S(b) + " " + T(a[0]) + a.length; });
say("15 strings" + ", sorted, reversed, cut, then fresh", () => { shared16().sort(); shared16().reverse(); shared16().length = 0; shared16().fill(9); shared16().splice(0, 1); shared16().shift(); return S(shared16()); });
say("15 strings" + ", frozen, then fresh", () => { const a = Object.freeze(shared16()); const b = shared16(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared16()); });
say("15 strings" + ", written to in place", () => S(written16("W")) + S(written16(1)) + S(written16(1.5)) + S(written16(undefined)));
say("15 strings" + ", pushed to in place", () => S(pushed16("P")) + S(pushed16(1)) + S(pushed16(1.5)));
say("15 strings" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared16().length + written16(i).length + pushed16(i).length; if (i % 50 === 0) garbage(); } return t + S(shared16()); });
function shared17() { return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5]; }
function written17(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5]; a[0] = v; return a; }
function pushed17(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5]; a.push(v); return a; }
say("15 doubles" + ", first", () => S(shared17()));
say("15 doubles" + ", two are two", () => { const a = shared17(), b = shared17(); return (a !== b) + " " + (S(a) === S(b)); });
say("15 doubles" + ", behind collections", () => { collect(); return S(shared17()); });
say("15 doubles" + ", written to from outside, then fresh", () => { const a = shared17(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared17(); return S(b) + " " + T(a[0]) + a.length; });
say("15 doubles" + ", sorted, reversed, cut, then fresh", () => { shared17().sort(); shared17().reverse(); shared17().length = 0; shared17().fill(9); shared17().splice(0, 1); shared17().shift(); return S(shared17()); });
say("15 doubles" + ", frozen, then fresh", () => { const a = Object.freeze(shared17()); const b = shared17(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared17()); });
say("15 doubles" + ", written to in place", () => S(written17("W")) + S(written17(1)) + S(written17(1.5)) + S(written17(undefined)));
say("15 doubles" + ", pushed to in place", () => S(pushed17("P")) + S(pushed17(1)) + S(pushed17(1.5)));
say("15 doubles" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared17().length + written17(i).length + pushed17(i).length; if (i % 50 === 0) garbage(); } return t + S(shared17()); });
function shared18() { return [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25]; }
function written18(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25]; a[0] = v; return a; }
function pushed18(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25]; a.push(v); return a; }
say("15 mixed" + ", first", () => S(shared18()));
say("15 mixed" + ", two are two", () => { const a = shared18(), b = shared18(); return (a !== b) + " " + (S(a) === S(b)); });
say("15 mixed" + ", behind collections", () => { collect(); return S(shared18()); });
say("15 mixed" + ", written to from outside, then fresh", () => { const a = shared18(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared18(); return S(b) + " " + T(a[0]) + a.length; });
say("15 mixed" + ", sorted, reversed, cut, then fresh", () => { shared18().sort(); shared18().reverse(); shared18().length = 0; shared18().fill(9); shared18().splice(0, 1); shared18().shift(); return S(shared18()); });
say("15 mixed" + ", frozen, then fresh", () => { const a = Object.freeze(shared18()); const b = shared18(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared18()); });
say("15 mixed" + ", written to in place", () => S(written18("W")) + S(written18(1)) + S(written18(1.5)) + S(written18(undefined)));
say("15 mixed" + ", pushed to in place", () => S(pushed18("P")) + S(pushed18(1)) + S(pushed18(1.5)));
say("15 mixed" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared18().length + written18(i).length + pushed18(i).length; if (i % 50 === 0) garbage(); } return t + S(shared18()); });
function shared19() { return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]; }
function written19(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]; a[0] = v; return a; }
function pushed19(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]; a.push(v); return a; }
say("16 ints" + ", first", () => S(shared19()));
say("16 ints" + ", two are two", () => { const a = shared19(), b = shared19(); return (a !== b) + " " + (S(a) === S(b)); });
say("16 ints" + ", behind collections", () => { collect(); return S(shared19()); });
say("16 ints" + ", written to from outside, then fresh", () => { const a = shared19(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared19(); return S(b) + " " + T(a[0]) + a.length; });
say("16 ints" + ", sorted, reversed, cut, then fresh", () => { shared19().sort(); shared19().reverse(); shared19().length = 0; shared19().fill(9); shared19().splice(0, 1); shared19().shift(); return S(shared19()); });
say("16 ints" + ", frozen, then fresh", () => { const a = Object.freeze(shared19()); const b = shared19(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared19()); });
say("16 ints" + ", written to in place", () => S(written19("W")) + S(written19(1)) + S(written19(1.5)) + S(written19(undefined)));
say("16 ints" + ", pushed to in place", () => S(pushed19("P")) + S(pushed19(1)) + S(pushed19(1.5)));
say("16 ints" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared19().length + written19(i).length + pushed19(i).length; if (i % 50 === 0) garbage(); } return t + S(shared19()); });
function shared20() { return ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15"]; }
function written20(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15"]; a[0] = v; return a; }
function pushed20(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15"]; a.push(v); return a; }
say("16 strings" + ", first", () => S(shared20()));
say("16 strings" + ", two are two", () => { const a = shared20(), b = shared20(); return (a !== b) + " " + (S(a) === S(b)); });
say("16 strings" + ", behind collections", () => { collect(); return S(shared20()); });
say("16 strings" + ", written to from outside, then fresh", () => { const a = shared20(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared20(); return S(b) + " " + T(a[0]) + a.length; });
say("16 strings" + ", sorted, reversed, cut, then fresh", () => { shared20().sort(); shared20().reverse(); shared20().length = 0; shared20().fill(9); shared20().splice(0, 1); shared20().shift(); return S(shared20()); });
say("16 strings" + ", frozen, then fresh", () => { const a = Object.freeze(shared20()); const b = shared20(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared20()); });
say("16 strings" + ", written to in place", () => S(written20("W")) + S(written20(1)) + S(written20(1.5)) + S(written20(undefined)));
say("16 strings" + ", pushed to in place", () => S(pushed20("P")) + S(pushed20(1)) + S(pushed20(1.5)));
say("16 strings" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared20().length + written20(i).length + pushed20(i).length; if (i % 50 === 0) garbage(); } return t + S(shared20()); });
function shared21() { return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5]; }
function written21(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5]; a[0] = v; return a; }
function pushed21(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5]; a.push(v); return a; }
say("16 doubles" + ", first", () => S(shared21()));
say("16 doubles" + ", two are two", () => { const a = shared21(), b = shared21(); return (a !== b) + " " + (S(a) === S(b)); });
say("16 doubles" + ", behind collections", () => { collect(); return S(shared21()); });
say("16 doubles" + ", written to from outside, then fresh", () => { const a = shared21(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared21(); return S(b) + " " + T(a[0]) + a.length; });
say("16 doubles" + ", sorted, reversed, cut, then fresh", () => { shared21().sort(); shared21().reverse(); shared21().length = 0; shared21().fill(9); shared21().splice(0, 1); shared21().shift(); return S(shared21()); });
say("16 doubles" + ", frozen, then fresh", () => { const a = Object.freeze(shared21()); const b = shared21(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared21()); });
say("16 doubles" + ", written to in place", () => S(written21("W")) + S(written21(1)) + S(written21(1.5)) + S(written21(undefined)));
say("16 doubles" + ", pushed to in place", () => S(pushed21("P")) + S(pushed21(1)) + S(pushed21(1.5)));
say("16 doubles" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared21().length + written21(i).length + pushed21(i).length; if (i % 50 === 0) garbage(); } return t + S(shared21()); });
function shared22() { return [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null]; }
function written22(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null]; a[0] = v; return a; }
function pushed22(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null]; a.push(v); return a; }
say("16 mixed" + ", first", () => S(shared22()));
say("16 mixed" + ", two are two", () => { const a = shared22(), b = shared22(); return (a !== b) + " " + (S(a) === S(b)); });
say("16 mixed" + ", behind collections", () => { collect(); return S(shared22()); });
say("16 mixed" + ", written to from outside, then fresh", () => { const a = shared22(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared22(); return S(b) + " " + T(a[0]) + a.length; });
say("16 mixed" + ", sorted, reversed, cut, then fresh", () => { shared22().sort(); shared22().reverse(); shared22().length = 0; shared22().fill(9); shared22().splice(0, 1); shared22().shift(); return S(shared22()); });
say("16 mixed" + ", frozen, then fresh", () => { const a = Object.freeze(shared22()); const b = shared22(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared22()); });
say("16 mixed" + ", written to in place", () => S(written22("W")) + S(written22(1)) + S(written22(1.5)) + S(written22(undefined)));
say("16 mixed" + ", pushed to in place", () => S(pushed22("P")) + S(pushed22(1)) + S(pushed22(1.5)));
say("16 mixed" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared22().length + written22(i).length + pushed22(i).length; if (i % 50 === 0) garbage(); } return t + S(shared22()); });
function shared23() { return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; }
function written23(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; a[0] = v; return a; }
function pushed23(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; a.push(v); return a; }
say("17 ints" + ", first", () => S(shared23()));
say("17 ints" + ", two are two", () => { const a = shared23(), b = shared23(); return (a !== b) + " " + (S(a) === S(b)); });
say("17 ints" + ", behind collections", () => { collect(); return S(shared23()); });
say("17 ints" + ", written to from outside, then fresh", () => { const a = shared23(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared23(); return S(b) + " " + T(a[0]) + a.length; });
say("17 ints" + ", sorted, reversed, cut, then fresh", () => { shared23().sort(); shared23().reverse(); shared23().length = 0; shared23().fill(9); shared23().splice(0, 1); shared23().shift(); return S(shared23()); });
say("17 ints" + ", frozen, then fresh", () => { const a = Object.freeze(shared23()); const b = shared23(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared23()); });
say("17 ints" + ", written to in place", () => S(written23("W")) + S(written23(1)) + S(written23(1.5)) + S(written23(undefined)));
say("17 ints" + ", pushed to in place", () => S(pushed23("P")) + S(pushed23(1)) + S(pushed23(1.5)));
say("17 ints" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared23().length + written23(i).length + pushed23(i).length; if (i % 50 === 0) garbage(); } return t + S(shared23()); });
function shared24() { return ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16"]; }
function written24(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16"]; a[0] = v; return a; }
function pushed24(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16"]; a.push(v); return a; }
say("17 strings" + ", first", () => S(shared24()));
say("17 strings" + ", two are two", () => { const a = shared24(), b = shared24(); return (a !== b) + " " + (S(a) === S(b)); });
say("17 strings" + ", behind collections", () => { collect(); return S(shared24()); });
say("17 strings" + ", written to from outside, then fresh", () => { const a = shared24(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared24(); return S(b) + " " + T(a[0]) + a.length; });
say("17 strings" + ", sorted, reversed, cut, then fresh", () => { shared24().sort(); shared24().reverse(); shared24().length = 0; shared24().fill(9); shared24().splice(0, 1); shared24().shift(); return S(shared24()); });
say("17 strings" + ", frozen, then fresh", () => { const a = Object.freeze(shared24()); const b = shared24(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared24()); });
say("17 strings" + ", written to in place", () => S(written24("W")) + S(written24(1)) + S(written24(1.5)) + S(written24(undefined)));
say("17 strings" + ", pushed to in place", () => S(pushed24("P")) + S(pushed24(1)) + S(pushed24(1.5)));
say("17 strings" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared24().length + written24(i).length + pushed24(i).length; if (i % 50 === 0) garbage(); } return t + S(shared24()); });
function shared25() { return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5]; }
function written25(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5]; a[0] = v; return a; }
function pushed25(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5]; a.push(v); return a; }
say("17 doubles" + ", first", () => S(shared25()));
say("17 doubles" + ", two are two", () => { const a = shared25(), b = shared25(); return (a !== b) + " " + (S(a) === S(b)); });
say("17 doubles" + ", behind collections", () => { collect(); return S(shared25()); });
say("17 doubles" + ", written to from outside, then fresh", () => { const a = shared25(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared25(); return S(b) + " " + T(a[0]) + a.length; });
say("17 doubles" + ", sorted, reversed, cut, then fresh", () => { shared25().sort(); shared25().reverse(); shared25().length = 0; shared25().fill(9); shared25().splice(0, 1); shared25().shift(); return S(shared25()); });
say("17 doubles" + ", frozen, then fresh", () => { const a = Object.freeze(shared25()); const b = shared25(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared25()); });
say("17 doubles" + ", written to in place", () => S(written25("W")) + S(written25(1)) + S(written25(1.5)) + S(written25(undefined)));
say("17 doubles" + ", pushed to in place", () => S(pushed25("P")) + S(pushed25(1)) + S(pushed25(1.5)));
say("17 doubles" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared25().length + written25(i).length + pushed25(i).length; if (i % 50 === 0) garbage(); } return t + S(shared25()); });
function shared26() { return [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16]; }
function written26(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16]; a[0] = v; return a; }
function pushed26(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16]; a.push(v); return a; }
say("17 mixed" + ", first", () => S(shared26()));
say("17 mixed" + ", two are two", () => { const a = shared26(), b = shared26(); return (a !== b) + " " + (S(a) === S(b)); });
say("17 mixed" + ", behind collections", () => { collect(); return S(shared26()); });
say("17 mixed" + ", written to from outside, then fresh", () => { const a = shared26(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared26(); return S(b) + " " + T(a[0]) + a.length; });
say("17 mixed" + ", sorted, reversed, cut, then fresh", () => { shared26().sort(); shared26().reverse(); shared26().length = 0; shared26().fill(9); shared26().splice(0, 1); shared26().shift(); return S(shared26()); });
say("17 mixed" + ", frozen, then fresh", () => { const a = Object.freeze(shared26()); const b = shared26(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared26()); });
say("17 mixed" + ", written to in place", () => S(written26("W")) + S(written26(1)) + S(written26(1.5)) + S(written26(undefined)));
say("17 mixed" + ", pushed to in place", () => S(pushed26("P")) + S(pushed26(1)) + S(pushed26(1.5)));
say("17 mixed" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared26().length + written26(i).length + pushed26(i).length; if (i % 50 === 0) garbage(); } return t + S(shared26()); });
function shared27() { return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]; }
function written27(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]; a[0] = v; return a; }
function pushed27(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]; a.push(v); return a; }
say("32 ints" + ", first", () => S(shared27()));
say("32 ints" + ", two are two", () => { const a = shared27(), b = shared27(); return (a !== b) + " " + (S(a) === S(b)); });
say("32 ints" + ", behind collections", () => { collect(); return S(shared27()); });
say("32 ints" + ", written to from outside, then fresh", () => { const a = shared27(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared27(); return S(b) + " " + T(a[0]) + a.length; });
say("32 ints" + ", sorted, reversed, cut, then fresh", () => { shared27().sort(); shared27().reverse(); shared27().length = 0; shared27().fill(9); shared27().splice(0, 1); shared27().shift(); return S(shared27()); });
say("32 ints" + ", frozen, then fresh", () => { const a = Object.freeze(shared27()); const b = shared27(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared27()); });
say("32 ints" + ", written to in place", () => S(written27("W")) + S(written27(1)) + S(written27(1.5)) + S(written27(undefined)));
say("32 ints" + ", pushed to in place", () => S(pushed27("P")) + S(pushed27(1)) + S(pushed27(1.5)));
say("32 ints" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared27().length + written27(i).length + pushed27(i).length; if (i % 50 === 0) garbage(); } return t + S(shared27()); });
function shared28() { return ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18", "s19", "s20", "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29", "s30", "s31"]; }
function written28(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18", "s19", "s20", "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29", "s30", "s31"]; a[0] = v; return a; }
function pushed28(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18", "s19", "s20", "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29", "s30", "s31"]; a.push(v); return a; }
say("32 strings" + ", first", () => S(shared28()));
say("32 strings" + ", two are two", () => { const a = shared28(), b = shared28(); return (a !== b) + " " + (S(a) === S(b)); });
say("32 strings" + ", behind collections", () => { collect(); return S(shared28()); });
say("32 strings" + ", written to from outside, then fresh", () => { const a = shared28(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared28(); return S(b) + " " + T(a[0]) + a.length; });
say("32 strings" + ", sorted, reversed, cut, then fresh", () => { shared28().sort(); shared28().reverse(); shared28().length = 0; shared28().fill(9); shared28().splice(0, 1); shared28().shift(); return S(shared28()); });
say("32 strings" + ", frozen, then fresh", () => { const a = Object.freeze(shared28()); const b = shared28(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared28()); });
say("32 strings" + ", written to in place", () => S(written28("W")) + S(written28(1)) + S(written28(1.5)) + S(written28(undefined)));
say("32 strings" + ", pushed to in place", () => S(pushed28("P")) + S(pushed28(1)) + S(pushed28(1.5)));
say("32 strings" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared28().length + written28(i).length + pushed28(i).length; if (i % 50 === 0) garbage(); } return t + S(shared28()); });
function shared29() { return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5]; }
function written29(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5]; a[0] = v; return a; }
function pushed29(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5]; a.push(v); return a; }
say("32 doubles" + ", first", () => S(shared29()));
say("32 doubles" + ", two are two", () => { const a = shared29(), b = shared29(); return (a !== b) + " " + (S(a) === S(b)); });
say("32 doubles" + ", behind collections", () => { collect(); return S(shared29()); });
say("32 doubles" + ", written to from outside, then fresh", () => { const a = shared29(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared29(); return S(b) + " " + T(a[0]) + a.length; });
say("32 doubles" + ", sorted, reversed, cut, then fresh", () => { shared29().sort(); shared29().reverse(); shared29().length = 0; shared29().fill(9); shared29().splice(0, 1); shared29().shift(); return S(shared29()); });
say("32 doubles" + ", frozen, then fresh", () => { const a = Object.freeze(shared29()); const b = shared29(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared29()); });
say("32 doubles" + ", written to in place", () => S(written29("W")) + S(written29(1)) + S(written29(1.5)) + S(written29(undefined)));
say("32 doubles" + ", pushed to in place", () => S(pushed29("P")) + S(pushed29(1)) + S(pushed29(1.5)));
say("32 doubles" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared29().length + written29(i).length + pushed29(i).length; if (i % 50 === 0) garbage(); } return t + S(shared29()); });
function shared30() { return [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16, "m17", 18.25, null, 20, "m21", 22.25, null, 24, "m25", 26.25, null, 28, "m29", 30.25, null]; }
function written30(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16, "m17", 18.25, null, 20, "m21", 22.25, null, 24, "m25", 26.25, null, 28, "m29", 30.25, null]; a[0] = v; return a; }
function pushed30(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16, "m17", 18.25, null, 20, "m21", 22.25, null, 24, "m25", 26.25, null, 28, "m29", 30.25, null]; a.push(v); return a; }
say("32 mixed" + ", first", () => S(shared30()));
say("32 mixed" + ", two are two", () => { const a = shared30(), b = shared30(); return (a !== b) + " " + (S(a) === S(b)); });
say("32 mixed" + ", behind collections", () => { collect(); return S(shared30()); });
say("32 mixed" + ", written to from outside, then fresh", () => { const a = shared30(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared30(); return S(b) + " " + T(a[0]) + a.length; });
say("32 mixed" + ", sorted, reversed, cut, then fresh", () => { shared30().sort(); shared30().reverse(); shared30().length = 0; shared30().fill(9); shared30().splice(0, 1); shared30().shift(); return S(shared30()); });
say("32 mixed" + ", frozen, then fresh", () => { const a = Object.freeze(shared30()); const b = shared30(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared30()); });
say("32 mixed" + ", written to in place", () => S(written30("W")) + S(written30(1)) + S(written30(1.5)) + S(written30(undefined)));
say("32 mixed" + ", pushed to in place", () => S(pushed30("P")) + S(pushed30(1)) + S(pushed30(1.5)));
say("32 mixed" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared30().length + written30(i).length + pushed30(i).length; if (i % 50 === 0) garbage(); } return t + S(shared30()); });
function shared31() { return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]; }
function written31(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]; a[0] = v; return a; }
function pushed31(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]; a.push(v); return a; }
say("33 ints" + ", first", () => S(shared31()));
say("33 ints" + ", two are two", () => { const a = shared31(), b = shared31(); return (a !== b) + " " + (S(a) === S(b)); });
say("33 ints" + ", behind collections", () => { collect(); return S(shared31()); });
say("33 ints" + ", written to from outside, then fresh", () => { const a = shared31(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared31(); return S(b) + " " + T(a[0]) + a.length; });
say("33 ints" + ", sorted, reversed, cut, then fresh", () => { shared31().sort(); shared31().reverse(); shared31().length = 0; shared31().fill(9); shared31().splice(0, 1); shared31().shift(); return S(shared31()); });
say("33 ints" + ", frozen, then fresh", () => { const a = Object.freeze(shared31()); const b = shared31(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared31()); });
say("33 ints" + ", written to in place", () => S(written31("W")) + S(written31(1)) + S(written31(1.5)) + S(written31(undefined)));
say("33 ints" + ", pushed to in place", () => S(pushed31("P")) + S(pushed31(1)) + S(pushed31(1.5)));
say("33 ints" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared31().length + written31(i).length + pushed31(i).length; if (i % 50 === 0) garbage(); } return t + S(shared31()); });
function shared32() { return ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18", "s19", "s20", "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29", "s30", "s31", "s32"]; }
function written32(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18", "s19", "s20", "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29", "s30", "s31", "s32"]; a[0] = v; return a; }
function pushed32(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18", "s19", "s20", "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29", "s30", "s31", "s32"]; a.push(v); return a; }
say("33 strings" + ", first", () => S(shared32()));
say("33 strings" + ", two are two", () => { const a = shared32(), b = shared32(); return (a !== b) + " " + (S(a) === S(b)); });
say("33 strings" + ", behind collections", () => { collect(); return S(shared32()); });
say("33 strings" + ", written to from outside, then fresh", () => { const a = shared32(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared32(); return S(b) + " " + T(a[0]) + a.length; });
say("33 strings" + ", sorted, reversed, cut, then fresh", () => { shared32().sort(); shared32().reverse(); shared32().length = 0; shared32().fill(9); shared32().splice(0, 1); shared32().shift(); return S(shared32()); });
say("33 strings" + ", frozen, then fresh", () => { const a = Object.freeze(shared32()); const b = shared32(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared32()); });
say("33 strings" + ", written to in place", () => S(written32("W")) + S(written32(1)) + S(written32(1.5)) + S(written32(undefined)));
say("33 strings" + ", pushed to in place", () => S(pushed32("P")) + S(pushed32(1)) + S(pushed32(1.5)));
say("33 strings" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared32().length + written32(i).length + pushed32(i).length; if (i % 50 === 0) garbage(); } return t + S(shared32()); });
function shared33() { return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5]; }
function written33(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5]; a[0] = v; return a; }
function pushed33(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5]; a.push(v); return a; }
say("33 doubles" + ", first", () => S(shared33()));
say("33 doubles" + ", two are two", () => { const a = shared33(), b = shared33(); return (a !== b) + " " + (S(a) === S(b)); });
say("33 doubles" + ", behind collections", () => { collect(); return S(shared33()); });
say("33 doubles" + ", written to from outside, then fresh", () => { const a = shared33(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared33(); return S(b) + " " + T(a[0]) + a.length; });
say("33 doubles" + ", sorted, reversed, cut, then fresh", () => { shared33().sort(); shared33().reverse(); shared33().length = 0; shared33().fill(9); shared33().splice(0, 1); shared33().shift(); return S(shared33()); });
say("33 doubles" + ", frozen, then fresh", () => { const a = Object.freeze(shared33()); const b = shared33(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared33()); });
say("33 doubles" + ", written to in place", () => S(written33("W")) + S(written33(1)) + S(written33(1.5)) + S(written33(undefined)));
say("33 doubles" + ", pushed to in place", () => S(pushed33("P")) + S(pushed33(1)) + S(pushed33(1.5)));
say("33 doubles" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared33().length + written33(i).length + pushed33(i).length; if (i % 50 === 0) garbage(); } return t + S(shared33()); });
function shared34() { return [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16, "m17", 18.25, null, 20, "m21", 22.25, null, 24, "m25", 26.25, null, 28, "m29", 30.25, null, 32]; }
function written34(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16, "m17", 18.25, null, 20, "m21", 22.25, null, 24, "m25", 26.25, null, 28, "m29", 30.25, null, 32]; a[0] = v; return a; }
function pushed34(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16, "m17", 18.25, null, 20, "m21", 22.25, null, 24, "m25", 26.25, null, 28, "m29", 30.25, null, 32]; a.push(v); return a; }
say("33 mixed" + ", first", () => S(shared34()));
say("33 mixed" + ", two are two", () => { const a = shared34(), b = shared34(); return (a !== b) + " " + (S(a) === S(b)); });
say("33 mixed" + ", behind collections", () => { collect(); return S(shared34()); });
say("33 mixed" + ", written to from outside, then fresh", () => { const a = shared34(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared34(); return S(b) + " " + T(a[0]) + a.length; });
say("33 mixed" + ", sorted, reversed, cut, then fresh", () => { shared34().sort(); shared34().reverse(); shared34().length = 0; shared34().fill(9); shared34().splice(0, 1); shared34().shift(); return S(shared34()); });
say("33 mixed" + ", frozen, then fresh", () => { const a = Object.freeze(shared34()); const b = shared34(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared34()); });
say("33 mixed" + ", written to in place", () => S(written34("W")) + S(written34(1)) + S(written34(1.5)) + S(written34(undefined)));
say("33 mixed" + ", pushed to in place", () => S(pushed34("P")) + S(pushed34(1)) + S(pushed34(1.5)));
say("33 mixed" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared34().length + written34(i).length + pushed34(i).length; if (i % 50 === 0) garbage(); } return t + S(shared34()); });
function shared35() { return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99]; }
function written35(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99]; a[0] = v; return a; }
function pushed35(v) { const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99]; a.push(v); return a; }
say("100 ints" + ", first", () => S(shared35()));
say("100 ints" + ", two are two", () => { const a = shared35(), b = shared35(); return (a !== b) + " " + (S(a) === S(b)); });
say("100 ints" + ", behind collections", () => { collect(); return S(shared35()); });
say("100 ints" + ", written to from outside, then fresh", () => { const a = shared35(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared35(); return S(b) + " " + T(a[0]) + a.length; });
say("100 ints" + ", sorted, reversed, cut, then fresh", () => { shared35().sort(); shared35().reverse(); shared35().length = 0; shared35().fill(9); shared35().splice(0, 1); shared35().shift(); return S(shared35()); });
say("100 ints" + ", frozen, then fresh", () => { const a = Object.freeze(shared35()); const b = shared35(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared35()); });
say("100 ints" + ", written to in place", () => S(written35("W")) + S(written35(1)) + S(written35(1.5)) + S(written35(undefined)));
say("100 ints" + ", pushed to in place", () => S(pushed35("P")) + S(pushed35(1)) + S(pushed35(1.5)));
say("100 ints" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared35().length + written35(i).length + pushed35(i).length; if (i % 50 === 0) garbage(); } return t + S(shared35()); });
function shared36() { return ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18", "s19", "s20", "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29", "s30", "s31", "s32", "s33", "s34", "s35", "s36", "s37", "s38", "s39", "s40", "s41", "s42", "s43", "s44", "s45", "s46", "s47", "s48", "s49", "s50", "s51", "s52", "s53", "s54", "s55", "s56", "s57", "s58", "s59", "s60", "s61", "s62", "s63", "s64", "s65", "s66", "s67", "s68", "s69", "s70", "s71", "s72", "s73", "s74", "s75", "s76", "s77", "s78", "s79", "s80", "s81", "s82", "s83", "s84", "s85", "s86", "s87", "s88", "s89", "s90", "s91", "s92", "s93", "s94", "s95", "s96", "s97", "s98", "s99"]; }
function written36(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18", "s19", "s20", "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29", "s30", "s31", "s32", "s33", "s34", "s35", "s36", "s37", "s38", "s39", "s40", "s41", "s42", "s43", "s44", "s45", "s46", "s47", "s48", "s49", "s50", "s51", "s52", "s53", "s54", "s55", "s56", "s57", "s58", "s59", "s60", "s61", "s62", "s63", "s64", "s65", "s66", "s67", "s68", "s69", "s70", "s71", "s72", "s73", "s74", "s75", "s76", "s77", "s78", "s79", "s80", "s81", "s82", "s83", "s84", "s85", "s86", "s87", "s88", "s89", "s90", "s91", "s92", "s93", "s94", "s95", "s96", "s97", "s98", "s99"]; a[0] = v; return a; }
function pushed36(v) { const a = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17", "s18", "s19", "s20", "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29", "s30", "s31", "s32", "s33", "s34", "s35", "s36", "s37", "s38", "s39", "s40", "s41", "s42", "s43", "s44", "s45", "s46", "s47", "s48", "s49", "s50", "s51", "s52", "s53", "s54", "s55", "s56", "s57", "s58", "s59", "s60", "s61", "s62", "s63", "s64", "s65", "s66", "s67", "s68", "s69", "s70", "s71", "s72", "s73", "s74", "s75", "s76", "s77", "s78", "s79", "s80", "s81", "s82", "s83", "s84", "s85", "s86", "s87", "s88", "s89", "s90", "s91", "s92", "s93", "s94", "s95", "s96", "s97", "s98", "s99"]; a.push(v); return a; }
say("100 strings" + ", first", () => S(shared36()));
say("100 strings" + ", two are two", () => { const a = shared36(), b = shared36(); return (a !== b) + " " + (S(a) === S(b)); });
say("100 strings" + ", behind collections", () => { collect(); return S(shared36()); });
say("100 strings" + ", written to from outside, then fresh", () => { const a = shared36(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared36(); return S(b) + " " + T(a[0]) + a.length; });
say("100 strings" + ", sorted, reversed, cut, then fresh", () => { shared36().sort(); shared36().reverse(); shared36().length = 0; shared36().fill(9); shared36().splice(0, 1); shared36().shift(); return S(shared36()); });
say("100 strings" + ", frozen, then fresh", () => { const a = Object.freeze(shared36()); const b = shared36(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared36()); });
say("100 strings" + ", written to in place", () => S(written36("W")) + S(written36(1)) + S(written36(1.5)) + S(written36(undefined)));
say("100 strings" + ", pushed to in place", () => S(pushed36("P")) + S(pushed36(1)) + S(pushed36(1.5)));
say("100 strings" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared36().length + written36(i).length + pushed36(i).length; if (i % 50 === 0) garbage(); } return t + S(shared36()); });
function shared37() { return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5, 42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5, 49.5, 50.5, 51.5, 52.5, 53.5, 54.5, 55.5, 56.5, 57.5, 58.5, 59.5, 60.5, 61.5, 62.5, 63.5, 64.5, 65.5, 66.5, 67.5, 68.5, 69.5, 70.5, 71.5, 72.5, 73.5, 74.5, 75.5, 76.5, 77.5, 78.5, 79.5, 80.5, 81.5, 82.5, 83.5, 84.5, 85.5, 86.5, 87.5, 88.5, 89.5, 90.5, 91.5, 92.5, 93.5, 94.5, 95.5, 96.5, 97.5, 98.5, 99.5]; }
function written37(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5, 42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5, 49.5, 50.5, 51.5, 52.5, 53.5, 54.5, 55.5, 56.5, 57.5, 58.5, 59.5, 60.5, 61.5, 62.5, 63.5, 64.5, 65.5, 66.5, 67.5, 68.5, 69.5, 70.5, 71.5, 72.5, 73.5, 74.5, 75.5, 76.5, 77.5, 78.5, 79.5, 80.5, 81.5, 82.5, 83.5, 84.5, 85.5, 86.5, 87.5, 88.5, 89.5, 90.5, 91.5, 92.5, 93.5, 94.5, 95.5, 96.5, 97.5, 98.5, 99.5]; a[0] = v; return a; }
function pushed37(v) { const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5, 36.5, 37.5, 38.5, 39.5, 40.5, 41.5, 42.5, 43.5, 44.5, 45.5, 46.5, 47.5, 48.5, 49.5, 50.5, 51.5, 52.5, 53.5, 54.5, 55.5, 56.5, 57.5, 58.5, 59.5, 60.5, 61.5, 62.5, 63.5, 64.5, 65.5, 66.5, 67.5, 68.5, 69.5, 70.5, 71.5, 72.5, 73.5, 74.5, 75.5, 76.5, 77.5, 78.5, 79.5, 80.5, 81.5, 82.5, 83.5, 84.5, 85.5, 86.5, 87.5, 88.5, 89.5, 90.5, 91.5, 92.5, 93.5, 94.5, 95.5, 96.5, 97.5, 98.5, 99.5]; a.push(v); return a; }
say("100 doubles" + ", first", () => S(shared37()));
say("100 doubles" + ", two are two", () => { const a = shared37(), b = shared37(); return (a !== b) + " " + (S(a) === S(b)); });
say("100 doubles" + ", behind collections", () => { collect(); return S(shared37()); });
say("100 doubles" + ", written to from outside, then fresh", () => { const a = shared37(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared37(); return S(b) + " " + T(a[0]) + a.length; });
say("100 doubles" + ", sorted, reversed, cut, then fresh", () => { shared37().sort(); shared37().reverse(); shared37().length = 0; shared37().fill(9); shared37().splice(0, 1); shared37().shift(); return S(shared37()); });
say("100 doubles" + ", frozen, then fresh", () => { const a = Object.freeze(shared37()); const b = shared37(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared37()); });
say("100 doubles" + ", written to in place", () => S(written37("W")) + S(written37(1)) + S(written37(1.5)) + S(written37(undefined)));
say("100 doubles" + ", pushed to in place", () => S(pushed37("P")) + S(pushed37(1)) + S(pushed37(1.5)));
say("100 doubles" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared37().length + written37(i).length + pushed37(i).length; if (i % 50 === 0) garbage(); } return t + S(shared37()); });
function shared38() { return [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16, "m17", 18.25, null, 20, "m21", 22.25, null, 24, "m25", 26.25, null, 28, "m29", 30.25, null, 32, "m33", 34.25, null, 36, "m37", 38.25, null, 40, "m41", 42.25, null, 44, "m45", 46.25, null, 48, "m49", 50.25, null, 52, "m53", 54.25, null, 56, "m57", 58.25, null, 60, "m61", 62.25, null, 64, "m65", 66.25, null, 68, "m69", 70.25, null, 72, "m73", 74.25, null, 76, "m77", 78.25, null, 80, "m81", 82.25, null, 84, "m85", 86.25, null, 88, "m89", 90.25, null, 92, "m93", 94.25, null, 96, "m97", 98.25, null]; }
function written38(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16, "m17", 18.25, null, 20, "m21", 22.25, null, 24, "m25", 26.25, null, 28, "m29", 30.25, null, 32, "m33", 34.25, null, 36, "m37", 38.25, null, 40, "m41", 42.25, null, 44, "m45", 46.25, null, 48, "m49", 50.25, null, 52, "m53", 54.25, null, 56, "m57", 58.25, null, 60, "m61", 62.25, null, 64, "m65", 66.25, null, 68, "m69", 70.25, null, 72, "m73", 74.25, null, 76, "m77", 78.25, null, 80, "m81", 82.25, null, 84, "m85", 86.25, null, 88, "m89", 90.25, null, 92, "m93", 94.25, null, 96, "m97", 98.25, null]; a[0] = v; return a; }
function pushed38(v) { const a = [0, "m1", 2.25, null, 4, "m5", 6.25, null, 8, "m9", 10.25, null, 12, "m13", 14.25, null, 16, "m17", 18.25, null, 20, "m21", 22.25, null, 24, "m25", 26.25, null, 28, "m29", 30.25, null, 32, "m33", 34.25, null, 36, "m37", 38.25, null, 40, "m41", 42.25, null, 44, "m45", 46.25, null, 48, "m49", 50.25, null, 52, "m53", 54.25, null, 56, "m57", 58.25, null, 60, "m61", 62.25, null, 64, "m65", 66.25, null, 68, "m69", 70.25, null, 72, "m73", 74.25, null, 76, "m77", 78.25, null, 80, "m81", 82.25, null, 84, "m85", 86.25, null, 88, "m89", 90.25, null, 92, "m93", 94.25, null, 96, "m97", 98.25, null]; a.push(v); return a; }
say("100 mixed" + ", first", () => S(shared38()));
say("100 mixed" + ", two are two", () => { const a = shared38(), b = shared38(); return (a !== b) + " " + (S(a) === S(b)); });
say("100 mixed" + ", behind collections", () => { collect(); return S(shared38()); });
say("100 mixed" + ", written to from outside, then fresh", () => { const a = shared38(); a[0] = "W"; a[a.length - 1] = 0.5; a.push({}); const b = shared38(); return S(b) + " " + T(a[0]) + a.length; });
say("100 mixed" + ", sorted, reversed, cut, then fresh", () => { shared38().sort(); shared38().reverse(); shared38().length = 0; shared38().fill(9); shared38().splice(0, 1); shared38().shift(); return S(shared38()); });
say("100 mixed" + ", frozen, then fresh", () => { const a = Object.freeze(shared38()); const b = shared38(); b[0] = 1; return Object.isFrozen(a) + " " + Object.isFrozen(b) + " " + S(shared38()); });
say("100 mixed" + ", written to in place", () => S(written38("W")) + S(written38(1)) + S(written38(1.5)) + S(written38(undefined)));
say("100 mixed" + ", pushed to in place", () => S(pushed38("P")) + S(pushed38(1)) + S(pushed38(1.5)));
say("100 mixed" + ", hot", () => { let t = 0; for (let i = 0; i < 300; i++) { t += shared38().length + written38(i).length + pushed38(i).length; if (i % 50 === 0) garbage(); } return t + S(shared38()); });
say("a string of a literal is the string elsewhere", () => { const a = ["shared text", "length", "k1"]; const o = { k1: "by key", "shared text": 1 }; return [a[0] === "shared text", o[a[2]], o[a[0]], [1, 2][a[1]], a[0].length, a.indexOf("k1"), a.includes("length")].join(); });
function once() { return ["made once, nowhere else in the text", "and this one too", "x"]; }
say("come to once, kept, collected, read", () => { const a = once(); collect(); collect(); return S(a) + a[0].length + a[0].toUpperCase().slice(0, 4); });
say("come to again", () => { collect(); return S(once()); });
say("the elements outlive the array", () => { let s = (() => ["an element that outlives its array", "b"])()[0]; collect(); return s + s.length; });
say("in a generator and an async function", () => { function* g() { yield [1, "g", 2.5]; collect(); yield [1, "g", 2.5]; } const r = [...g()].map(S).join(); (async () => ["as", 1])().then(a => console.log("async: " + S(a))); return r; });
say("nested", () => S([[1, 2], ["a", "b"], [1.5]].flat()) + S([[["deep"]]][0][0]));
say("as arguments, spread, destructured", () => { const f = (...a) => a.length; const [x, , z = "d"] = ["x", "y"]; return [f(...[1, "a", null]), Math.max(...[1, 5, 3]), x, z, [..."ab", ...["c", "d"]].join("")].join(); });
function fill(n) { const a = []; for (let i = 0; i < n; i++) a.push(i); return a; }
function fillTexts(n) { const a = []; for (let i = 0; i < n; i++) a.push("t" + i); return a; }
function fillMixed(n) { const a = []; for (let i = 0; i < n; i++) a.push(i % 3 ? i : i % 2 ? "s" : 0.5); return a; }
function one(x) { const a = []; a.push(x); return a; }                                        // small: it may have no frame
function maybe(c, x) { const a = []; if (c) a.push(x); return a; }
const sum = a => { let t = a.length; for (let i = 0; i < a.length; i++) t = (t * 31 + (typeof a[i] === "number" ? a[i] * 2 : a[i].length)) | 0; return t; };
for (const f of [fill, fillTexts, fillMixed]) {
  let t = 0;
  for (const n of [0, 1, 2, 3, 4, 5, 6, 10, 100, 127, 128, 200, 300, 6, 3, 1, 0, 5, 2]) { for (let b = 0; b < 400; b++) t = (t + sum(f(n))) | 0; say(f.name + " " + n + " x 400", () => t + " " + f(n).length); }
  say(f.name + " by turns", () => { let u = 0; for (let b = 0; b < 3000; b++) u = (u + sum(f(b % 13))) | 0; return u; });
  say(f.name + " with collections", () => { let u = 0; const kept = []; for (let b = 0; b < 600; b++) { const a = f(b % 9); if (b % 50 === 0) { kept.push(a); garbage(); } u = (u + sum(a)) | 0; } collect(); return u + " " + kept.map(sum).join(); });
}
say("one x 1000", () => { let t = 0; for (let b = 0; b < 1000; b++) t += one(b)[0] + one("s").length + one({ b }).length; return t; });
say("maybe x 1000", () => { let t = 0; for (let b = 0; b < 1000; b++) t += maybe(b % 3 === 0, b).length; return t; });
say("in a generator", () => { function* g() { for (let b = 0; b < 200; b++) { const a = []; a.push(b); yield a; a.push(b); } } let t = 0; for (const a of g()) t += a.length + a[0]; return t; });
say("two sites in one function", () => { let t = 0; for (let b = 0; b < 500; b++) { const x = [], y = []; x.push(b); for (let i = 0; i < 20; i++) y.push(i); t += x.length + y.length; } return t; });
say("the arrays are apart", () => { const x = fill(3), y = fill(3); x.push("x"); return S(x) + S(y); });
function lateInts() { return [4, 5, 6]; } function lateTexts() { return ["never come to", "ahead of the bad time", "z"]; } function lateLong() { const a = ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11", "L12", "L13", "L14", "L15", "L16", "L17", "L18", "L19", "L20", "L21", "L22", "L23", "L24", "L25", "L26", "L27", "L28", "L29", "L30", "L31", "L32", "L33", "L34", "L35", "L36", "L37", "L38", "L39"]; a[0] = "W"; return a; }
say("A BAD TIME", () => { const p = {}; Object.create(p); Object.defineProperty(p, 0, { value: 7, writable: false }); return "from here on"; });
say("first use in a bad time", () => S(lateInts()) + S(lateTexts()) + S(lateLong()).length);
say("again in a bad time", () => { collect(); const a = lateTexts(); a[1] = "W"; a.push(1); return S(a) + S(lateTexts()) + S(lateInts()); });
say("come to before, now in a bad time 1", () => { const a = shared1(); a[0] = "W"; return S(shared1()) + S(written1(1)).length + S(pushed1(1)).length; });
say("come to before, now in a bad time 2", () => { const a = shared2(); a[0] = "W"; return S(shared2()) + S(written2(1)).length + S(pushed2(1)).length; });
say("come to before, now in a bad time 3", () => { const a = shared3(); a[0] = "W"; return S(shared3()) + S(written3(1)).length + S(pushed3(1)).length; });
say("come to before, now in a bad time 10", () => { const a = shared10(); a[0] = "W"; return S(shared10()) + S(written10(1)).length + S(pushed10(1)).length; });
say("come to before, now in a bad time 38", () => { const a = shared38(); a[0] = "W"; return S(shared38()) + S(written38(1)).length + S(pushed38(1)).length; });
say("pushed to in a bad time", () => { let t = 0; for (const n of [0, 1, 3, 6, 100, 200]) for (let b = 0; b < 200; b++) t = (t + sum(fill(n)) + sum(fillTexts(n))) | 0; return t + S(fill(3)) + S(one("x")); });
