// The type of `{ count: 1 }` in `const kept = { count: 1 }` is inferred: nobody wrote it. JavaScript that is handed such an object may store anything to it, and typed code then reads what is there, as under plain Bun: an inferred type never decides what a program does.
import { alter, spoil, fill, call, put, Holder } from "./library.js";
const o = alter({ count: 1, more: { n: 1, extra: "e" } });
console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
const kept = { count: 1, more: { n: 1, extra: "e" } };
alter(kept);
console.log(kept.more.n, kept.more.extra, kept.count, typeof kept.count, kept.count + 1, JSON.stringify(kept));
const p = { x: 1, y: 2 };
console.log(p.x + p.y); spoil(p);
console.log(p.x, typeof p.x, p.x + 1, p.y);
function make(i: number) { return { x: i, y: i * 2 }; }
let total = 0; const all = [make(1), make(2)];
spoil(all[0]);
for (const q of all) total += q.y; console.log(total, all[0].x + "!", all[1].x + 1);
const list = [make(3), make(4)];
fill(list);
console.log(list.length, list.map(q => q.x + ":" + q.y).join());
console.log(call((q = make(5)) => q.x + "|" + q.y));
const map = new Map([["a", make(6)]]);
put(map);
console.log([...map.values()].map(q => String(q.x)).join());
const held = make(7);
console.log(JSON.stringify(new Holder(held).change().held), typeof held.x, JSON.stringify(held));
const nested = { inner: make(8), list: [make(9)] };
spoil(nested.inner); spoil(nested.list[0]);
console.log(nested.inner.x + 1, nested.list[0].x + 1, JSON.stringify(nested));
