// Class instances with many extra properties, some of them deleted: the keys, walks, copies, reads and stores before and after the first walk, which may move every property that lies behind a deleted one.
const lines = [];
const log = text => { lines.push(String(text)); };
class Record { constructor(id) { this.id = id; this.name = "n" + id; } }
const sum = o => { let total = 0; for (const k of Object.keys(o)) if (typeof o[k] === "number") total += o[k]; return total; };
const digest = o => Object.keys(o).length + " " + Object.keys(o).slice(0, 4).join() + " .. " + Object.keys(o).slice(-4).join() + " " + sum(o);
function fill(o, from, to) { for (let i = from; i < to; i++) o["extra" + i] = i; return o; }
function readSome(o) { return [o.extra0, o.extra1, o.extra63, o.extra64, o.extra150, o.extra199, o.missing, o.id, o.name].join(); }
function writeSome(o, v) { o.extra1 = v; o.extra150 = v; o.extra199 = v; }

// Many extra properties, walked, read and stored before and after the walk.
{
    const o = fill(new Record(1), 0, 200);
    log(readSome(o)); log(digest(o)); log(readSome(o)); writeSome(o, -1); log(readSome(o)); log(digest(o));
    fill(o, 200, 210); log(digest(o)); log(readSome(o)); log(o.extra205);
}
// Deletions leave holes that a compaction closes: every offset behind them moves.
{
    const o = fill(new Record(2), 0, 200);
    log(readSome(o));
    for (let i = 0; i < 200; i += 3) delete o["extra" + i];
    log(readSome(o)); log(digest(o)); log(readSome(o)); writeSome(o, -2); log(readSome(o)); log(digest(o));
    o.extra0 = "back"; log(Object.keys(o).at(-1) + " " + o.extra0); log(digest(o));
    for (let round = 0; round < 3; round++) { delete o.extra1; o.extra1 = round; log(digest(o)); }
}
// Two objects take turns at the same sites.
{
    const a = fill(new Record(3), 0, 200), b = fill(new Record(4), 0, 200);
    delete b.extra5; delete b.extra6;
    for (let round = 0; round < 3; round++) { log(readSome(a) + " | " + readSome(b)); log(digest(a) + " | " + digest(b)); writeSome(round & 1 ? a : b, round); }
}
// Attributes, accessors, symbols and indexes among the extra properties.
{
    const o = fill(new Record(5), 0, 150);
    Object.defineProperty(o, "hidden", { value: 1, enumerable: false, configurable: true, writable: true });
    Object.defineProperty(o, "computed", { get() { return this.extra3 * 2; }, enumerable: true, configurable: true });
    Object.defineProperty(o, "fixed", { value: "fixed", enumerable: true });
    o[Symbol.for("s")] = "symbol"; o[7] = "seven"; o[2] = "two";
    delete o.extra10;
    log(digest(o)); log([o.hidden, o.computed, o.fixed, o[Symbol.for("s")], o[7], o[2]].join());
    log(Object.getOwnPropertyNames(o).length + " " + Reflect.ownKeys(o).length + " " + Object.keys(o).slice(0, 5).join());
    try { "use strict"; o.fixed = 1; } catch (error) { log(error.name); }
    log(JSON.stringify(Object.getOwnPropertyDescriptor(o, "fixed")) + JSON.stringify(Object.getOwnPropertyDescriptor(o, "hidden")));
    let count = 0; for (const k in o) count++; log("for in " + count);
    log(JSON.stringify(o).length + " " + Object.keys({ ...o }).length + " " + Object.keys(Object.assign({}, o)).length + " " + Object.entries(o).length + " " + Object.values(o).length);
    Object.freeze(o); log(digest(o) + " " + Object.isFrozen(o)); try { o.extra1 = "no"; } catch (error) { log(error.name); } log(o.extra1);
}
// The walk runs while properties come and go.
{
    const o = fill(new Record(6), 0, 140);
    const seen = [];
    for (const k of Object.keys(o)) { if (k === "extra5") { delete o.extra6; o.late = 1; } seen.push(k in o ? 1 : 0); }
    log(seen.length + " " + seen.reduce((a, b) => a + b) + " " + digest(o));
}
console.log(lines.join("\n"));
