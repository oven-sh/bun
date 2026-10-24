class Cell {
  value = 1;
}

const cell = new Cell();
Object.assign(cell, { value: "text" });
console.log(typeof cell.value, cell.value + 1);
