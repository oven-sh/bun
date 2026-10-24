// Objects that start empty and are filled by computed keys: where the same keys come again and again in the same order, however many such orders a program has going at once, the objects settle on shared shapes and none stays a dictionary.
import { describe } from "bun:jsc";
const build = (keys, first) => { const out = {}; for (const key of keys) out[key] = first++; return out; };
const orders = [];
for (let i = 0; i < 48; i++) orders.push(["a" + i, "b" + i, "c" + (i % 7), "d" + i]);
const kept = [], before = [];
let sum = 0;
for (let round = 0; round < 200; round++)
  for (let i = 0; i < orders.length; i++) { before[i] = kept[i]; kept[i] = build(orders[i], round); sum += kept[i][orders[i][3]] - kept[i][orders[i][0]]; }
const shape = made => describe(made).match(/Structure 0x[0-9a-f]+/)?.[0];
console.log("sum", sum);
console.log("dictionaries after two hundred rounds:", kept.filter(made => describe(made).includes("ictionary")).length);
console.log("keys", Object.keys(kept[5]).join(), Object.values(kept[47]).join());
console.log("two of one order share a shape:", kept.every((made, i) => shape(made) === shape(before[i])));
