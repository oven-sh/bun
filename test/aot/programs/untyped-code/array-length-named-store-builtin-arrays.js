// Stores `x.length = n` where x has no type and is an array that a built-in made: empty ones that hold nothing yet, and ones of integers, doubles and anything.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
function say(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
}
function setLength(target, length) {
  target.length = length;
  return target;
}
function describe(list) {
  const holes = [];
  for (let i = 0; i < list.length && i < 10; ++i) {
    if (!(i in list)) holes.push(i);
  }
  return [list.length, Array.from(list).slice(0, 10), "holes", holes];
}
const makers = {
  "new Array()": () => new Array(),
  "new Array(3)": () => new Array(3),
  "Array(0)": () => Array(0),
  "Array.of()": () => Array.of(),
  "Array.from of nothing": () => Array.from([]),
  "Array.from": () => Array.from({ length: 3 }, (_, i) => i),
  "an empty slice": () => [1, 2, 3].slice(3),
  "a slice": () => [1, 2, 3, 4].slice(1),
  "an empty filter": () => [1, 2, 3].filter(() => false),
  "a filter": () => [1.5, 2.5, 3.5].filter(x => x > 2),
  "an empty map": () => [].map(x => x),
  "a map": () => [1, 2, 3].map(x => x / 2),
  "a concat": () => [].concat([], []),
  "a split": () => "a,b,c".split(","),
  "keys of nothing": () => Object.keys({}),
  "keys": () => Object.keys({ a: 1, b: 2 }),
  "parsed, empty": () => JSON.parse("[]"),
  "parsed": () => JSON.parse("[1,2.5,\"x\"]"),
  "a splice": () => [1, 2, 3].splice(0, 0),
};
for (const [name, make] of Object.entries(makers)) {
  for (let warm = 0; warm < 30; ++warm) setLength(make(), warm % 3);
  const lengthened = setLength(make(), 2);
  const again = setLength(setLength(make(), 0), 2);
  again[1] = "written";
  const pushed = setLength(make(), 0);
  pushed.push(1.5, "x");
  say(name, describe(setLength(make(), 0)), describe(setLength(make(), 1)), describe(lengthened), describe(again), describe(pushed), describe(setLength(make(), 40)).slice(0, 1));
}
{
  let sum = 0;
  // What `split` and `Object.keys` yield shares its elements with other arrays until it is written to: that is left to the run time.
  const all = Object.entries(makers).filter(([name]) => !/split|keys/.test(name)).map(([, make]) => make);
  const before = count("operationAOTPutByIdAndCache");
  for (let i = 0; i < 300; ++i) {
    for (const make of all) sum += setLength(make(), 0).length + setLength(make(), 1).length;
  }
  const asked = count("operationAOTPutByIdAndCache") - before;
  say("rounds", sum);
  say(asked <= 200 ? "the stores asked the run time at most 200 times" : "the stores asked the run time " + asked + " times");
}
console.log(lines.join("\n"));
