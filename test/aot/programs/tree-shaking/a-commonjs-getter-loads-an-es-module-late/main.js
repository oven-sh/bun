// index.cjs defines getters that require an ES module the first time they are read, as packages with many files do. The names of the ES modules' exports appear only inside those getters.
import index from "./index.cjs";

console.log(Object.keys(index).join());
console.log(index.first());
console.log(index["sec" + "ond"]());
