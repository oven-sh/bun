// `start + index`, `start - index`: a counter, which is kept as an integer, and a value that is only expected to be a number: an int32 is added as an integer, as `index < length` compares one: the sum is not made in doubles and turned into an integer again. Any other number is for the stub.
// CALLS- offsets uses.* fcmp
function offsets(a, count) { var total = [], index = -1; while (++index < count) total.push(a + index, a - index, index - a); return total; }
function sums(a, count) { var total = [], index = -1; while (++index < count) total.push(a + index, a - index, index - a); return total; }
function copyFrom(list, start) { var index = -1, length = list.length - start, copy = []; while (++index < length) copy[index] = list[start + index]; return copy; }
function attempt(f) { try { return JSON.stringify(f()); } catch (error) { return error.name; } }
var list = [1, 2, 3, 4, 5], starts = [5, 7, 2147483647, -2147483648, 0];
console.log(starts.map(function (start) { return offsets(start, 2).join(); }).join(" "), [1, 2].map(function (start) { return offsets(start, 3).length; }).join());
for (var start of [0, 1, 4, 5, 9, -1, 1.5, "1", "x", null, undefined, true, NaN, 2147483647, 4294967296, 9007199254740991, -0, 1n, { valueOf: function () { return 2; } }]) {
  console.log(String(typeof start == "object" && start ? "object" : start), attempt(function () { return copyFrom(list, start); }), attempt(function () { return sums(start, 3); }));
}
console.log(Object.is(sums(-0, 1)[0], 0), Object.is(sums(-0, 1)[1], -0), Object.is(sums(0, 1)[2], 0), sums(2147483647, 2).join(), sums(-2147483648, 2).join(), sums(9007199254740992, 3).join(), sums(-9007199254740992, 3).join(), sums(0.1, 3).join(), sums(1e300, 2).join());
