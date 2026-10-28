import data, { nested, version } from "./data.json";
nested.port = 5;
console.log(data.nested.port, version, data.version);
