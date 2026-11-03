import m from "./007_async.py";
import python from "bun:python";
const pythonImport = python.import;
const print = (...values) => console.log(values.map(String).join(" "));
const unused = m.add(1, 2);
print(m.plain.then, m.d.then, typeof unused.then, typeof new m.Awaitable(1).then, m.add.then, m.agen(1).then, typeof m.agen(1)[Symbol.asyncIterator], m.plain[Symbol.asyncIterator]);
print(unused instanceof Promise, m.held[0] instanceof Promise, typeof m.held[0].then);
m.held[0].close();
async function main() {
    print(await m.add(1, 2), await m.nested(1), await m.half(4), typeof await m.half(4), await m.half(5));
    print(await m.yields_none(), await new m.Awaitable(1), await new m.AwaitableValue(), await m.plain === m.plain);
    try { await m.fails(); } catch (e) { print("caught", e.name, e.message); }
    try { await m.needs_loop(); } catch (e) { print("caught", e.name); }
    const c = m.add(1, 1);
    print(await c, await c);
    const raw = m.held[1]; await raw;
    try { await raw; } catch (e) { print("caught", e.name, e.message); }
    print((await Promise.all([m.add(1, 1), m.add(2, 2), 5])).join());
    print(await m.add(3, 4).then(v => v * 2), await m.fails().then(null, e => "handled " + e.name));
    print(m.add(0, 0).then(() => { }) instanceof Promise);
    const seen = []; for await (const x of m.agen(3)) seen.push(typeof x + x); print(seen.join(), m.log.join());
    m.log.length = 0; for await (const x of m.agen(3)) break; print(m.log.join());
    const seen2 = []; for await (const x of new m.AIter()) seen2.push(x); print(seen2.join());
    try { for await (const x of m.agen_fails()) print("item", x); } catch (e) { print("caught", e.name, e.message); }
    const it = m.agen(1)[Symbol.asyncIterator]();
    print(it.next() instanceof Promise, it[Symbol.asyncIterator]() === it, JSON.stringify(await it.next()), JSON.stringify(await it.next()));
}
let order = [];
m.add(1, 1).then(() => order.push("then"));
order.push("sync");
main().then(() => print(order.join(), "done"), e => print("main failed", e, e.stack));
