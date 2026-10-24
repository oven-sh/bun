// RegExp.prototype.compile gives a literal another pattern and other flags: called on it, in a callee, through call, by a computed name, by text made at run time. source, flags, test, replace, match, split and search follow. And what `new RegExp` and `RegExp` make of constant operands, valid or not.
const re = /abc/g;
console.log(re.source, re.flags, re.global);
re.compile("xyz", "i");
console.log(re.source, re.flags, re.global, re.ignoreCase, re.test("XYZ"), re.test("abc"), new RegExp(re, "g").source, "aXYZb".replace(re, "-"), "abc".search(re), String(re));
function mut(r) { r.compile("q+"); }
const r2 = /one/; mut(r2); console.log(r2.source, r2.test("qq"), r2.test("one"), "one qq".match(r2)[0], "a,qq,b".split(r2).join("|"));
const r3 = /two/y; RegExp.prototype.compile.call(r3, "2", "g"); console.log(r3.source, r3.flags, r3.sticky, "2 two".replace(r3, "#"));
const r4 = /three/; new Function("r", "r.compile('3')")(r4); console.log(r4.source, r4.test("3"), r4.test("three"));
function f() { const r = /four/; if (Date.now() > 0) r.compile("4"); return r.source + r.test("4") + "four4".replace(r, "!"); } console.log(f(), f());
function g(s) { return /five/.test(s); } const k = "comp" + "ile"; const r5 = /five/; r5[k]("5"); console.log(g("five"), g("5"), r5.test("5"), r5.source);
const r6 = /six/g; r6.lastIndex = 2; console.log("six six".replace(r6, "6"), r6.lastIndex, r6.exec("six six six").index, r6.lastIndex);
console.log(new RegExp("a/b").source, new RegExp("\n").source, new RegExp("").source, new RegExp(undefined).source, new RegExp(null).source, new RegExp(5).source, RegExp("[/]").source, new RegExp("\\/").source, String(new RegExp("/", "gimsuy")), new RegExp(/x/g).flags, RegExp(/x/g, undefined).flags, new RegExp(/x/g, "").flags);
const lit = /same/; console.log(RegExp(lit) === lit, new RegExp(lit) === lit, RegExp(lit, "g") === lit);
for (const bad of [["(", ""], ["a", "gg"], ["a", "x"], ["\\", ""], ["(?<n>a)(?<n>b)", ""], ["a", "uv"]]) { try { new RegExp(bad[0], bad[1]); console.log("ok"); } catch (e) { console.log(e.name, e.message); } }
try { new RegExp("(", ""); } catch (e) { console.log(e.name, e.message); } try { new RegExp("a", "gg"); } catch (e) { console.log(e.name, e.message); } try { RegExp("[", "u"); } catch (e) { console.log(e.name, e.message); }
