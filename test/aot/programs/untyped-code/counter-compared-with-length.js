// `index == length`, `index === length`: a counter, which is kept as an integer, against a value that is only expected to be a number: an int32 is compared as an integer, as `index < length` is.
function reachesEnd(list, limit) { var index = 0, length = list.length; while (index < length && index < limit) index++; return index == length; }
function reachesEndStrictly(list, limit) { var index = 0, length = list.length; while (index < length && index < limit) index++; return index === length; }
var lists = [[], [1], [1, 2, 3], "ab", { length: 2 }, { length: 2.5 }, { length: "2" }, { length: -0 }, { length: NaN }, { length: null }, { length: undefined }, { length: 2n }, { length: { valueOf: function () { return 1; } } }, { length: true }, { length: 4294967296 }, {}];
for (var limit of [0, 1, 2, 10]) {
  console.log(limit, lists.map(function (list) { return +reachesEnd(list, limit); }).join(""), lists.map(function (list) { return +reachesEndStrictly(list, limit); }).join(""));
}
