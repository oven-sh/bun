class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

function defaults(): { leaf: Leaf | null } {
  return { leaf: null };
}

const cell = new Cell();
Object.assign(cell, defaults());
console.log(cell.leaf === null ? -1 : cell.leaf.weight);
