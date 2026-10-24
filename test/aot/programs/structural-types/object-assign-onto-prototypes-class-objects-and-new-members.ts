class Leaf {
  weight = 7;
}

class Cell {
  value = 1;
  note?: string;
  list: number[] = [1, 2, 3];
  leaf: Leaf | null = new Leaf();
  static shared: Leaf | null = new Leaf();
  thrice(): number {
    return this.value * 3;
  }
}

interface Cell {
  twice(): number;
}

Object.assign(Cell.prototype, {
  twice(this: Cell): number {
    return this.value * 2;
  },
});
console.log("a method copied onto the prototype:", new Cell().twice());

const replaced = new Cell();
Object.assign(replaced, { thrice: () => 99 });
console.log("a method replaced on an instance:", replaced.thrice(), new Cell().thrice());

Object.assign(Cell, { shared: null });
console.log("a static member:", Cell.shared === null ? -1 : Cell.shared.weight);

const viaGetter = new Cell();
Object.assign(viaGetter, {
  get leaf(): null {
    return null;
  },
});
console.log("a getter in the source:", viaGetter.leaf === null ? -1 : viaGetter.leaf.weight);

const grown: Cell & { extra?: string } = new Cell();
Object.assign(grown, { extra: "later" });
console.log("a new member:", grown.extra === undefined ? "missing" : grown.extra.length, Object.keys(grown).join());

const noted = new Cell();
Object.assign(noted, { note: "filled" });
console.log("an optional member:", noted.note === undefined ? "missing" : noted.note.length, typeof noted.note);

const listed = new Cell();
Object.assign(listed, { list: [] });
console.log("an empty array:", listed.list.length, listed.list[0], listed.list.join());
Object.assign(listed, { list: [1.5, 2.5] });
console.log("an array of fractions:", listed.list.length, listed.list[0], listed.list.join());
