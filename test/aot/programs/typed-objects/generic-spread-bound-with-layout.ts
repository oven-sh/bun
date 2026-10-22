// Where the bound of the type parameter has a layout, what a generic function makes with a spread is made with one, and becomes what the call says in its own cell: it is one object, and no type is opened for it.
// IR- ^    v\d+: [^=~\n]*(?<![=\w])L\d+(?![!\d])
interface Base { name: string }
interface R extends Base { a: number }
const kept: Base[] = [];
function stamp<T extends Base>(r: T): T & { at: number } { const all: (T & { at: number })[] = []; all.push({ ...r, at: 1 }); const made = all[0]; kept.push(made); return made }
function copy<T extends Base>(r: T): T & { at: number } { return { ...r, at: 2 } }
for (let round = 0; round < 3; round++) {
  const a = stamp<R>({ name: "n", a: round });
  a.name = "m";
  const b = copy<R>({ name: "o", a: round });
  console.log((a as object) === kept[round], kept[round].name, a.a, a.at, b.name, b.a, b.at, Object.keys(b).join());
}
