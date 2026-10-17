// A sum that TypeScript calls a string and that is NaN at run time is stored into a field of a literal or an element of an array that no annotation types.
const none: string[] = [];
const some: string[] = ["a", "b"];
function show(name: string, f: () => unknown) { try { console.log(name, String(f())); } catch (e) { console.log(name, "threw", (e as Error).constructor.name); } }

function inLiteral(list: string[], i: number) { const o = { key: list[i] + list[i + 1] }; return o.key; }
function inArray(list: string[], i: number) { const all = [list[i] + list[i + 1]]; return all[0]; }
function pushed(list: string[], i: number) { const all = ["x"]; all.push(list[i] + list[i + 1]); return all[1]; }

for (const list of [none, some]) {
  show("in a literal", () => inLiteral(list, 0));
  show("in an array", () => inArray(list, 0));
  show("pushed", () => pushed(list, 0));
}
