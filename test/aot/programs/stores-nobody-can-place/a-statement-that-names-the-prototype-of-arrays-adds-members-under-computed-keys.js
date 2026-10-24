// The receiver is Array.prototype itself and nothing else: the store is the program's own, whatever the key.
const table = { last: list => list[list.length - 1], first: list => list[0] };
for (const name of Object.keys(table)) {
  Array.prototype[name] = function () {
    return table[name](this);
  };
}
Object.defineProperty(Array.prototype, "si" + "ze", {
  configurable: true,
  get() {
    return this.length;
  },
});
console.log([1, 2, 3].last(), [1, 2, 3].first(), [1, 2, 3].size, [][process.argv.length > 100 ? "first" : "last"]());
console.log(Object.keys(Array.prototype).sort().join(" "));
