class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

const cell = new Cell();
const spelled = ["le", "af"].join("");
Object.assign(cell, { [spelled]: null });
console.log(cell.leaf === null ? -1 : cell.leaf.weight);
