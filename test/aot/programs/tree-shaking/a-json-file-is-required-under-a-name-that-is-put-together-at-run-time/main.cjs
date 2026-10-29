const name = process.argv.length > 100 ? "./other.json" : "./data" + ".json".slice(0, 5);
try {
  console.log(require(name).version);
} catch (error) {
  console.log(error.constructor.name);
}
console.log(require("./data.json").nested.port);
