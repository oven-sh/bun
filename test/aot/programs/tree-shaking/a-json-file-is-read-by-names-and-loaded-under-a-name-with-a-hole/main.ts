import data from "./data.json";
const which = process.argv.length > 100 ? "other" : "data";
console.log(data.version, require(`./${which}.json`).version, (await import(`./${which}.json`)).default.nested.port);
