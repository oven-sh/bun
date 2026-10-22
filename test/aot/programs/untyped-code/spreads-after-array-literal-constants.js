// `["run", "--flag", ...rest]`, `[0, ...numbers]`, `[null, ...list, "end"]`: an array literal that begins with constants and goes on with a spread. Each evaluation yields an array of its own: what is done to one shows in no other. Making such arrays over and over takes no work outside compiled code.
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? counted("operationAOTAppendSpread") : 0;
const lines = [];
const show = list => list.length + ":" + list.map((x, i) => (i in list ? "" : "hole ") + (Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : typeof x === "object" && x ? JSON.stringify(x) : String(x))).join(",") + ":" + Object.keys(list).join("");
const spreads = {
  behindText(a) { return ["t", ...a]; }, behindTexts(a) { return ["run", "--flag", ...a]; }, behindZero(a) { return [0, ...a]; }, behindWhole(a) { return [1, 2, 3, ...a]; }, behindFractions(a) { return [0.5, 1.5, ...a]; },
  behindMixed(a) { return [1, "two", null, undefined, true, 2.5, ...a]; }, behindNull(a) { return [null, ...a]; }, between(a) { return ["first", ...a, "last"]; }, twice(a) { return ["t", ...a, ...a]; }, betweenTwo(a) { return [0, ...a, 1, ...a, 2]; },
  behindMany(a) { return ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", ...a]; }, behindMinusZero(a) { return [-0, ...a]; }, behindNaN(a) { return [NaN, 1.5, ...a]; },
};
const named = name => spreads[[name][0]];
const long = []; for (let i = 0; i < 70; i++) long.push("w" + i);
const sources = {
  words: () => ["a", "b"], whole: () => [1, 2, 3], fractions: () => [1.5, 2.5], objects: () => [{ o: 1 }], none: () => [], one: () => ["x"], holey: () => ["a", , "c"], holeyNumbers: () => [1.5, , 2.5], long: () => long,
  set: () => new Set(["s", "t"]), text: () => "ab", generated: () => (function* () { yield 1; yield "two"; })(), typedArray: () => new Uint8Array([7, 8]), mixed: () => [1, "two", null],
};
for (let turn = 0; turn < 3; turn++) for (const form in spreads) for (const s in sources) lines.push(turn + " " + form + " " + s + " " + show(named(form)(sources[s]())));
for (const form in spreads) {
  const f = named(form), first = f(["a"]), second = f(["a"]);
  first[0] = "changed"; first.push("pushed"); first.length = 1;
  const third = f(["a"]);
  lines.push(form + " " + (first !== second) + " " + show(first) + " " + show(second) + " " + show(third) + " " + Array.isArray(third) + " " + (Object.getPrototypeOf(third) === Array.prototype));
}
lines.push((() => { try { return show(named("behindText")(5)); } catch (e) { return e.constructor.name; } })() + " " + (() => { try { return show(named("behindText")(undefined)); } catch (e) { return e.constructor.name; } })());
const forms = ["behindText", "behindTexts", "behindNull", "between", "twice", "behindMixed"].map(named);
for (let i = 0; i < 5; i++) for (const f of forms) f(sources.words());
const before = entered();
let sum = 0;
for (let i = 0; i < 2000; i++) for (const f of forms) sum += f(sources.words()).length + f(sources.objects()).length;
lines.push(sum + " " + (counted ? entered() - before < 100 : true));
console.log(lines.join("\n"));
