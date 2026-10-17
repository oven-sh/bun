// Functions made at run time make empty arrays, very many of them, across collections, and what is done with them afterwards differs from site to site and from turn to turn.
const lines = [];
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const empty = new Function("return [];");
const pair = new Function("return [[], []];");
const inObject = new Function("v", "return { value: v, issues: [] };");
const ofIntegers = new Function("n", "const made = []; for (let i = 0; i < n; i++) made.push(i); return made;");
const ofDoubles = new Function("n", "const made = []; for (let i = 0; i < n; i++) made.push(i + 0.5); return made;");
const ofObjects = new Function("n", "const made = []; for (let i = 0; i < n; i++) made.push({ i }); return made;");
const ofAnything = new Function("turn", "const made = []; made.push(turn % 4 === 0 ? 1 : turn % 4 === 1 ? 1.5 : turn % 4 === 2 ? 'text' : { turn }); return made;");
const sparse = new Function("at", "const made = []; made[at] = at; return made;");
const resized = new Function("n", "const made = []; made.length = n; return made;");
const named = new Function("const made = []; made.name = 'own'; return made;");
const frozen = new Function("return Object.freeze([]);");

const first = empty();
lines.push([Array.isArray(first), first.length, JSON.stringify(first), Object.getPrototypeOf(first) === Array.prototype, Object.keys(first).length, 0 in first, first[0], String(first) === "", empty() === empty(), Object.isExtensible(first)].join(" "));
lines.push(JSON.stringify(pair()) + " " + (pair()[0] === pair()[1]) + " " + JSON.stringify(inObject(1)));
for (const n of [0, 1, 4, 5, 6, 7, 20, 1000]) lines.push(n + ": " + [ofIntegers, ofDoubles, ofObjects].map(make => { const made = make(n); return made.length + "/" + JSON.stringify(made[n - 1]) + "/" + (n in made); }).join(" "));
for (const at of [0, 4, 5, 6, 100, 100000, 4294967294]) { const made = sparse(at); lines.push("sparse " + at + ": " + made.length + " " + made[at] + " " + (0 in made) + " " + Object.keys(made)); }
for (const n of [0, 1, 5, 6, 100000]) { const made = resized(n); lines.push("resized " + n + ": " + made.length + " " + (0 in made) + " " + made.indexOf(undefined) + " " + made.includes(undefined)); }
lines.push(named().name + " " + named().length + " " + Object.keys(named()) + " " + Object.isFrozen(frozen()) + " " + frozen().length);
try { "use strict"; frozen().push(1); lines.push("pushed"); } catch (error) { lines.push(error.name); }

let sum = 0;
const kept = [];
for (let turn = 0; turn < 300000; turn++) {
  const made = empty();
  if (made.length !== 0 || 0 in made || made[0] !== undefined || made[4] !== undefined) sum += 1000000;
  if (turn % 3 === 0) made.push(turn);
  else if (turn % 3 === 1) made.push(turn + 0.25, "text");
  sum += made.length;
  if (turn % 1000 === 0) kept.push(made);
  if (turn % 50000 === 0) collect();
}
collect();
lines.push("many: " + sum + " " + kept.length + " " + kept.reduce((total, made) => total + made.length + (made[0] | 0), 0));

let mixed = "";
for (let turn = 0; turn < 100000; turn++) {
  const made = ofAnything(turn);
  if (turn < 8 || turn > 99995) mixed += JSON.stringify(made);
  if (made.length !== 1) mixed += "WRONG";
}
lines.push("one site, four kinds: " + mixed);

let issues = 0;
for (let turn = 0; turn < 100000; turn++) {
  const payload = inObject(turn);
  if (turn % 7 === 0) payload.issues.push({ code: "bad", path: [] });
  issues += payload.issues.length + (payload.issues[0]?.path.length ?? 0);
}
lines.push("issues: " + issues);
console.log(lines.join("\n"));
