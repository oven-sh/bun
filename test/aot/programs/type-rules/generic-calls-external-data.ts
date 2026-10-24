// A type argument that is only inferred from an argument says nothing about external data: what a generic function returns, and what it hands to a callback, must behave as in plain JavaScript.
const data = JSON.parse('{"t":"abc"}') as { t: number };
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + String(v); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
const same = <V,>(v: V): V => v;
const first = <V,>(...all: V[]): V => all[0];
const second = <A, B>(a: A, b: B): B => b;
const run = <V,>(v: V, k: (v: V) => V): V => k(v);
const apply = <V, R>(v: V, k: (v: V) => R): R => k(v);
function pick<V>(list: V[], at: number): V { return list[at]; }
say("identity", () => same(data.t) + 1);
say("a rest parameter", () => first(data.t) + 1);
say("the second of two", () => second(1, data.t) + 1);
say("a callback's parameter", () => run(data.t, v => v) + 1);
say("used inside the callback", () => apply(data.t, v => v + 1));
say("out of a list", () => pick([data.t], 0) + 1);
say("into a variable", () => { let n = 0; n = first(data.t); return n + 1; });
say("added to a variable", () => { let n = 0; n += second("x", data.t); return n; });
say("trusted arguments stay exact", () => same(1) + first(2) + second("x", 3) + run(4, v => v + 1) + pick([5], 0));
