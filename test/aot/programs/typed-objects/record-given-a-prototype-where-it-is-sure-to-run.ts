interface Row {
  id: number;
}
const parent = {
  hello(this: Row): string {
    return "hi " + this.id;
  },
};
const row: Row = { id: 1 };
Object.setPrototypeOf(row, parent);
console.log(row.id, (row as any).hello(), Object.getPrototypeOf(row) === parent, Object.keys(row).join());
Object.setPrototypeOf(row, null);
console.log(row.id, Object.getPrototypeOf(row), "hello" in row);
function adopt(): Row {
  const made: Row = { id: 2 };
  Object.setPrototypeOf(made, parent);
  return made;
}
console.log((adopt() as any).hello(), adopt().id);
