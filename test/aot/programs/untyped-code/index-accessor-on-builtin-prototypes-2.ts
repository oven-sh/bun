// Another realm gets accessors for indices on its built-in prototypes while prototype objects of this realm inherit from it. What inherits from that realm changes its storage; the arrays of this realm inherit nothing from it and keep theirs (part 2).
// ENV JSC_useDollarVM=1
const vm = (globalThis as any).$vm;
const other = vm.createGlobalObject();
// An object of this realm with indexed storage, that is itself a prototype, and whose chain leaves this realm.
const held = Object.create(other.Object.prototype);
function theirsHaveABadTime(): void {
    held[0] = 1;
    (globalThis as any).child = Object.create(held);
    // And a prototype object of this realm that gets one of theirs for its own.
    const holder: any = {};
    (globalThis as any).heir = Object.create(holder);
    Object.setPrototypeOf(holder, other.Object.prototype);
    vm.haveABadTime(other);
}
type Mixed = number | string | null;
const source: number[] = [4.5, 5.5, 6.5, 7.5];
function rest(...xs: number[]): number[] { return xs; }
const kinds: [string, (n: number) => unknown[]][] = [
    ["doubles", n => { const a: number[] = [n + 0.5, n + 1.5, n + 2.5]; return a; }],
    ["constants", _ => { const a: number[] = [1, 2, 3]; return a; }],
    ["constant doubles", _ => { const a: number[] = [1.5, 2.5]; return a; }],
    ["constant values", _ => { const a: Mixed[] = ["a", null, "b"]; return a; }],
    ["empty of numbers, pushed to", n => { const a: number[] = []; a.push(n + 0.5); a.push(n); return a; }],
    ["empty of numbers, pushed to often", n => { const a: number[] = []; for (let i = 0; i < 9; i++) a.push(n + i); return a; }],
    ["values", n => { const a: Mixed[] = [n, "s", null]; return a; }],
    ["empty of values, pushed to", n => { const a: Mixed[] = []; a.push(n); a.push("s"); return a; }],
    ["empty of values, pushed to often", n => { const a: Mixed[] = []; for (let i = 0; i < 9; i++) a.push(i & 1 ? "s" : n); return a; }],
    ["empty of anything", n => { const a: any[] = []; a.push(n); return a; }],
    ["one", n => [n]], ["four", n => [n, n, n, n]], ["five", n => [n, n, n, n, n]],
    ["spread", n => [n, ...source]], ["copy by spread", _ => [...source]],
    ["slice", _ => source.slice(1)], ["map", n => source.map(x => x + n)], ["filter", _ => source.filter(x => x > 5)], ["concat", n => source.concat([n])],
    ["Array.of", n => Array.of(n, n + 1)], ["Array.from", _ => Array.from(source)], ["new Array(3)", _ => new Array(3)], ["new Array(1, 2)", n => new Array(n, 2)],
    ["rest", n => rest(n, n + 1, n + 2)], ["keys", _ => Object.keys({ a: 1, b: 2 })], ["split", _ => "a,b,c".split(",")],
    ["match", _ => "xaby".match(/a(b)/) as unknown[]], ["match with indices", _ => "xaby".match(/a(b)/d) as unknown[]],
];
function show(when: string): void {
    for (const [name, make] of kinds) console.log(when, name + ":", vm.indexingMode(make(1)).includes("SlowPut") ? "asks its prototypes at every store" : "stores at once", JSON.stringify(make(2)));
}
function many(k: number): number {
    let s = 0;
    for (const [, make] of kinds) for (let i = 0; i < k; i++) s += make(i).length;
    return s;
}
console.log("bad time:", vm.isHavingABadTime(globalThis), vm.isHavingABadTime(other), many(300));
theirsHaveABadTime();
console.log("bad time:", vm.isHavingABadTime(globalThis), vm.isHavingABadTime(other), vm.indexingMode(held));
show("made behind it,");
// Until every free list has run out several times, so that the slow-path operations of the stubs run too.
console.log(many(60000));
show("and still,");
console.log("done");
