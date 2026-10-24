class Cell {
  value: number | string = 1;
}

const cell = new Cell();
Object.assign(cell, { value: "text" });
console.log(typeof cell.value === "number" ? cell.value + 1 : cell.value.length);
