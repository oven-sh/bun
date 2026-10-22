class Leaf {
  weight = 7;
}

class Base {
  leaf: Leaf | null = new Leaf();
}

class Cell extends Base {
  other = 1;
}

const cell = new Cell();
Object.assign(cell, { leaf: null });
console.log(cell.leaf === null ? -1 : cell.leaf.weight);
