// Maps and Sets with string keys, and their iterators, handed to functions that know them only as Iterable<T>.
class Sym { constructor(public name: string, public id: number) {} }
const out: string[] = [];
function say(what: string, ...parts: unknown[]): void { out.push(what + ": " + parts.join(" ")); }
function names(count: number, prefix: string): string[] { const all: string[] = []; for (let i = 0; i < count; i++) all.push(prefix + i); return all; }
function listOf<T>(all: Iterable<T>): T[] { const list: T[] = []; for (const one of all) list.push(one); return list; }
function sumOf(all: Iterable<Sym>): number { let t = 0; for (const one of all) t += one.id; return t; }
function joined(all: Iterable<string>): string { let t = ""; for (const one of all) t += one + ","; return t; }
function firstOf<T>(all: Iterable<T>, count: number): T[] { const list: T[] = []; for (const one of all) { list.push(one); if (list.length === count) break; } return list; }
function each<T>(all: Iterable<T>, act: (one: T, index: number) => void): number { let i = 0; for (const one of all) act(one, i++); return i; }
function tableOf(keys: string[]): Map<string, Sym> { const m = new Map<string, Sym>(); for (let i = 0; i < keys.length; i++) m.set(keys[i], new Sym(keys[i], i + 1)); return m; }

for (const size of [0, 1, 2, 4, 5, 8, 9, 14, 15, 24, 25, 43, 44, 64, 100, 300]) {
    const keys = names(size, "k");
    const m = tableOf(keys);
    const s = new Set<string>(keys);
    say("size " + size, sumOf(m.values()), joined(m.keys()).length, listOf(m.entries()).length, listOf(m).length, joined(s).length, joined(s.values()).length, joined(s.keys()).length, listOf(s.entries()).length);
}

{
    const m = tableOf(names(6, "a"));
    say("values", listOf(m.values()).map(v => v.name + v.id).join(" "));
    say("keys", joined(m.keys()));
    say("entries", listOf(m.entries()).map(([k, v]) => k + "=" + v.id).join(" "));
    say("the map", listOf(m).map(([k, v]) => k + "=" + v.id).join(" "));
    const numbers = new Map<string, number>([["x", 1.5], ["y", -0], ["z", 2 ** 40], ["w", NaN]]);
    say("numbers", listOf(numbers.values()).map(v => Object.is(v, -0) ? "-0" : String(v)).join(" "));
    const mixed = new Map<string, unknown>([["a", undefined], ["b", null], ["c", true], ["d", "text"], ["e", 7], ["f", { toString() { return "object"; } }]]);
    say("mixed", listOf(mixed.values()).map(String).join(" "));
}

{
    const m = tableOf(names(10, "b"));
    const it = m.values();
    say("first three", firstOf(it, 3).map(v => v.id).join(" "));
    say("the next two", firstOf(it, 2).map(v => v.id).join(" "));
    say("by hand", it.next().value!.id);
    say("the rest", listOf(it).map(v => v.id).join(" "));
    say("over", listOf(it).length, it.next().done);
    m.set("late", new Sym("late", 99));
    say("still over", listOf(it).length);
}

{
    const m = tableOf(names(8, "c"));
    const it = m.keys();
    const seen: string[] = [];
    each(it, (k, i) => { seen.push(k); if (i % 2 === 0) { const skipped = it.next(); seen.push("(" + (skipped.done ? "done" : skipped.value) + ")"); } });
    say("stepped inside the loop", seen.join(" "));
}

{
    const m = tableOf(names(8, "d"));
    const seen: string[] = [];
    each(m.values(), (v, i) => { seen.push(v.name); if (i === 1) { m.delete("d2"); m.delete("d0"); m.delete("d7"); } if (i === 3) m.set("d2", new Sym("again", 0)); });
    say("deleted and put back", seen.join(" "), m.size);
}

{
    const m = tableOf(names(4, "e"));
    const seen: string[] = [];
    const turns = each(m.values(), (v, i) => { seen.push(v.name); if (i < 60) m.set("more" + i, new Sym("more" + i, i)); });
    say("grown while iterated", turns, seen.length, seen[3], seen[4], seen[63], m.size);
}

{
    const s = new Set<string>(names(4, "f"));
    let text = "";
    const turns = each(s, (k, i) => { text += k[0]; if (i < 100) s.add("g" + i); if (i % 3 === 0) s.delete(k); });
    say("a set grown and thinned", turns, text.length, s.size);
    const t = new Set<string>(names(20, "h"));
    const seen: string[] = [];
    each(t.values(), (k, i) => { seen.push(k); if (i === 4) t.clear(); if (i === 4) { t.add("fresh1"); t.add("fresh2"); } });
    say("cleared and filled anew", seen.join(" "), t.size);
}

{
    const m = tableOf(names(12, "i"));
    const seen: string[] = [];
    each<any>((m as Map<any, any>).keys(), (k, i) => { seen.push(String(k)); if (i === 5) (m as Map<any, any>).set(42, new Sym("number", 42)); if (i === 7) (m as Map<any, any>).set(NaN, new Sym("nan", 0)); });
    say("other keys come while iterated", seen.join(" "), m.size);
    say("afterwards", listOf((m as Map<any, Sym>).values()).map(v => v.name).join(" "));
}

{
    const m = tableOf(names(9, "j"));
    const a = m.values(), b = m.values(), c = m.keys();
    const seen: string[] = [];
    each(a, (v, i) => { seen.push(v.name); if (i % 2) seen.push("b:" + b.next().value!.name); if (i % 4 === 0) seen.push("c:" + c.next().value); });
    say("three iterators", seen.join(" "));
    say("what is left", listOf(b).length, listOf(c).length);
}

{
    const m = tableOf(names(5, "l"));
    const it = m.values() as IterableIterator<Sym> & { mark?: string };
    it.mark = "own";
    say("an iterator with a property", sumOf(it), it.mark);
    const other = m.values() as any;
    let closed = 0;
    other.return = function () { closed++; return {}; };
    say("an iterator with its own return", firstOf(other as Iterable<Sym>, 2).length, closed);
    const third = m.values() as any;
    let calls = 0;
    const next = third.next;
    third.next = function () { calls++; return next.call(this); };
    say("an iterator with its own next", sumOf(third as Iterable<Sym>), calls);
}

{
    class Counted extends Map<string, Sym> { reads = 0; override values() { this.reads++; return super.values(); } }
    const m = new Counted();
    for (const k of names(7, "n")) m.set(k, new Sym(k, k.length));
    say("an heir of Map", sumOf(m.values()), m.reads, listOf(m).length);
}

{
    let total = 0;
    for (let round = 0; round < 300; round++) {
        const m = tableOf(names(round % 50, "r"));
        total += sumOf(m.values()) + joined(m.keys()).length;
        if (round % 7 === 0) for (const k of listOf(m.keys())) if (k.length % 2) m.delete(k);
        total += sumOf(m.values());
    }
    say("many", total);
}
console.log(out.join("\n"));
