import data from "./data.json";
console.log(data.version, require("./data.json").version, require("./data.json").nested.port);
const { version } = require("./data.json");
console.log(version);
