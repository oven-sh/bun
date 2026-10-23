// Objects and arrays of this realm that inherit from another realm's prototypes follow the accessors and read-only properties which that realm has for indices, whether they were made before or behind the definition. Everything else of this realm does not.
import vm from "node:vm";
const sets: string[] = [];
function attempt(f: () => unknown): string {
    try { return String(f()); } catch (e) { return "threw " + (e as any).name; }
}
function text(x: unknown): string { return attempt(() => JSON.stringify(x)); }
function fill(x: any): any {
    x[0] = 1; x[1] = 2.5; x[2] = "s"; x[8] = 9;
    if (!Array.isArray(x)) x.length = 9;
    return x;
}
function report(name: string, next: () => any): void {
    const x = next();
    const names: string[] = [];
    for (const key in x) names.push(key);
    sets.length = 0;
    const line = [
        "get " + [x[1], x[3], x[5], x[7], x[9]].map(String).join(" "),
        "in " + [1 in x, 3 in x, 5 in x, 7 in x, 9 in x].join(" "),
        "own " + [Object.hasOwn(x, 1), Object.hasOwn(x, 3), Object.hasOwn(x, 5)].join(" "),
        "for-in " + names.join(","),
        "keys " + Object.keys(x).join(","),
        "json " + text(x),
        "join " + attempt(() => Array.prototype.join.call(x, "-")),
        "indexOf " + attempt(() => Array.prototype.indexOf.call(x, "got")) + " " + attempt(() => Array.prototype.lastIndexOf.call(x, "fixed")),
        "includes " + attempt(() => Array.prototype.includes.call(x, "only got")),
        "map " + attempt(() => Array.prototype.join.call(Array.prototype.map.call(x, (v: unknown) => v + "!"), "-")),
        "filter " + attempt(() => Array.prototype.join.call(Array.prototype.filter.call(x, () => true), "-")),
        "slice " + attempt(() => Array.prototype.join.call(Array.prototype.slice.call(x, 2, 8), "-")),
        "concat " + attempt(() => Array.prototype.join.call(Array.prototype.concat.call([], x), "-")),
        "from " + attempt(() => Array.from(x).join("-")),
        "reduce " + attempt(() => Array.prototype.reduce.call(x, (sum: any, v: unknown) => sum + "," + v, "")),
        "set 3 " + attempt(() => { x[3] = "a"; return x[3]; }),
        "set 5 " + attempt(() => { x[5] = "b"; return x[5]; }),
        "set 7 " + attempt(() => { x[7] = "c"; return x[7]; }),
        "set 9 " + attempt(() => { x[9] = "d"; return x[9]; }),
        "length " + x.length,
        "Reflect.set " + attempt(() => Reflect.set(x, 5, "e")) + " " + attempt(() => Reflect.set(x, 4, "f")),
        "define " + attempt(() => { Object.defineProperty(x, 3, { value: "own", writable: true, enumerable: true, configurable: true }); return x[3]; }),
        "delete " + attempt(() => { delete x[3]; return x[3]; }),
    ];
    const y = next();
    line.push(
        "push " + attempt(() => { const short = Array.isArray(y) ? y : y; short.length = 2; const lengths: unknown[] = []; for (let i = 0; i < 8; i++) lengths.push(attempt(() => Array.prototype.push.call(short, "p" + i))); return lengths.join(",") + " " + Array.prototype.join.call(short, "-"); }),
    );
    const z = next();
    line.push(
        "reverse " + attempt(() => Array.prototype.join.call(Array.prototype.reverse.call(z), "-")),
        "fill " + attempt(() => Array.prototype.join.call(Array.prototype.fill.call(z, "z", 2, 5), "-")),
        "unshift " + attempt(() => Array.prototype.unshift.call(z, "u")) + " " + attempt(() => Array.prototype.join.call(z, "-")),
        "splice " + attempt(() => Array.prototype.join.call(Array.prototype.splice.call(z, 1, 2), "-")) + " " + attempt(() => Array.prototype.join.call(z, "-")),
        "sort " + attempt(() => Array.prototype.join.call(Array.prototype.sort.call(z), "-")),
        "setter saw " + sets.join(","),
    );
    console.log(name + ": " + line.join(" | "));
}
const byTheirCode = `(x => {
    const attempt = f => { try { return String(f()); } catch (e) { return "threw " + e.name; } };
    let names = ""; for (const key in x) names += "," + key;
    return ["get " + [x[1], x[3], x[5], x[7], x[9]].map(String).join(" "), "in " + [3 in x, 5 in x, 7 in x].join(" "), "for-in" + names, "json " + attempt(() => JSON.stringify(x)),
        "join " + attempt(() => Array.prototype.join.call(x, "-")), "set 3 " + attempt(() => { "use strict"; x[3] = "a"; return x[3]; }), "set 5 " + attempt(() => { "use strict"; x[5] = "b"; return x[5]; }),
        "set 7 " + attempt(() => { "use strict"; x[7] = "c"; return x[7]; }), "push " + attempt(() => Array.prototype.push.call(x, "p")), "join " + attempt(() => Array.prototype.join.call(x, "-"))].join(" | ");
})`;
function scenario(title: string, holder: "Object" | "Array", definedByTheirCode: boolean, madeFirst: boolean): void {
    console.log("== " + title);
    const context = vm.createContext({ note: (index: number) => { sets.push(String(index)); } });
    const theirs: any = vm.runInContext("({ Object, Array })", context);
    class BelowTheirArray extends theirs.Array {}
    const between = Object.create(theirs.Array.prototype);
    const betweenObjects = Object.create(theirs.Object.prototype);
    const makers: [string, () => any][] = [
        ["an object below their Object.prototype", () => fill(Object.create(theirs.Object.prototype))],
        ["an object two below their Object.prototype", () => fill(Object.create(betweenObjects))],
        ["an object moved below their Object.prototype", () => Object.setPrototypeOf(fill({}), theirs.Object.prototype)],
        ["an array moved below their Array.prototype", () => Object.setPrototypeOf(fill([]), theirs.Array.prototype)],
        ["an array of numbers moved below their Array.prototype", () => { const a: number[] = [1, 2, 3]; a[8] = 9; return Object.setPrototypeOf(a, theirs.Array.prototype); }],
        ["an array of doubles moved below their Object.prototype", () => { const a: number[] = [1.5, 2.5, 3.5]; a[8] = 9.5; return Object.setPrototypeOf(a, theirs.Object.prototype); }],
        ["an array moved by __proto__", () => { const a: any = fill([]); a.__proto__ = theirs.Array.prototype; return a; }],
        ["an array moved below an heir of their Array.prototype", () => Object.setPrototypeOf(fill([]), between)],
        ["an instance of a class of ours below their Array", () => fill(new BelowTheirArray())],
        ["our Array constructed for their Array", () => fill(Reflect.construct(Array, [], theirs.Array))],
        ["their Array constructed for our Array", () => fill(Reflect.construct(theirs.Array, [], Array))],
        ["their Array constructed for our class", () => fill(Reflect.construct(theirs.Array, [], BelowTheirArray))],
        ["an array of theirs", () => fill(new theirs.Array())],
        ["an array of theirs moved below our Array.prototype", () => Object.setPrototypeOf(fill(new theirs.Array()), Array.prototype)],
        ["an object of theirs", () => fill(new theirs.Object())],
        ["an array of ours", () => fill([])],
        ["an array of numbers of ours", () => { const a: number[] = [1, 2, 3]; a[8] = 9; return a; }],
        ["an object of ours", () => fill({})],
        ["an object of ours without a prototype", () => fill(Object.create(null))],
        ["arguments of ours", () => (function (..._: unknown[]) { return fill(arguments); })(0, 0, 0)],
    ];
    const madeBefore: [string, any[]][] = madeFirst ? makers.map(([name, make]) => [name, [make(), make(), make(), make()]]) : [];
    const target = holder + ".prototype";
    if (definedByTheirCode) {
        vm.runInContext(`Object.defineProperty(${target}, "3", { get() { return "got"; }, set(value) { note(3); }, configurable: true });
            Object.defineProperty(${target}, "5", { value: "fixed", writable: false, configurable: true });
            Object.defineProperty(${target}, "7", { get() { return "only got"; }, configurable: true, enumerable: true });`, context);
    } else {
        const prototype = theirs[holder].prototype;
        Object.defineProperty(prototype, "3", { get() { return "got"; }, set(_value) { sets.push("3"); }, configurable: true });
        Object.defineProperty(prototype, "5", { value: "fixed", writable: false, configurable: true });
        Object.defineProperty(prototype, "7", { get() { return "only got"; }, configurable: true, enumerable: true });
    }
    const their = vm.runInContext(byTheirCode, context);
    for (const [name, pool] of madeBefore) {
        report("made before, " + name, () => pool.pop());
        console.log("made before, in their hands, " + name + ": " + their(pool.pop()));
    }
    for (const [name, make] of makers) {
        report("made behind, " + name, make);
        console.log("made behind, in their hands, " + name + ": " + their(make()));
    }
}
scenario("on their Object.prototype, by this realm", "Object", false, true);
scenario("on their Array.prototype, by this realm", "Array", false, true);
scenario("on their Object.prototype, by their code", "Object", true, true);
scenario("on their Array.prototype, by their code", "Array", true, true);
scenario("on their Object.prototype, nothing of ours below it yet", "Object", true, false);
