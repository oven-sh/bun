class Row {
  id = 7;
  next(): number {
    return this.id + 1;
  }
}
const keys: "id"[] = ["id"];
const row = new Row();
row[keys[0]] = row[keys[0]];
console.log(row.next());
export {};
