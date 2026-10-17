// `value !== value`: the way libraries ask for NaN (lodash's eq(), React's is()). Everything is the same as itself but NaN: in hot text two tests say so for whatever is no double; no stub is asked.
// CALLS- indexOfNaN StrictEqual
// CALLS- indexOfNaNLoosely (Strict|Loose)Equal
function indexOfNaN(list) { var index = -1; while (++index < list.length) { var value = list[index]; if (value !== value) return index; } return -1; }
function indexOfNaNLoosely(list) { var index = -1; while (++index < list.length) { var value = list[index]; if (value != value) return index; } return -1; }
function eq(value, other) { return value === other || (value !== value && other !== other); }
function indexOf(list, key) { var length = list.length; while (length--) { if (eq(list[length], key)) return length; } return -1; }
function itself(value) { return [value === value, value == value, value !== value, value != value].join(); }
var calls = 0, object = { valueOf: function () { calls++; return 1; }, toString: function () { calls++; return "x"; } };
var values = [0, -0, 1, 1.5, -1.5, 2147483648, Infinity, -Infinity, "", "text", "a" + String(calls), true, false, null, undefined, object, [], function () {}, Symbol.iterator, 10n, 12345678901234567890n];
console.log(indexOfNaN(values), indexOfNaNLoosely(values), indexOfNaN(values.concat([NaN])), indexOfNaNLoosely(values.concat([0 / 0])), indexOfNaN([-(0 / 0)]), indexOfNaN([Math.sqrt(-1), 1]), indexOfNaNLoosely([1, Number("x")]));
console.log(values.map(function (value) { return indexOf(values, value); }).join(), indexOf(values.concat([NaN]), NaN), indexOf(values, NaN), indexOf([NaN, NaN], 0 / 0));
console.log(values.concat([NaN]).map(function (value) { return itself(value); }).join(" "), calls);
