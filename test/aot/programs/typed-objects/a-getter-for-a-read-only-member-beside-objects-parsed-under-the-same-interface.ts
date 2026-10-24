// An interface with a read-only member: one object computes it by a getter, five hundred come out of JSON.parse() under the same type.
interface Holder { readonly size: number; name: string }
const live: Holder = { get size() { return this.name.length; }, name: "four" };
const held: Holder[] = [live];
for (let n = 0; n < 500; n++) { const next: Holder = JSON.parse('{"size":' + n + ',"name":"n' + n + '"}'); held.push(next); }
let total = 0;
for (const one of held) total += one.size;
live.name = "longer";
console.log(total, live.size, held[3].size, JSON.stringify(held[0]), JSON.stringify(held[4]));
