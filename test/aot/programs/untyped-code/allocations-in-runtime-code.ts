// Evaluated text creates objects and arrays from literals, many times at one site, and compiled code uses them.
function hide(value: unknown): any { return value; }
const make = (parameters: string, body: string) => new Function(...parameters.split(",").filter(Boolean), body) as (...a: any[]) => any;
let line = 0;
function show(title: string, ...values: unknown[]) { console.log(String(++line).padStart(2, "0"), title + ":", values.map(v => typeof v === "string" ? v : JSON.stringify(v) ?? String(v)).join(" | ")); }
const describe = (o: object) => (Array.isArray(o) ? "array(" + o.length + ") " : "") + Reflect.ownKeys(o).map(key => String(key) + "=" + JSON.stringify(hide(o)[key])).join();
interface Result { value: unknown; issues: unknown[] }
function sumOfIssues(results: Result[]): number { let total = 0; for (const result of results) total += result.issues.length + (typeof result.value === "number" ? result.value : 0); return total; }

{
  const empty = make("", "return {};"), one = make("a", "return { a };"), pair = make("v", "return { value: v, issues: [] };");
  show("literals", describe(empty()), describe(one(1)), describe(pair("x")), Object.getPrototypeOf(empty()) === Object.prototype, Object.isExtensible(empty()), empty() !== empty());
  const names = Array.from({ length: 70 }, (_, i) => "p" + i);
  for (const count of [1, 2, 5, 6, 7, 8, 20, 63, 64, 65, 70]) {
    const wide = make("", "return { " + names.slice(0, count).map((name, i) => name + ": " + i).join(", ") + " };");
    let last: any; for (let i = 0; i < 4; i++) last = wide();
    show(count + " properties", Object.keys(last).length, last["p" + (count - 1)], Object.values(last).reduce((a: number, b) => a + (b as number), 0));
  }
  show("other literals", describe(make("", "return { __proto__: null, a: 1 };")()), Object.getPrototypeOf(make("", "return { __proto__: null };")()), describe(make("k", "return { [k]: 1, 5: 2, get g() { return 3; } };")("key")), describe(make("", "return { a: { b: { c: [] } } };")()));
  const grown = empty(); for (let i = 0; i < 30; i++) grown["k" + i] = i;
  show("an empty literal gets many properties", Object.keys(grown).length, grown.k29, describe(empty()));
}
{
  const empty = make("", "return [];");
  show("an empty array", describe(empty()), empty().length, 0 in empty(), Array.isArray(empty()), Object.getPrototypeOf(empty()) === Array.prototype, empty() !== empty());
  const filled = make("values", "const out = []; for (let i = 0; i < values.length; i++) out.push(values[i]); return out;");
  // One site whose arrays hold nothing, then integers, fractions, anything, and holes.
  for (const values of [[], [1, 2], [], [1.5, 2], [1, 2], [], ["s", {}], [1], [1.5], [], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]) show("filled with " + JSON.stringify(values), describe(filled(values)));
  const sparse = make("at", "const out = []; out[at] = 1; return out;");
  show("holes", ...[0, 1, 4, 5, 6, 100, 100000].map(at => { const a = sparse(at); return a.length + ":" + Object.keys(a).join() + ":" + String(a[0]); }), describe(sparse(0)));
  const sized = make("n", "const out = []; out.length = n; return out;");
  show("lengths", ...[0, 1, 5, 6, 1000, 4294967295].map(n => sized(n).length + ":" + Object.keys(sized(n)).length));
  show("other literals", describe(make("a,b", "return [a, b];")(1, "x")), describe(make("", "return [1, 2, 3];")()), describe(make("", "return [1.5, , 3];")()), describe(make("a", "return [...a, ...a];")([1, 2])), describe(make("", "return [[], [[]]];")()));
  for (let count = 1; count <= 12; count++) {
    const parameters = Array.from({ length: count }, (_, i) => "e" + i).join();
    const literal = make(parameters, "return [" + parameters + "];");
    const integers = Array.from({ length: count }, (_, i) => i * 3), mixed = integers.map((v, i) => i === count - 1 ? "last" : i % 3 === 1 ? { v } : v), fractions = integers.map(v => v + 0.5);
    const rounds: string[] = [];
    // The site sees integers, then integers with another value at the end, then fractions, then integers.
    for (const values of [integers, integers, integers, mixed, mixed, integers, fractions, integers]) { const a = literal(...values); a.push("pushed"); rounds.push(JSON.stringify(a) === JSON.stringify([...values, "pushed"]) && a.length === count + 1 && !(count + 1 in a) ? "same" : describe(a)); }
    show("a literal of " + count, [...new Set(rounds)].join());
    const numbers = make(parameters, "return [" + parameters + "];");
    for (const values of [integers, integers, fractions, fractions, integers.map((v, i) => i ? v : NaN), integers, integers.map((v, i) => i ? v : -0)]) { const a = numbers(...values); if (!values.every((v, i) => Object.is(a[i], v)) || a.length !== count) show("DIFFERENT", describe(a)); }
  }
  show("elements that are no values of their own", describe(make("a", "return [a, a, undefined, null, , a];")({})), describe(make("", "return [this === undefined, typeof arguments, new.target];")()));
  show("named properties and freezing", describe(Object.assign(empty(), { named: 1 })), Object.isFrozen(Object.freeze(empty())), describe(empty()));
  const doubles = make("", "const out = []; out.push(0.5); return out;"); for (let i = 0; i < 6; i++) doubles();
  const afterDoubles = make("n", "const out = []; if (n) out.push(0.5); return out;"); for (let i = 0; i < 6; i++) afterDoubles(1);
  const stillEmpty = afterDoubles(0);
  show("an empty array of a site that holds fractions", describe(stillEmpty), 0 in stillEmpty, String(stillEmpty[0]), String(stillEmpty[4]), (stillEmpty.push("s"), describe(stillEmpty)), (hide(afterDoubles(0))[3] = 1, "stored"));
}
{
  // Compiled code reads and changes what the text created.
  const pair = make("v", "return { value: v, issues: [] };");
  const results: Result[] = []; for (let i = 0; i < 100; i++) results.push(pair(i));
  show("read by compiled code", sumOfIssues(results));
  for (const result of results) { result.issues.push(result.value); result.value = null; }
  show("changed by compiled code", sumOfIssues(results), describe(results[99]!), JSON.stringify(results[0]), Object.keys(results[1]!).join());
  show("and read by the text", make("results", "let t = 0; for (const r of results) t += r.issues[0] + (r.value === null ? 1 : 0); return t;")(results));
}
{
  // Memory that was used before comes back empty.
  const pair = make("i", "return { a: i, b: [], c: {} };"), bare = make("", "return [{}, []];");
  let total = 0;
  for (let round = 0; round < 12; round++) {
    const kept: any[] = [];
    for (let i = 0; i < 20000; i++) {
      const o = pair(i); o.b.push(i, i + 0.5, "s", o); o.c.x = o.b; o.d = i;
      if (i % 64 === 0) kept.push(o);
    }
    Bun.gc(round % 3 === 0);
    for (let i = 0; i < 2000; i++) { const [o, a] = bare(); total += Object.keys(o).length + a.length + (0 in a ? 1 : 0) + (a[0] === undefined ? 0 : 1) + ("x" in o ? 1 : 0); }
    for (const o of kept) total += o.b.length === 4 && o.b[3] === o && o.c.x === o.b && o.d === o.a ? 0 : 1;
  }
  show("nothing is left of earlier objects", total);
}
{
  // Old objects get new ones.
  const holders: any[] = []; for (let i = 0; i < 300; i++) holders.push({ held: null, list: null });
  Bun.gc(true);
  const fill = make("holders,round", "for (let i = 0; i < holders.length; i++) { holders[i].held = { round, i }; holders[i].list = []; holders[i].list.push({ i }); }");
  let total = 0;
  for (let round = 0; round < 30; round++) { fill(holders, round); if (round % 4 === 0) Bun.gc(round % 8 === 0); for (let i = 0; i < holders.length; i++) total += holders[i].held.round + holders[i].held.i + holders[i].list[0].i; }
  show("new objects in old ones", total);
}
