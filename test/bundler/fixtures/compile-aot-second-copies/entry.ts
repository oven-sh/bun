import { Item, member, stranger, readsAll, sums, around, spins, passes, counters } from "./shapes.ts";
import { Worker, isMainThread } from "node:worker_threads";
const out: string[] = [];
const say = (what: string, value: any) => out.push(what + ": " + value);
const clean = (stack: any) => { const lines = String(stack).split("\n").map(l => l.trim()); const end = lines.findIndex(l => l.startsWith("at main (")); return lines.slice(0, end < 0 ? lines.length : end).join(" | "); };
function attempt(f: any, ...args: any[]) { try { return "returned " + f(...args); } catch (e: any) { return e.message + " stack " + clean(e.stack); } }

function throwsItself(o: any, when: number) {
    const a = o.tag;
    if (when === 1) throw new Error("one");
    const b = o.key;
    if (when === 2) throw new Error("two");
    const c = o.child;
    if (when === 3) throw new Error("three");
    return a + b + c;
}
function fails(when: number, position: number) { if (when === position) { for (let i = 0; i < 1; ++i) { } throw new Error("callee at " + position); } return position; }
function callsOut(o: any, when: number) {
    const a = o.tag; fails(when, 1);
    const b = o.key; fails(when, 2); const c = o.child; fails(when, 3);
    return a + b + c;
}
function small(when: number, position: number) { if (when === position) throw new Error("inlined at " + position); return position; }
function inlines(o: any, when: number) {
    const a = o.tag; small(when, 1);
    const b = o.key; small(when, 2);
    const c = o.child; small(when, 3);
    return a + b + c;
}
function catchesItself(o: any, when: number) {
    let seen = "nothing";
    try {
        const a = o.tag; fails(when, 1);
        const b = o.key; if (when === 2) throw new Error("own two");
        const c = o.child; small(when, 3);
        seen = a + b + c;
    } catch (e: any) {
        seen = e.message + " stack " + clean(e.stack) + " then " + o.child;
    } finally {
        seen += " finally " + o.key;
    }
    return seen;
}
function typeErrors(o: any, when: number) {
    const a = o.tag;
    if (when === 1) a.nothing.more;
    const b = o.key;
    if (when === 2) b();
    const c = o.child;
    if (when === 3) (null as any).x;
    if (when === 4) (globalThis as any).missing.deep(a, b);
    if (when === 5) new (c as any)();
    return a + b + c;
}
function captures(o: any, when: number) {
    const a = o.tag; const holder: any = { };
    if (when === 1) Error.captureStackTrace(holder);
    const b = o.key;
    if (when === 2) Error.captureStackTrace(holder, captures);
    const c = o.child;
    if (when === 3) Error.captureStackTrace(holder);
    return a + b + c + " " + clean(holder.stack);
}
function sites(o: any, when: number) {
    const a = o.tag; let e: any;
    if (when === 1) e = new Error("sites one");
    const b = o.key;
    if (when === 2) e = new Error("sites two");
    const previous = (Error as any).prepareStackTrace;
    (Error as any).prepareStackTrace = (_: any, list: any[]) => list.slice(0, 3).map(s => [s.getFunctionName(), s.getLineNumber(), s.getColumnNumber(), s.isNative(), s.isToplevel(), s.isConstructor(), typeof s.getFunction?.(), String(s.getFileName()).split("/").pop()].join(",")).join(" / ");
    const text = e.stack;
    (Error as any).prepareStackTrace = previous;
    return a + b + o.child + " " + text;
}
function callsHost(o: any, when: number) {
    const a = o.tag;
    const x = [1, 2].map(v => { if (when === 1) throw new Error("callback one"); return v; });
    const b = o.key;
    const y = "ab".replace(/a/, () => { if (when === 2) throw new Error("callback two"); return "z"; });
    const z = JSON.parse("[1]", () => { if (when === 3) throw new Error("reviver"); return 1; });
    return a + b + o.child + x + y + z;
}
const withGetter = { get bad(): any { throw new Error("getter"); } };
function readsGetter(o: any, when: number) {
    const a = o.tag;
    const x = when === 1 ? withGetter.bad : 0;
    const b = o.key;
    const y = when === 2 ? withGetter.bad : 0;
    return a + b + o.child + x + y;
}
const trapped = new Proxy(member(), { get(target: any, name: any) { if (name === "child") throw new Error("trap " + String(name)); return target[name]; } });
async function awaits(o: any, when: number) { await 0; return throwsItself(o, when); }
async function outer(o: any, when: number) { const v = await awaits(o, when); return v + "!"; }
function inspected(o: any, when: number) { try { typeErrors(o, when); return "nothing"; } catch (e) { const lines = Bun.inspect(e, { colors: false }).split("\n").map(l => l.trim()); return clean(lines.slice(lines.findIndex(l => l.startsWith("TypeError: "))).join("\n")); } }

async function main() {
    for (const [name, make] of [["member", member], ["stranger", stranger]] as const) {
        for (let round = 0; round < 2; ++round) {
            for (const when of [0, 1, 2, 3])
                for (const f of [throwsItself, callsOut, inlines, catchesItself, callsHost, readsGetter, captures]) say(f.name + " " + name + " " + when, attempt(f, make(), when));
            for (const when of [1, 2]) say("sites " + name + " " + when, attempt(sites, make(), when));
            for (const when of [1, 2, 3, 4, 5]) { say("typeErrors " + name + " " + when, attempt(typeErrors, make(), when)); say("inspected " + name + " " + when, inspected(make(), when)); }
            for (const when of [2, 3]) say("outer " + name + " " + when, await outer(make(), when).then(v => "returned " + v, e => e.message + " stack " + clean(e.stack)));
        }
    }
    say("proxy", attempt(readsAll, trapped));
    for (const f of [throwsItself, callsOut, catchesItself, readsAll, Item]) say("function " + f.name, [f.name, f.length, Object.getOwnPropertyNames(f).join("+")].join(" ; "));
    console.log(out.join("\n"));
}
async function workers() {
    const start = (name: string) => new Promise<Worker>(resolve => { const w = new Worker("./worker.ts", { workerData: name }); w.once("message", () => resolve(w)); });
    const ask = (w: Worker, what: string) => new Promise<string>(resolve => { w.once("message", (m: string) => resolve(m)); w.postMessage(what); });
    const here = (what: string) => { let answer = ""; if (what === "sum" || what === "around") { const list = []; for (let i = 0; i < 50; ++i) list.push(member()); answer = String((what === "sum" ? sums : around)(list)); } else { const o = member(); delete o.key; o.key = "K"; answer = readsAll(o) + " " + Object.keys(o).join(); } Bun.gc(true); return "main " + what + ": " + answer + counters(); };
    const a = await start("A"), b = await start("B");
    for (const what of ["sum", "around"]) { console.log(here(what)); console.log(await ask(a, what)); console.log(await ask(b, what)); }
    console.log(await ask(a, "depart"));
    for (const what of ["sum", "around"]) { console.log(await ask(a, what)); console.log(await ask(b, what)); console.log(here(what)); }
    const c = await start("C"); console.log(await ask(c, "around")); console.log(await ask(c, "stranger"));
    console.log(here("depart"));
    for (const what of ["around"]) { console.log(here(what)); console.log(await ask(b, what)); console.log(await ask(c, what)); }
    const d = await start("D"); console.log(await ask(d, "around"));
    for (const w of [a, b, c, d]) await w.terminate();
}
if (process.argv.includes("--spin")) { console.log(spins(process.argv.includes("--stranger") ? stranger() : member(), 4e7, passes)); process.exit(0); }
if (process.argv.includes("--workers")) { await workers(); process.exit(0); }
await main();
Bun.gc(true);
if (process.env.BUN_JSC_aotTypeCoverageCountsPath) console.error("COUNTERS" + counters());
if (process.argv.includes("--uncaught")) typeErrors(process.argv.includes("--stranger") ? stranger() : member(), Number(process.argv.at(-1)));
