enum Slot {
  A,
  B,
  C = 10,
  Minus = -1,
  Half = 0.5,
}
enum Name {
  X = "x",
  Two = "2",
}

const table = { [Slot.C]: "c", name: "n", [Slot.B]: "b", [Slot.Minus]: "minus", [Slot.A]: "a", [Slot.Half]: "half" };
const named = { [Name.X]: 1, [Name.Two]: 2, z: 3, [Slot.B]: 4 };

class Keyed {
  last = "last";
  [Slot.C] = "c";
  [Slot.A] = "a";
  [Name.Two] = "two";
  [Name.X] = "x";
}

console.log(Object.keys(table).join());
console.log(JSON.stringify(table));
console.log(table[Slot.A], table[Slot.B], table[Slot.C], table[Slot.Minus], table[Slot.Half], table.name);
console.log(table[0], table[10], table["-1"], table["0.5"]);
console.log(Object.keys(named).join());
console.log(JSON.stringify(named));
console.log(named.x, named[2], named["2"], named[1]);
const keyed = new Keyed();
console.log(Object.keys(keyed).join());
console.log(JSON.stringify(keyed));
console.log(keyed[0], keyed[10], keyed[2], keyed.x, keyed.last);
const keys: string[] = [];
for (const key in table) keys.push(key);
console.log(keys.join());
console.log(Object.keys({ ...table }).join(), Object.keys(Object.assign({}, keyed)).join());
