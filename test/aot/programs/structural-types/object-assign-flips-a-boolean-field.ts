class Cell {
  ready = false;
}

const cell = new Cell();
Object.assign(cell, { ready: true });
console.log(cell.ready, cell.ready ? "ready" : "not ready", !cell.ready);
