const data = require("./data.json");
console.log(data.version, data.nested.port, Object.keys(data).join());
