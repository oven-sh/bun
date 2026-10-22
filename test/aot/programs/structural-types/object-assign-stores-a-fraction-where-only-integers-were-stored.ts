class Cell {
  count = 1;
}

const cell = new Cell();
Object.assign(cell, { count: 2.5 });
console.log(cell.count, cell.count + 1, cell.count * 2, cell.count | 0);
const big = new Cell();
Object.assign(big, { count: 2 ** 40 });
console.log(big.count, big.count + 1);
