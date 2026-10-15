function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
const awkward = [0, -0, 1, 2, 3.5, -1, -1.5, 7, 100, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967297, 1e300, "2", undefined, null, true];

function sliceWithDoubles(text, a, b) { let s = "" + text; return s.slice(+a, +b); }
function sliceWithInt32(text, a, b) { let s = "" + text; return s.slice(a | 0, b | 0); }
function sliceWithAnything(text, a, b) { let s = "" + text; return s.slice(a, b); }
function substringWithDoubles(text, a, b) { let s = "" + text; return s.substring(+a, +b); }
function indexOfFromDouble(text, from) { let s = "" + text; return s.indexOf("a", +from); }
function fromCharCodeOfDouble(code) { return String.fromCharCode(+code); }
function atDouble(i) { let list = [10, 20, 30]; return list.at(+i); }
function halves(text, n) { let s = "" + text, x = +n; return s.slice(x * 0.5, x * 1.5); }
for (let f of [sliceWithDoubles, sliceWithInt32, sliceWithAnything, substringWithDoubles, indexOfFromDouble, fromCharCodeOfDouble, atDouble, halves])
    noInline(f);

check(awkward.map(a => sliceWithDoubles("abcdefgh", a, 6)).join("|"), "abcdef|abcdef|bcdef|cdef|def|||||abcdef||abcdef|||abcdef|abcdef|||cdef|abcdef|abcdef|bcdef", "slice from");
check(awkward.map(b => sliceWithDoubles("abcdefgh", 1, b)).join("|"), "|||b|bc|bcdefg|bcdefg|bcdefg|bcdefgh||bcdefgh||bcdefgh|bcdefgh|||bcdefgh|bcdefgh|b|||", "slice to");
check(awkward.map(a => sliceWithInt32("abcdefgh", a, 6)).join("|"), "abcdef|abcdef|bcdef|cdef|def|||||abcdef|abcdef|abcdef||abcdef|abcdef||bcdef|abcdef|cdef|abcdef|abcdef|bcdef", "slice from an Int32");
check(awkward.map(a => sliceWithAnything("abcdefgh", a, 6)).join("|"), "abcdef|abcdef|bcdef|cdef|def|||||abcdef||abcdef|||abcdef|abcdef|||cdef|abcdef|abcdef|bcdef", "slice from anything");
check(awkward.map(a => substringWithDoubles("abcdefgh", a, 3)).join("|"), "abc|abc|bc|c||abc|abc|defg|defgh|abc|defgh|abc|defgh|defgh|abc|abc|defgh|defgh|c|abc|abc|bc", "substring");
check(awkward.map(from => indexOfFromDouble("abcabc", from)).join(), "0,0,3,3,3,0,0,-1,-1,0,-1,0,-1,-1,0,0,-1,-1,3,0,0,3", "indexOf from");
check(awkward.map(code => fromCharCodeOfDouble(code).charCodeAt(0)).join(), "0,0,1,2,3,65535,65535,7,100,0,0,0,65535,0,0,65535,1,0,2,0,0,1", "fromCharCode");
check(awkward.map(i => String(atDouble(i))).join(), "10,10,20,30,undefined,30,30,undefined,undefined,10,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,30,10,10,20", "at");
check([0, 1, 2, 3, 4].map(n => halves("abcdefgh", n)).join("|"), "|a|bc|bcd|cdef", "slice between products");

function charCodeAtDouble(text, i) { let s = "" + text; return s.charCodeAt(+i); }
function codePointAtDouble(text, i) { let s = "" + text; return s.codePointAt(+i); }
function charAtDouble(text, i) { let s = "" + text; return s.charAt(+i); }
function charCodeAtInt32(text, i) { let s = "" + text; return s.charCodeAt(i | 0); }
function charCodeAtAnything(text, i) { let s = "" + text; return s.charCodeAt(i); }
function pushesDouble(list, x) { list.push(+x); return list; }
function looksUpDouble(map, key) { return map.get(+key); }
function hasDouble(set, key) { return set.has(+key); }
function storesAtDouble(list, i, value) { list[+i] = value; return list; }
for (let f of [charCodeAtDouble, codePointAtDouble, charAtDouble, charCodeAtInt32, charCodeAtAnything, pushesDouble, looksUpDouble, hasDouble, storesAtDouble])
    noInline(f);

check(awkward.map(i => charCodeAtDouble("abc", i)).join(), "97,97,98,99,NaN,NaN,NaN,NaN,NaN,97,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,99,97,97,98", "charCodeAt");
check(awkward.map(i => String(codePointAtDouble("a\u{1f600}c", i))).join(), "97,97,128512,56832,99,undefined,undefined,undefined,undefined,97,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,56832,97,97,128512", "codePointAt");
check(awkward.map(i => charAtDouble("abc", i)).join(), "a,a,b,c,,,,,,a,,,,,,,,,c,a,a,b", "charAt");
check(awkward.map(i => charCodeAtInt32("abc", i)).join(), "97,97,98,99,NaN,NaN,NaN,NaN,NaN,97,97,97,NaN,NaN,NaN,NaN,98,97,99,97,97,98", "charCodeAt an Int32");
check(awkward.map(i => charCodeAtAnything("abc", i)).join(), "97,97,98,99,NaN,NaN,NaN,NaN,NaN,97,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,99,97,97,98", "charCodeAt anything");
let pushed = [1, 2];
for (let x of [3, 4.5, -0, NaN, "5"])
    pushesDouble(pushed, x);
check(pushed.length, 7, "length after pushes");
check(pushed[2], 3, "a pushed integer");
check(pushed[3], 4.5, "a pushed fraction");
check(pushed[4], -0, "a pushed negative zero");
check(pushed[5], NaN, "a pushed NaN");
check(pushed[6], 5, "a pushed converted string");
let map = new Map([[0, "zero"], [1, "one"], [1.5, "one and a half"], [NaN, "not a number"], [2147483648, "large"]]);
check([0, -0, 1, 1.5, NaN, 2147483648, 2, "1"].map(key => String(looksUpDouble(map, key))).join(), "zero,zero,one,one and a half,not a number,large,undefined,one", "Map.prototype.get");
let set = new Set([0, 1, 1.5, NaN]);
check([0, -0, 1, 1.5, NaN, 2, "1"].map(key => hasDouble(set, key)).join(), "true,true,true,true,true,false,true", "Set.prototype.has");
let stored = [];
for (let i of [0, 1, -0, 2, "3", 1.5, NaN, -1])
    storesAtDouble(stored, i, "at " + String(i));
check(stored.join(), "at 0,at 1,at 2,at 3", "elements stored");
check(stored[0], "at 0", "the element at negative zero");
check(stored["1.5"], "at 1.5", "a property named by a fraction");
check(stored["NaN"], "at NaN", "a property named NaN");
check(stored["-1"], "at -1", "a property named by a negative number");
console.log("passed");
