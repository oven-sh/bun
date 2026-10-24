// In `a.m(f())` the method is read before the arguments are evaluated, so a call to `f` that replaces `a.m` does not change what is called.
declare const console: { log(...values: unknown[]): void };
const out: string[] = [];
const hide = (v: unknown): any => v;
let entered = 0;
function replacement(this: unknown): unknown { entered++; return "replaced"; }
type Change = (a: any, name: string) => void;
const changes: [string, Change][] = [
    ["own property", (a, name) => { a[name] = replacement; }],
    ["another prototype", (a, name) => { const p = Object.create(Array.prototype); p[name] = replacement; Object.setPrototypeOf(a, p); }],
    ["a property that overrides nothing", a => { a.extra = 1; }],
];
let change: Change = () => {}; let changedName = "";
function during<T>(a: unknown, value: T): T { change(a, changedName); return value; }
const show = (v: unknown): string => Array.isArray(v) ? "[" + Array.prototype.join.call(v) + "]" : typeof v === "object" && v !== null ? "object" : String(v);
const onAny: [string, (a: any) => unknown][] = [
    ["push", a => a.push(during(a, 9))], ["unshift", a => a.unshift(during(a, 9))], ["slice", a => a.slice(during(a, 1))], ["splice", a => a.splice(during(a, 0), 1)],
    ["concat", a => a.concat(during(a, [9]))], ["join", a => a.join(during(a, "-"))], ["indexOf", a => a.indexOf(during(a, 2))], ["lastIndexOf", a => a.lastIndexOf(during(a, 2))],
    ["includes", a => a.includes(during(a, 2))], ["fill", a => a.fill(during(a, 9))], ["at", a => a.at(during(a, 1))], ["map", a => a.map(during(a, (x: number) => x + 1))],
    ["filter", a => a.filter(during(a, (x: number) => x > 1))], ["forEach", a => a.forEach(during(a, () => {}))], ["some", a => a.some(during(a, (x: number) => x > 1))],
    ["every", a => a.every(during(a, (x: number) => x > 1))], ["find", a => a.find(during(a, (x: number) => x > 1))], ["findIndex", a => a.findIndex(during(a, (x: number) => x > 1))],
    ["reduce", a => a.reduce(during(a, (s: number, x: number) => s + x), 0)], ["sort", a => a.sort(during(a, (x: number, y: number) => y - x))], ["flatMap", a => a.flatMap(during(a, (x: number) => [x]))], ["with", a => a.with(during(a, 0), 9)],
];
const onTyped: [string, (a: number[]) => unknown][] = [
    ["push", a => a.push(during(a, 9))], ["unshift", a => a.unshift(during(a, 9))], ["slice", a => a.slice(during(a, 1))], ["splice", a => a.splice(during(a, 0), 1)],
    ["concat", a => a.concat(during(a, [9]))], ["join", a => a.join(during(a, "-"))], ["indexOf", a => a.indexOf(during(a, 2))], ["lastIndexOf", a => a.lastIndexOf(during(a, 2))],
    ["includes", a => a.includes(during(a, 2))], ["fill", a => a.fill(during(a, 9))], ["at", a => a.at(during(a, 1))], ["map", a => a.map(during(a, (x: number) => x + 1))],
    ["filter", a => a.filter(during(a, (x: number) => x > 1))], ["forEach", a => a.forEach(during(a, () => {}))], ["some", a => a.some(during(a, (x: number) => x > 1))],
    ["every", a => a.every(during(a, (x: number) => x > 1))], ["find", a => a.find(during(a, (x: number) => x > 1))], ["findIndex", a => a.findIndex(during(a, (x: number) => x > 1))],
    ["reduce", a => a.reduce(during(a, (s: number, x: number) => s + x), 0)], ["sort", a => a.sort(during(a, (x: number, y: number) => y - x))], ["flatMap", a => a.flatMap(during(a, (x: number) => [x]))], ["with", a => a.with(during(a, 0), 9)],
];
function run(call: (a: any) => unknown, name: string, how: Change): string {
    const a = [1, 2, 3]; change = how; changedName = name; entered = 0;
    let r: string; try { r = show(call(a)); } catch (e) { r = (e as Error).name; }
    change = () => {};
    return r + " " + show(a) + " " + entered;
}
for (const [name, call] of onAny) out.push("any " + name + ": " + changes.map(([how, c]) => how + ": " + run(call, name, c)).join(" | "));
for (const [name, call] of onTyped) out.push("number[] " + name + ": " + changes.map(([how, c]) => how + ": " + run(hide(call), name, c)).join(" | "));
// A receiver typed `any`: an override that is there from the start runs.
for (const [name, call] of onAny) out.push("any, overridden from the start, " + name + ": " + changes.slice(0, 2).map(([how, c]) => { const a = [1, 2, 3]; c(a, name); entered = 0; change = () => {}; let r: string; try { r = show(call(a)); } catch (e) { r = (e as Error).name; } return how + ": " + r + " " + entered; }).join(" | "));
{ const a: any = [1, 2, 3, 4]; a.length = 1; a.push = replacement; entered = 0; out.push("any, room and its own push: " + show(a.push(3)) + " " + show(a) + " " + entered); }
// The arguments take an override away again: what was read is called.
for (const [name, call] of onAny) { const a: any = [1, 2, 3]; a[name] = replacement; change = (x, n) => { delete x[n]; }; changedName = name; entered = 0; let r: string; try { r = show(call(a)); } catch (e) { r = (e as Error).name; } change = () => {}; out.push("any, the override deleted by the arguments, " + name + ": " + r + " " + entered); }
console.log(out.join("\n"));
