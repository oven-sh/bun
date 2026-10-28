import data from "./data.json";
const name = process.argv.length > 100 ? "./other.json" : ["./data", "json"].join(".");
console.log(data.version);
try {
  console.log(require(name).version);
} catch (error: any) {
  console.log(error.constructor.name);
}
try {
  console.log((await import(name)).default.version);
} catch (error: any) {
  console.log(error.constructor.name);
}
