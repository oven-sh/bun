// `o.tag === "text"` where the value read is used for nothing else and the literal has one to eight ASCII characters is one call of a stub: the read and the comparison. Here: literals of every length from none to ten, both orders of the operands, `!==`, the answer branched on, returned and stored; values of every kind (the same text flat, as a rope, as a substring, in 16 bits, as a String object; another text of the same length; numbers, booleans, symbols, nothing); receivers of every kind (own in line and out of line, inherited, absent, getters whose runs are counted, proxies whose traps are logged, functions, arrays, primitives, null and undefined, whose errors keep their position); a receiver that changes its shape between the runs.
const lines = [];
const say = (...words) => lines.push(words.map(String).join(" "));
const tests = {
  one: o => (o.tag === "a" ? "yes" : "no"),
  two: o => (o.tag === "ab" ? "yes" : "no"),
  three: o => (o.tag === "abc" ? "yes" : "no"),
  four: o => (o.tag === "abcd" ? "yes" : "no"),
  five: o => (o.tag === "abcde" ? "yes" : "no"),
  six: o => (o.tag === "abcdef" ? "yes" : "no"),
  seven: o => (o.tag === "Success" ? "yes" : "no"),
  eight: o => (o.tag === "abcdefgh" ? "yes" : "no"),
  nine: o => (o.tag === "abcdefghi" ? "yes" : "no"),
  ten: o => (o.tag === "abcdefghij" ? "yes" : "no"),
  none: o => (o.tag === "" ? "yes" : "no"),
  reversed: o => ("abc" === o.tag ? "yes" : "no"),
  unequal: o => (o.tag !== "abc" ? "other" : "same"),
  returned: o => o.tag === "abc",
  stored: o => { const same = o.tag === "abc"; return [same, !same].join(); },
  statement: o => { if (o.tag === "abc") return "then"; return "behind"; },
  ladder: o => { if (o.tag === "a") return 1; else if (o.tag === "ab") return 2; else if (o.tag === "abc") return 3; return 0; },
  both: o => (o.tag === "abc" && o.kind === "k" ? "both" : "not both"),
  either: o => (o.tag === "abc" || o.kind === "k" ? "either" : "neither"),
  chained: o => (o.inner.tag === "abc" ? "yes" : "no"),
  usedAgain: o => { const tag = o.tag; return tag === "abc" ? tag : "no " + String(tag); },
  loose: o => (o.tag == "abc" ? "yes" : "no"),
  notAscii: o => (o.tag === "äbc" ? "yes" : "no"),
  inLoop: o => { let n = 0; for (let i = 0; i < 3; i++) if (o.tag === "abc") n++; return n; },
  underTry: o => { try { return o.tag === "abc" ? "yes" : "no"; } catch (error) { return "caught " + error.constructor.name; } },
};
const rope = text => { const half = text.length >> 1; return (lines.length >= 0 ? text.slice(0, half) : "") + text.slice(half); };
const texts = ["", "a", "ab", "abc", "abd", "abcd", "abcde", "abcdef", "Success", "Failure", "abcdefgh", "abcdefghi", "abcdefghij", "äbc", "ABC"];
const values = [...texts, ...texts.map(rope), ("xabcx").slice(1, 4), "abcĀ".slice(0, 3), new String("abc"), 0, 1.5, NaN, true, false, null, undefined, Symbol.for("abc"), 10n, {}, ["abc"], Math.max];
let gets = 0;
const log = [];
const wide = value => { const o = {}; for (let i = 0; i < 40; i++) o["p" + i] = i; o.tag = value; o.kind = "k"; o.inner = { tag: value }; return o; };
const receivers = {
  plain: value => ({ tag: value, kind: "k", inner: { tag: value } }),
  late: value => ({ kind: "k", inner: { tag: value }, x: 1, y: 2, tag: value }),
  wide,
  inherited: value => Object.create({ tag: value, kind: "k", inner: Object.create({ tag: value }) }),
  inheritedWide: value => Object.create(wide(value)),
  getter: value => ({ get tag() { gets++; return value; }, kind: "k", inner: { get tag() { gets++; return value; } } }),
  inheritedGetter: value => Object.create({ get tag() { gets++; return value; }, kind: "k", inner: { tag: value } }),
  proxy: value => new Proxy({ tag: value, kind: "k", inner: { tag: value } }, { get(target, key, receiver) { log.push(String(key)); return Reflect.get(target, key, receiver); } }),
  func: value => Object.assign(() => {}, { tag: value, kind: "k", inner: { tag: value } }),
  array: value => Object.assign([1, 2], { tag: value, kind: "k", inner: { tag: value } }),
  frozen: value => Object.freeze({ tag: value, kind: "k", inner: Object.freeze({ tag: value }) }),
  nullProto: value => Object.assign(Object.create(null), { tag: value, kind: "k", inner: { tag: value } }),
};
for (const [receiverName, make] of Object.entries(receivers)) {
  for (const [testName, test] of Object.entries(tests)) {
    const answers = [];
    for (const value of values) answers.push(String(test(make(value))));
    say(receiverName, testName, answers.join(" "));
  }
}
say("getters ran", gets, "traps", log.length, log.slice(0, 12).join());
const without = [{}, { kind: "k" }, Object.create(null), [], () => {}, "text", 7, 1.5, true, Symbol.iterator, 10n, new Map(), /x/];
for (const [testName, test] of Object.entries(tests)) {
  const answers = [];
  for (const receiver of without) { try { answers.push(String(test(receiver))); } catch (error) { answers.push(error.constructor.name); } }
  say("absent", testName, answers.join(" "));
}
const place = error => String(error.stack).split("\n").filter(line => line.includes("reads-compared-with-literals")).slice(0, 2).map(line => line.replace(/^.*reads-compared-with-literals[^:]*/, "").replace(")", "")).join(" < ");
for (const [testName, test] of Object.entries(tests)) {
  for (const nothing of [null, undefined]) {
    try { say("nothing", testName, test(nothing)); } catch (error) { say("nothing", testName, String(nothing), error.constructor.name, place(error)); }
  }
}
const throwing = { get tag() { throw new RangeError("from the getter"); }, inner: { get tag() { throw new RangeError("from the inner getter"); } } };
for (const [testName, test] of Object.entries(tests)) {
  try { say("throws", testName, test(throwing)); } catch (error) { say("throws", testName, error.message, place(error)); }
}
const changing = { tag: "abc" };
for (let i = 0; i < 8; i++) {
  say("changing", i, tests.three(changing), tests.unequal(changing), tests.ladder(changing));
  if (i === 0) changing.extra = 1;
  if (i === 1) changing.tag = "abd";
  if (i === 2) delete changing.tag;
  if (i === 3) Object.setPrototypeOf(changing, { tag: "abc" });
  if (i === 4) Object.defineProperty(changing, "tag", { get() { return "ab" + "c"; }, configurable: true });
  if (i === 5) Object.defineProperty(changing, "tag", { value: "abc", writable: false });
  if (i === 6) for (let k = 0; k < 70; k++) changing["q" + k] = k;
}
console.log(lines.join("\n"));
