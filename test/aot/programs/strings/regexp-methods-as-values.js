// RegExp.prototype.exec and test kept in constants and called on a receiver, as Node's and Bun's own modules do (`RegExpPrototypeExec.call(pattern, value)`): with strings, with what is made a string of, with what cannot be, on what is no RegExp, on patterns that remember where they stopped, on an heir, on a pattern with an `exec` of its own.
const exec = RegExp.prototype.exec;
const test = RegExp.prototype.test;
const lines = [];
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
const show = match => (match === null ? "null" : typeof match === "string" ? match : JSON.stringify([...match]) + "@" + match.index + (match.groups ? JSON.stringify(match.groups) : ""));
const invalid = /[^\t\x20-\x7e\x80-\xff]/;
function isInvalid(value) { return exec.call(invalid, value) !== null; }
function holds(pattern, value) { return test.call(pattern, value); }
function find(pattern, value) { return exec.call(pattern, value); }

const headers = ["text/html; charset=utf-8", "keep-alive", "a\u0001b", "", "é", "Ā", "x".repeat(300) + "\n"];
let count = 0;
for (let round = 0; round < 3000; round++) count += isInvalid(headers[round % headers.length]) ? 1 : 0;
lines.push("invalid " + count + " " + headers.map(isInvalid).join());

const log = [];
const values = [undefined, null, 0, -0, 12.5, true, 10n, [], ["a", "b"], {}, { toString() { log.push("toString"); return "made"; } }, { valueOf() { log.push("valueOf"); return "no"; }, toString: undefined }, new String("boxed"), Symbol("s"), Object.create(null)];
for (const value of values) lines.push([typeof value, attempt(() => show(find(/(?<first>[a-z0-9])[a-z]*/, value))), attempt(() => holds(/^[a-z]+$/, value)), attempt(() => isInvalid(value))].join(" "));
lines.push(log.join());

for (const receiver of [undefined, null, "a", 1, {}, [], () => 1, { exec() { return "own"; } }, RegExp.prototype, Object.create(/a/)]) lines.push(attempt(() => show(find(receiver, "a"))) + " " + attempt(() => holds(receiver, "a")));

const global = /a./g;
const sticky = /a./y;
for (let step = 0; step < 4; step++) lines.push(show(find(global, "abacad")) + " " + global.lastIndex + " | " + show(find(sticky, "abacxad")) + " " + sticky.lastIndex + " | " + holds(global, "abacad") + " " + global.lastIndex);
global.lastIndex = { valueOf() { log.push("lastIndex"); return 2; } };
lines.push(show(find(global, "abacad")) + " " + global.lastIndex + " " + log.splice(0).join());
const fixed = Object.freeze(/a/g);
lines.push(attempt(() => show(find(fixed, "aa"))) + " " + attempt(() => holds(fixed, "b")));

class Heir extends RegExp { exec(text) { log.push("the heir's exec"); return super.exec(text); } }
const heir = new Heir("b+", "d");
lines.push(show(find(heir, "abbc")) + " " + holds(heir, "abbc") + " " + log.splice(0).join() + " " + JSON.stringify(find(heir, "abbc").indices));
const patched = /c/;
patched.exec = () => { log.push("its own exec"); return null; };
lines.push(show(find(patched, "abc")) + " " + holds(patched, "abc") + " " + log.splice(0).join());
const extended = /d/;
extended.note = 1;
lines.push(show(find(extended, "abcd")) + " " + holds(extended, "abcd"));
lines.push(show(find(/(\d+)-(?<rest>\w+)?/u, "no 12-ab")) + " " + RegExp.$1 + " " + RegExp.lastMatch + " " + RegExp["$`"]);
lines.push(show(exec.call(/x/, "rope" + headers[1] + "x")) + " " + show(exec.apply(/y/, ["xyz"])) + " " + show(Reflect.apply(exec, /z/, ["xyz"])) + " " + attempt(() => show(exec.call(/u/))) + " " + attempt(() => show(exec.call(/a/, "a", "more"))));
console.log(lines.join("\n"));
