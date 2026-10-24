class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

const cell = new Cell();
Object.assign(cell, { leaf: null });
console.log(cell.leaf === null ? -1 : cell.leaf.weight);
