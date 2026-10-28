import data from "./data.json";
console.log(data.version, require(require.resolve("./data.json")).version, typeof import.meta.resolve("./data.json"));
console.log((await import(import.meta.resolve("./data.json"))).default.version);
