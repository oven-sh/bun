import data from "./data.json";
const all = await import("./data.json");
(all.default as any).version = "9";
all.default.nested.port = 81;
console.log(data.version, data.nested.port);
