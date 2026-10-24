// Two lists of whatever a component depends on are compared element by element with Object.is, as a UI library does on every render.
const word = process.argv[3] ?? "";
const open = new Function("value", "return value" + word.slice(word.length));
function is(x, y) {
  return (x === y && (0 !== x || 1 / x === 1 / y)) || (x !== x && y !== y);
}
var objectIs = "function" === typeof Object.is ? Object.is : is;

function areInputsEqual(next, previous) {
  if (null === previous) return !1;
  for (var i = 0; i < previous.length && i < next.length; i++)
    if (!objectIs(next[i], previous[i])) return !1;
  return !0;
}

const shared = { name: "shared" }, callback = () => 1;
const lists = open([
  [shared, callback, "text", 4],
  [shared, callback, "text", 4],
  [callback, shared],
  [callback, shared],
  ["a", "b", "c"],
  ["a", "b", "d"],
  [1, 2, 3],
  [1, 2, 3],
]);
const rounds = Number(process.argv[2] ?? 200000);
let equal = 0;
for (let i = 0; i < rounds; i++) {
  const pair = (i & 3) << 1;
  if (areInputsEqual(lists[pair], lists[pair + 1])) equal++;
}
console.log(equal, areInputsEqual(lists[0], null), areInputsEqual([rounds, 2], [rounds, 2]));
