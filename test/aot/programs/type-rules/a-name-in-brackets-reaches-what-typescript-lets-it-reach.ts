// TypeScript lets `box["name"]` read a private or protected member, and reports no function that is tested and never called. A build goes by that.
class Box {
  private hidden = 3;
  protected kept = 4;
  private measure() {
    return this.hidden + this.kept;
  }
}
const box = new Box();
const table: { [key: string]: number } = { a: 1 };
const tools = {
  run() {
    return 1;
  },
};
console.log(box["hidden"], box["kept"], box[`hidden`], box?.["kept"], box["measure"]());
console.log(table["a"], table.a);
if (tools["run"]) console.log("tested");
