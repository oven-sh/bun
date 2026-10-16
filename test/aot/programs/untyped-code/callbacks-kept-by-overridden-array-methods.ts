const lines: string[] = [];
const kept: any[] = [];
function keeper(): any {
    const keep = function (this: any, f: any, ...rest: any[]) { kept.push(f); return rest.length ? ["kept", ...rest] : ["kept"]; };
    return { map: keep, filter: keep, find: keep, flatMap: keep, reduce: keep, findLast: keep, toSorted: keep, sort: keep, some: keep, every: keep, forEach: keep, findIndex: keep };
}
function scribble(depth: number, seed: number): number {
    const a = seed * 3 + 1, b = a ^ 0x5555, c = b + depth, d = c * 7, e = d - a, f = e | 1;
    return depth ? scribble(depth - 1, f & 0xffff) + ((a + b + c + d + e + f) & 1) : f & 1;
}
function churn(): void {
    let junk: any[] = [];
    for (let i = 0; i < 20000; i++)
        junk.push({ i, text: "t" + i, list: [i, i + 1] });
    junk = [];
}

function mapNone(x: any): any { return x.map((v: any) => v + 1); }
function mapNoneHeld(x: any): any { const r = x.map((v: any) => v + 1); return r; }
function mapOne(x: any, k: any): any { return x.map((v: any) => v + k); }
function mapOneHeld(x: any, k: any): any { const r = x.map((v: any) => v + k); return r; }
function mapTwo(x: any, k: any, m: any): any { return x.map((v: any) => v * k + m); }
function mapTwoHeld(x: any, k: any, m: any): any { const r = x.map((v: any) => v * k + m); return r; }
function mapFour(x: any, a: any, b: any, c: any, d: any): any { return x.map((v: any) => [v, a, b, c, d].join("/")); }
function mapFourHeld(x: any, a: any, b: any, c: any, d: any): any { const r = x.map((v: any) => [v, a, b, c, d].join("/")); return r; }
function mapObject(x: any, o: any): any { return x.map((v: any) => o.name + v); }
function mapObjectHeld(x: any, o: any): any { const r = x.map((v: any) => o.name + v); return r; }
function mapWithThisArgument(x: any, k: any, self: any): any { return x.map(function (this: any, v: any) { return v + k + (this ? this.extra : 0); }, self); }
function mapWithThisArgumentHeld(x: any, k: any, self: any): any { const r = x.map(function (this: any, v: any) { return v + k + (this ? this.extra : 0); }, self); return r; }
function filterOne(x: any, k: any): any { return x.filter((v: any) => v > k); }
function filterOneHeld(x: any, k: any): any { const r = x.filter((v: any) => v > k); return r; }
function findOne(x: any, k: any): any { return x.find((v: any) => v === k); }
function findOneHeld(x: any, k: any): any { const r = x.find((v: any) => v === k); return r; }
function flatMapOne(x: any, k: any): any { return x.flatMap((v: any) => [v, k]); }
function flatMapOneHeld(x: any, k: any): any { const r = x.flatMap((v: any) => [v, k]); return r; }
function reduceOne(x: any, k: any): any { return x.reduce((sum: any, v: any) => sum + v * k, 0); }
function reduceOneHeld(x: any, k: any): any { const r = x.reduce((sum: any, v: any) => sum + v * k, 0); return r; }
function someOne(x: any, k: any): any { return x.some((v: any) => v === k); }
function someOneHeld(x: any, k: any): any { const r = x.some((v: any) => v === k); return r; }
function forEachCounting(x: any): any { let count = 0; x.forEach((v: any) => { count += v; }); return count; }
function mapCounting(x: any): any { let count = 0; const r = x.map((v: any) => { count += v; return count; }); return [r, count]; }
function mapCountingLater(x: any): any { let count = 0; x.map((v: any) => { count += v; return count; }); return () => count; }
function mapNested(x: any, k: any): any { return x.map((v: any) => [v].map((w: any) => w + k)[0]); }
function mapNestedHeld(x: any, k: any): any { const r = x.map((v: any) => [v].map((w: any) => w + k)[0]); return r; }
function mapUnused(x: any, k: any): any { x.map((v: any) => v + k); return "done"; }
function mapNamed(x: any, k: any): any { const f = (v: any) => v + k; const r = x.map(f); return [r, f]; }
class Holder {
    extra = 100;
    mapThis(x: any): any { const r = x.map((v: any) => v + this.extra); return r; }
}
function* mapInGenerator(x: any, k: any): Generator<any> { yield x.map((v: any) => v + k); yield x.map((v: any) => v - k); }
async function mapInAsync(x: any, k: any): Promise<any> { const first = x.map((v: any) => v + k); await null; return [first, x.map((v: any) => v * k)]; }

function show(v: any): string {
    if (Array.isArray(v))
        return "[" + v.map(show).join(",") + "]";
    return typeof v === "function" ? "function" : String(v);
}
function attempt(name: string, f: () => any): void {
    let text: string;
    try {
        text = show(f());
    } catch (e) {
        text = "throws " + (e as Error).constructor.name;
    }
    lines.push(name + ": " + text);
}

const sites: Array<[string, (x: any) => any, any[]]> = [
    ["mapNone", x => mapNone(x), [5]],
    ["mapNoneHeld", x => mapNoneHeld(x), [5]],
    ["mapOne", x => mapOne(x, 10), [5]],
    ["mapOneHeld", x => mapOneHeld(x, 10), [5]],
    ["mapTwo", x => mapTwo(x, 3, 4), [5]],
    ["mapTwoHeld", x => mapTwoHeld(x, 3, 4), [5]],
    ["mapFour", x => mapFour(x, "a", 2, "c", 4.5), [5]],
    ["mapFourHeld", x => mapFourHeld(x, "a", 2, "c", 4.5), [5]],
    ["mapObject", x => mapObject(x, { name: "n" }), [5]],
    ["mapObjectHeld", x => mapObjectHeld(x, { name: "n" }), [5]],
    ["mapWithThisArgument", x => mapWithThisArgument(x, 1, { extra: 7 }), [5]],
    ["mapWithThisArgumentHeld", x => mapWithThisArgumentHeld(x, 1, { extra: 7 }), [5]],
    ["filterOne", x => filterOne(x, 1), [5]],
    ["filterOneHeld", x => filterOneHeld(x, 1), [5]],
    ["findOne", x => findOne(x, 2), [2]],
    ["findOneHeld", x => findOneHeld(x, 2), [2]],
    ["flatMapOne", x => flatMapOne(x, "k"), [5]],
    ["flatMapOneHeld", x => flatMapOneHeld(x, "k"), [5]],
    ["reduceOne", x => reduceOne(x, 2), [1, 5]],
    ["reduceOneHeld", x => reduceOneHeld(x, 2), [1, 5]],
    ["someOne", x => someOne(x, 2), [2]],
    ["someOneHeld", x => someOneHeld(x, 2), [2]],
    ["forEachCounting", x => forEachCounting(x), [5]],
    ["mapCounting", x => mapCounting(x), [5]],
    ["mapNested", x => mapNested(x, 9), [5]],
    ["mapNestedHeld", x => mapNestedHeld(x, 9), [5]],
    ["mapUnused", x => mapUnused(x, 1), [5]],
    ["mapThis", x => new Holder().mapThis(x), [5]],
];

for (let turn = 0; turn < 3; turn++) {
    for (const [name, site, operands] of sites) {
        attempt(turn + " " + name + " of an array", () => site([1, 2, 3]));
        kept.length = 0;
        attempt(turn + " " + name + " of a keeper", () => site(keeper()));
        scribble(40, turn);
        if (turn === 1)
            churn();
        attempt(turn + " " + name + ": what was kept, called later", () => kept.map(f => f(...operands)));
        attempt(turn + " " + name + " of undefined", () => site(undefined));
        attempt(turn + " " + name + " of a string", () => site("ab"));
    }
}

kept.length = 0;
const one = keeper();
for (let i = 0; i < 4; i++)
    mapOneHeld(one, i * 100);
scribble(60, 1);
churn();
attempt("four closures of one site are four functions", () => [kept.length, new Set(kept).size, kept.map(f => f(1))]);
kept[0].mark = "marked";
attempt("a property on one of them is on that one alone", () => kept.map(f => String(f.mark)));
attempt("their names and lengths", () => kept.map(f => f.name + "|" + f.length + "|" + typeof f.prototype));

kept.length = 0;
const read = mapCountingLater(one);
scribble(60, 2);
attempt("a variable is shared with the closure that was kept", () => [read(), kept[0](5), read(), kept[0](6), read()]);

kept.length = 0;
const [, named] = mapNamed(one, 1);
attempt("a closure that has a name at the site is handed over itself", () => [kept[0] === named, kept[0](1)]);

kept.length = 0;
const generated = [...mapInGenerator(one, 3)];
scribble(60, 3);
attempt("in a generator", () => [generated, kept.map(f => f(10)), [...mapInGenerator([1, 2], 3)]]);

kept.length = 0;
const awaited = await mapInAsync(one, 4);
scribble(60, 4);
churn();
attempt("in an async function", () => [awaited, kept.map(f => f(10))]);
attempt("in an async function, an array", () => "pending");
lines.push("in an async function, an array: " + show(await mapInAsync([1, 2], 4)));

class Heir extends Array<number> {
    map(f: any): any { kept.push(f); return super.map(f); }
}
kept.length = 0;
attempt("an heir of Array that keeps and goes on", () => mapOneHeld(Heir.from([1, 2, 3]), 1000));
scribble(60, 5);
attempt("an heir of Array: what was kept", () => kept.map(f => f(1)));

const altered: any = [1, 2, 3];
altered.map = function (f: any) { kept.push(f); return "own map"; };
kept.length = 0;
attempt("an array with a map of its own", () => mapTwoHeld(altered, 2, 1));
scribble(60, 6);
attempt("an array with a map of its own: what was kept", () => kept.map(f => f(10)));

const timers: any[] = [];
const later: any = { map(f: any) { timers.push(new Promise(resolve => setTimeout(() => resolve(f(1)), 1))); return "later"; } };
attempt("called from a timer", () => mapOneHeld(later, 41));
scribble(80, 7);
churn();
lines.push("called from a timer: " + show(await Promise.all(timers)));
console.log(lines.join("\n"));
