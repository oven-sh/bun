import data from "./data.json";
console.log(data.version, eval("data.nested.port"), eval("(data.version = '9', data.version)"), data.version);
