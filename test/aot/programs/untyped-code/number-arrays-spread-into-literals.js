// `[...numbers]` in code that says nothing of its arrays: the array that is spread holds numbers alone, the literal may come to hold anything. Every element arrives as the number it is, a hole arrives as undefined, and spreading such arrays over and over takes no work outside compiled code.
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? counted("operationAOTAppendSpread") : 0;
const lines = [];
const show = list => list.length + ":" + list.map((x, i) => (i in list ? "" : "hole ") + (Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : String(x))).join(",") + ":" + Object.keys(list).join("");
const spreads = {
  copy(a) { return [...a]; },
  two(a, b) { return [...a, ...b]; },
  between(a) { return [0, ...a, "x"]; },
  behindText(a) { return ["t", ...a]; },
  thrice(a) { return [...a, ...a, ...a]; },
};
const named = name => spreads[[name][0]];
const copy = named("copy"), two = named("two"), between = named("between"), behindText = named("behindText"), thrice = named("thrice");
const grown = []; for (let i = 0; i < 40; i++) grown.push(i + 0.5);
const long = []; for (let i = 0; i < 70; i++) long.push(i * 1.5);
const holey = [1.5, , 2.5]; const holeyAtEnd = [1.5, 2.5]; holeyAtEnd.length = 3;
const popped = [1.5, 2.5, 3.5]; popped.pop();
const makers = {
  whole: () => [1, 2, 3], fractions: () => [1.5, 2.25, -3.75], mixed: () => [1, 2.5, 3], zeros: () => [0, -0, 0.5], edges: () => [Infinity, -Infinity, 1e308, 5e-324, 2 ** 31, -(2 ** 31) - 1, 2 ** 53],
  notANumber: () => [1.5, NaN, 2.5], one: () => [7.5], none: () => [], grown: () => grown, long: () => long, holey: () => holey, holeyAtEnd: () => holeyAtEnd, popped: () => popped,
  computed: () => [1, 2, 3].map(x => x / 2), filled: () => new Array(3).fill(1.5), typedArray: () => new Float64Array([1.5, 2.5]), words: () => ["a", "b"], both: () => [1.5, "a"],
};
for (let turn = 0; turn < 3; turn++) for (const name in makers) {
  const a = makers[name]();
  lines.push(turn + " " + name + " " + show(copy(a)) + " | " + show(two(a, makers.fractions())) + " | " + show(two(makers.words(), a)) + " | " + show(between(a)) + " | " + show(behindText(a)) + " | " + show(thrice(a)) + " | " + show(Array.from(a)));
}
const source = [1.5, 2.5], made = copy(source); made[0] = "changed"; made.push({}); lines.push(show(source) + " " + made.length);
for (let i = 0; i < 5; i++) { copy(makers.fractions()); two(makers.whole(), makers.fractions()); two(makers.words(), makers.mixed()); }
const before = entered();
let sum = 0;
for (let i = 0; i < 3000; i++) sum += copy(makers.fractions()).length + two(makers.whole(), makers.fractions()).length + two(makers.words(), makers.mixed()).length + copy(grown).length;
lines.push(sum + " " + (counted ? entered() - before < 100 : true));
console.log(lines.join("\n"));
