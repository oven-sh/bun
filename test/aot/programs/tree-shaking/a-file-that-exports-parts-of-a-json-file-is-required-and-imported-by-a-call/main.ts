import data from "./data.json";
console.log(data.version, data.nested.port);
require("./barrel").whole.version = "9";
(await import("./barrel")).nested.port = 81;
console.log(data.version, data.nested.port);
