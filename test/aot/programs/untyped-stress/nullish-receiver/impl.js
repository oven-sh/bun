function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrownBy(f, ...parameters) {
    try {
        f(...parameters);
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}
let order = [];
function noted(what, value) { order.push(what); return value; }
noInline(noted);

function codeOfOptional(text, given, i) { let s = given ? "" + text : undefined; let code = s.charCodeAt(noted("index", i)); return code < 100 ? "below" : "not below"; }
function codeOfOptionalOrNull(text, given, i) { let s = given ? "" + text : null; let code = s.charCodeAt(i); return code < 100 ? "below" : "not below"; }
function placeInOptional(text, which) { let s = which === 0 ? "" + text : which === 1 ? undefined : null; return s.indexOf("c") >= 0 ? "found" : "missing"; }
function codeOfAnything(s, i) { let code = s.charCodeAt(i); return code < 100 ? "below" : "not below"; }
function textOfStringOrNumber(text, which) { let s = which === 0 ? "" + text : which === 1 ? 5 : undefined; let result = s.toString(); return result ? result : "empty"; }
function alwaysNullish(i) { let s = i > 0 ? undefined : null; return s.charCodeAt(i); }
for (let f of [codeOfOptional, codeOfOptionalOrNull, placeInOptional, codeOfAnything, textOfStringOrNumber, alwaysNullish])
    noInline(f);

check(codeOfOptional("abc", true, 0), "below", "the code of a");
check(codeOfOptional("xyz", true, 1), "not below", "the code of y");
check(codeOfOptional("abc", true, 7), "not below", "the code past the end");
check(codeOfOptional("abc", true, -1), "not below", "the code before the start");
check(order.join(), "index,index,index,index", "arguments evaluated");
check(thrownBy(codeOfOptional, "abc", false, 0), "TypeError", "charCodeAt of undefined");
check(order.length, 4, "no argument is evaluated after the read of a method of undefined");
check(codeOfOptionalOrNull("abc", true, 2), "below", "the code of c");
check(thrownBy(codeOfOptionalOrNull, "abc", false, 0), "TypeError", "charCodeAt of null");
check(placeInOptional("abc", 0), "found", "c in abc");
check(placeInOptional("xyz", 0), "missing", "c in xyz");
check(thrownBy(placeInOptional, "abc", 1), "TypeError", "indexOf of undefined");
check(thrownBy(placeInOptional, "abc", 2), "TypeError", "indexOf of null");
check(codeOfAnything("abc", 0), "below", "the code of a in anything");
check(codeOfAnything({ charCodeAt() { return "7"; } }, 0), "below", "a method that returns a string");
check(codeOfAnything({ charCodeAt() { return { valueOf() { return 200; } }; } }, 0), "not below", "a method that returns an object");
check(thrownBy(codeOfAnything, undefined, 0), "TypeError", "charCodeAt of undefined in anything");
check(textOfStringOrNumber("", 0), "empty", "an empty string");
check(textOfStringOrNumber("abc", 0), "abc", "a string");
check(textOfStringOrNumber("abc", 1), "5", "a number");
check(thrownBy(textOfStringOrNumber, "abc", 2), "TypeError", "toString of undefined");
check(thrownBy(alwaysNullish, 1), "TypeError", "undefined and nothing else");
check(thrownBy(alwaysNullish, 0), "TypeError", "null and nothing else");

function lengthOfOptionalString(text, given) { let s = given ? "" + text : undefined; return s.length; }
function lengthOfOptionalArray(a, b, given) { let list = given ? [a, b] : null; return list.length; }
function lengthOfOptionalEmptyArray(given) { let list = given ? [] : undefined; return list.length; }
function lengthAfterResizing(length, given) { let list = given ? [1] : undefined; list.length = length; return list.length; }
function lengthOfStringOrArray(which) { let v = which === 0 ? "abc" : which === 1 ? [1] : which === 2 ? undefined : null; return v.length; }
function lengthOfString(text) { let s = "" + text; return s.length; }
function lengthOfAnything(v) { return v.length; }
function lengthOfStringOrObject(which) { let v = which === 0 ? "abc" : which === 1 ? { length: "long" } : undefined; return v.length; }
for (let f of [lengthOfOptionalString, lengthOfOptionalArray, lengthOfOptionalEmptyArray, lengthAfterResizing, lengthOfStringOrArray, lengthOfString, lengthOfAnything, lengthOfStringOrObject])
    noInline(f);

let left = "left half, which is long enough for a rope, ", right = "and the right half of it";
check(lengthOfOptionalString("", true), 0, "the length of an empty string");
check(lengthOfOptionalString("abc", true), 3, "the length of a string");
check(lengthOfOptionalString(left + right, true), left.length + right.length, "the length of a rope");
check(lengthOfOptionalString("\u{1f600}", true), 2, "the length of a surrogate pair");
check(thrownBy(lengthOfOptionalString, "abc", false), "TypeError", "the length of undefined");
check(lengthOfOptionalArray(1, 2, true), 2, "the length of an array");
check(thrownBy(lengthOfOptionalArray, 1, 2, false), "TypeError", "the length of null");
check(lengthOfOptionalEmptyArray(true), 0, "the length of an empty array");
check(thrownBy(lengthOfOptionalEmptyArray, false), "TypeError", "the length of undefined in place of an array");
check(lengthAfterResizing(0, true), 0, "the length of an emptied array");
check(lengthAfterResizing(2147483647, true), 2147483647, "the largest Int32 as a length");
check(lengthAfterResizing(2147483648, true), 2147483648, "a length that is no Int32");
check(lengthAfterResizing(4294967295, true), 4294967295, "the largest length");
check(thrownBy(lengthAfterResizing, 1, false), "TypeError", "a length stored to undefined");
check([0, 1].map(lengthOfStringOrArray).join(), "3,1", "the length of a string or an array");
check(thrownBy(lengthOfStringOrArray, 2), "TypeError", "the length of undefined in place of either");
check(thrownBy(lengthOfStringOrArray, 3), "TypeError", "the length of null in place of either");
check(lengthOfString("abcd"), 4, "the length of what is a string");
check([lengthOfAnything("ab"), lengthOfAnything([1, 2, 3]), lengthOfAnything({ length: "x" }), lengthOfAnything(5), lengthOfAnything(function (a, b) { })].join(), "2,3,x,,2", "the length of anything");
check(thrownBy(lengthOfAnything, undefined), "TypeError", "the length of undefined in place of anything");
check([0, 1].map(lengthOfStringOrObject).join(), "3,long", "the length of a string or an object");
check(thrownBy(lengthOfStringOrObject, 2), "TypeError", "the length of undefined in place of a string or an object");
console.log("passed");
