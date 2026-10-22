class Cell {
  run: () => number = () => 1;
}

const cell = new Cell();
Object.assign(cell, { run: () => 2 });
console.log(cell.run());
