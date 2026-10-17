// What the engine knows of a host object's accessor outlives a collection.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
function lastMatch() { return RegExp.lastMatch; }
function firstGroup() { return RegExp.$1; }
function input() { return RegExp.input; }
const read = () => lastMatch() + "|" + firstGroup() + "|" + input();
/(b+)c/.exec("aabbbcd");
const seen = new Set();
for (let i = 0; i < 100; i++) seen.add(read());
const before = count("operationAOTGetById");
for (let turn = 0; turn < 40; turn++) {
  collect();
  for (let i = 0; i < 20; i++) seen.add(read());
}
const times = count("operationAOTGetById") - before;
console.log([...seen].join(" "), times < 40 ? "and the operation was entered under 40 times" : "and the operation was entered " + times + " times");
/(x)y/.exec("wxyz");
console.log(read());
collect();
/(q+)/.exec("ppqqq");
console.log(read());
