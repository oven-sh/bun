// A pattern that is one literal text (`/%/`, `/bull/`) has no compiled code and is searched for as a string: `test`, `exec` and `match` on flat strings, substrings, ropes and 16-bit strings.
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
const names = ["operationAOTRegExpTest", "operationAOTRegExpTestBoxed", "operationAOTRegExpExec", "operationAOTStringMatchRegExp"];
const entries = () => names.reduce((sum, name) => sum + count(name), 0);
function legacy() {
  return [RegExp.lastMatch, RegExp.leftContext, RegExp.rightContext, RegExp.$1].map(part => JSON.stringify(part)).join();
}
function show(match: RegExpMatchArray | RegExpExecArray | null) {
  return match ? `${JSON.stringify(match)}@${match.index} of ${JSON.stringify(match.input)} ${match.length} ${match.groups}` : "null";
}
const subjects = ["", "%", "a%b", "100%", "%-%", "no sign", "a.b", "bull", "a bull in a bull pen", "bul", "caf\xe9 \xe9", "\u4e2d\u6587 % bull \xe9", "\u4e2d", "x".repeat(70) + "%" + "y".repeat(40) + "bull"];
const patterns = [/%/, /\./, /bull/, /\xe9/, /a bull/, /%-/, /l p/, /\u6587 %/, /\u4e2d/, /\$/, /%/u, /bull/v, /y{1}b/];
for (const pattern of patterns) {
  for (const subject of subjects) console.log("row", String(pattern), JSON.stringify(subject.slice(0, 24)), pattern.test(subject), legacy(), show(pattern.exec(subject)), show(subject.match(pattern)), pattern.lastIndex);
}
const url = "/users/a%20b/posts/12%2F3?x=%";
const pieces: string[] = [];
for (let from = 0; from < url.length; from += 5) pieces.push(`${/%/.test(url.slice(from, from + 7))} ${show(/%2/.exec(url.slice(from, from + 9)))} ${/%/.test(url.slice(from, from + 3) + url.slice(from + 3, from + 6))}`);
console.log("pieces", pieces.join(" | "));
const changed = /%/;
changed.lastIndex = 5;
console.log(changed.test("a%"), changed.lastIndex, show(changed.exec("%")), changed.lastIndex);
(changed as any).lastIndex = { valueOf() { console.log("asked"); return 1; } };
console.log(changed.test("a%"), typeof changed.lastIndex, show(changed.exec("a%")));

function decoded(value: string) {
  return /%/.test(value) ? decodeURIComponent(value) : value;
}
const before = entries();
let total = 0;
const values = ["12345678901", "a%20b", "plain-value", "x", "", "caf%C3%A9", "0123456789012345678901234567890123456789%41"];
for (let turn = 0; turn < 7000; turn++) {
  total += decoded(values[turn % values.length]).length;
  if (/bull/.exec(subjects[turn % subjects.length])) total++;
}
console.log(total, entries() - before < 2000 ? "few entries" : "MANY ENTRIES");
