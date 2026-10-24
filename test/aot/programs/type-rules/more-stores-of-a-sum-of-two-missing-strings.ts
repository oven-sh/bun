// As stores-of-a-sum-of-two-missing-strings: a sum that TypeScript calls a string and that is NaN at run time, stored by other roads into places that no annotation types, and read back in the ways a string is read.
const none: string[] = [];
const some: string[] = ["a", "b"];
function show(name: string, f: () => unknown) { try { console.log(name, String(f())); } catch (e) { console.log(name, "threw", (e as Error).constructor.name); } }

function assignedLater(list: string[], i: number) { const o = { key: "x" }; o.key = list[i] + list[i + 1]; return o.key; }
function throughAVariable(list: string[], i: number) { const sum = list[i] + list[i + 1]; const o = { key: sum }; return o.key; }
function nested(list: string[], i: number) { const o = { inner: { key: list[i] + list[i + 1] } }; return o.inner.key; }
function shorthand(list: string[], i: number) { const key = list[i] + list[i + 1]; return { key }.key; }
class Holder { key = ""; fill(list: string[], i: number) { this.key = list[i] + list[i + 1]; return this.key; } }
function byIndex(list: string[], i: number) { const all = ["x"]; all[0] = list[i] + list[i + 1]; return all[0]; }
function unshifted(list: string[], i: number) { const all = ["x"]; all.unshift(list[i] + list[i + 1]); return all[0]; }
function inASet(list: string[], i: number) { const all = new Set(["x"]); all.add(list[i] + list[i + 1]); return [...all][1]; }
function inAMap(list: string[], i: number) { const all = new Map([["k", "x"]]); all.set("k", list[i] + list[i + 1]); return all.get("k"); }
function lengthOfField(list: string[], i: number) { const o = { key: list[i] + list[i + 1] }; return o.key.length; }
function lengthOfElement(list: string[], i: number) { const all = [list[i] + list[i + 1]]; return all[0].length; }
function joined(list: string[], i: number) { const all = [list[i] + list[i + 1], "z"]; return all.join("-"); }
function returned(list: string[], i: number) { const make = () => ({ key: list[i] + list[i + 1] }); return typeof make().key; }
function compared(list: string[], i: number) { const o = { key: list[i] + list[i + 1] }; return o.key === "ab"; }

for (const list of [none, some]) {
  show("assigned later", () => assignedLater(list, 0));
  show("through a variable", () => throughAVariable(list, 0));
  show("nested", () => nested(list, 0));
  show("shorthand", () => shorthand(list, 0));
  show("a class field", () => new Holder().fill(list, 0));
  show("by index", () => byIndex(list, 0));
  show("unshifted", () => unshifted(list, 0));
  show("in a Set", () => inASet(list, 0));
  show("in a Map", () => inAMap(list, 0));
  show("length of a field", () => lengthOfField(list, 0));
  show("length of an element", () => lengthOfElement(list, 0));
  show("joined", () => joined(list, 0));
  show("returned", () => returned(list, 0));
  show("compared", () => compared(list, 0));
}
