let asked = 0;
const key = { toString() { asked++; return "error"; } };
const remove = (object, k) => delete object[k];
let kept = 0;
for (let i = 0; i < 50; i++) { const o = { error: i, page: i }; remove(o, key); kept += Object.keys(o).length; }
console.log("toString was called", asked, "times for 50 deletions; names kept:", kept);

let turns = 0;
const changing = { toString() { return turns++ % 2 ? "page" : "error"; } };
const seen = [];
for (let i = 0; i < 8; i++) { const o = { error: i, page: i }; remove(o, changing); seen.push(Object.keys(o).join()); }
console.log("a key that spells another name each time:", seen.join(" "));

const primitive = { [Symbol.toPrimitive](hint) { asked++; return hint === "string" ? "page" : "error"; } };
asked = 0;
const left = [];
for (let i = 0; i < 40; i++) { const o = { error: i, page: i }; remove(o, primitive); if (i % 10 === 0) left.push(Object.keys(o).join()); }
console.log("Symbol.toPrimitive:", asked, left.join(" "));

const throwing = { toString() { if (++asked > 20) throw new RangeError("enough"); return "error"; } };
asked = 0;
let thrown = 0;
for (let i = 0; i < 40; i++) { try { remove({ error: i, page: i }, throwing); } catch (error) { if (error instanceof RangeError) thrown++; } }
console.log("a key that throws from the twenty-first time on:", asked, thrown);

const list = ["error"];
let joined = 0;
for (let i = 0; i < 40; i++) { const o = { error: i, page: i, "error,page": i }; if (i === 20) list.push("page"); remove(o, list); joined += Object.keys(o).length * (i < 20 ? 1 : 100); }
console.log("an array for a key, which grows:", joined);

const has = (object, k) => k in object;
const read = (object, k) => object[k];
const write = (object, k, v) => { object[k] = v; };
asked = 0;
for (let i = 0; i < 50; i++) { const o = { error: i, page: i }; has(o, key); read(o, key); write(o, key, 1); }
console.log("in, read, store:", asked);
