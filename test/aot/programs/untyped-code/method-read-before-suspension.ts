// `x.m(await y)` and `x.m(yield y)`: the method is read before the function is suspended, and the receiver may be altered while it is.
const notes: string[] = [];
function wrapper(said: string, m: string, home: any): any { return function (this: any, ...all: any[]) { notes.push(said + " " + m); return home[m].apply(this, all); }; }
function later(v: any): Promise<any> { notes.push("awaits"); return new Promise(resolve => setTimeout(() => resolve(v), 0)); }
function pressure(): number { let n = 0; for (let i = 0; i < 2000; i++) n += [i, i + 1, { i }].length; return n; }
async function joinAwaited(x: any, sep: any): Promise<any> { const r = x.join(await later(sep)); return [r]; }
async function fillAwaited(x: any, v: any): Promise<any> { const r = x.fill(await later(v)); return [r]; }
async function startsWithAwaited(x: any, v: any): Promise<any> { const r = x.startsWith(await later(v)); return [r]; }
async function padStartAwaited(x: any, v: any): Promise<any> { const r = x.padStart(await later(v), "*"); return [r]; }
async function joinAwaitedInLoop(x: any, sep: any): Promise<any> { let r: any; for (let i = 0; i < 2; i++) r = x.join(await later(sep)); return [r]; }
async function joinAwaitedWatched(x: any, sep: any): Promise<any> { try { const r = x.join(await later(sep)); return [r]; } catch (e) { return "caught " + (e as Error).constructor.name; } }
async function typedSliceAwaited(x: number[], v: number): Promise<number> { const r = x.slice(await later(v)); return r.length; }
async function typedGetAwaited(x: Map<string, number>, v: string): Promise<number | undefined> { const r = x.get(await later(v)); return r; }
function* joinYielded(x: any): Generator<any, any, any> { const r = x.join(yield "wants a separator"); return [r]; }
function* fillYielded(x: any): Generator<any, any, any> { const r = x.fill(yield "wants a value"); return [r]; }
const lines: string[] = [];
const show = (v: unknown): string => JSON.stringify(v, (k, x) => x === undefined ? "undefined" : x instanceof Map ? [...Map.prototype.entries.call(x)] : x);
async function attempt(label: string, make: () => any, run: (x: any) => Promise<any>, alter: (x: any) => void): Promise<void> {
    notes.length = 0;
    const x = make();
    let said: string;
    try { const pending = run(x); alter(x); pressure(); said = show(await pending); } catch (e) { said = "THROWS " + (e as Error).constructor.name; }
    lines.push(label + " | " + said + " | " + notes.join(", ") + " | " + show(x));
}
const nothing = (x: any) => { };
const own = (m: string) => (x: any) => { notes.push("alters"); if (typeof x === "object" && x) x[m] = wrapper("its own", m, Object.getPrototypeOf(x)); };
const prototype = (m: string) => (x: any) => { notes.push("alters"); if (typeof x === "object" && x) { const home = Object.getPrototypeOf(x); const p = Object.create(home); p[m] = wrapper("inherited", m, home); Object.setPrototypeOf(x, p); } };
const withOwn = (make: () => any, m: string) => () => { const x = make(); x[m] = wrapper("its own from the start", m, Object.getPrototypeOf(x)); return x; };
const array = () => [1, 2, 3];
for (const [name, alter] of [["left alone", nothing], ["given its own", own("join")], ["given another prototype", prototype("join")]] as Array<[string, (x: any) => void]>) {
    await attempt("join awaited, " + name, array, x => joinAwaited(x, "-"), alter);
    await attempt("join awaited, its own from the start, " + name, withOwn(array, "join"), x => joinAwaited(x, "-"), alter);
    await attempt("join awaited in a loop, " + name, array, x => joinAwaitedInLoop(x, "-"), alter);
    await attempt("join awaited, watched, " + name, array, x => joinAwaitedWatched(x, "-"), alter);
    await attempt("join awaited, watched, undefined, " + name, () => undefined, x => joinAwaitedWatched(x, "-"), alter);
    await attempt("join awaited, another object, " + name, () => ({ join(s: string) { notes.push("another's join"); return "joined by " + s; } }), x => joinAwaited(x, "-"), alter);
}
for (const [name, alter] of [["left alone", nothing], ["given its own", own("fill")], ["given another prototype", prototype("fill")]] as Array<[string, (x: any) => void]>)
    await attempt("fill awaited, " + name, array, x => fillAwaited(x, 7), alter);
await attempt("startsWith awaited", () => "abc", x => startsWithAwaited(x, "a"), nothing);
await attempt("padStart awaited", () => "abc", x => padStartAwaited(x, 6), nothing);
await attempt("startsWith awaited, null", () => null, x => startsWithAwaited(x, "a"), nothing);
for (const [name, alter] of [["left alone", nothing], ["given its own", own("slice")], ["given another prototype", prototype("slice")]] as Array<[string, (x: any) => void]>)
    await attempt("typed slice awaited, " + name, array, x => typedSliceAwaited(x, 1), alter);
for (const [name, alter] of [["left alone", nothing], ["given its own", own("get")], ["given another prototype", prototype("get")]] as Array<[string, (x: any) => void]>)
    await attempt("typed get awaited, " + name, () => new Map([["a", 1]]), x => typedGetAwaited(x, "a"), alter);
for (const [name, alter] of [["left alone", nothing], ["given its own", own("join")], ["given another prototype", prototype("join")]] as Array<[string, (x: any) => void]>) {
    notes.length = 0;
    const x = array();
    const steps = joinYielded(x);
    const first = steps.next();
    alter(x); pressure();
    lines.push("join yielded, " + name + " | " + show(first) + " | " + show(steps.next("+")) + " | " + notes.join(", "));
}
for (const [name, alter] of [["left alone", nothing], ["given its own", own("fill")]] as Array<[string, (x: any) => void]>) {
    notes.length = 0;
    const x = array();
    const steps = fillYielded(x);
    const first = steps.next();
    alter(x); pressure();
    lines.push("fill yielded, " + name + " | " + show(first) + " | " + show(steps.next(9)) + " | " + notes.join(", "));
}
console.log(lines.join("\n"));
