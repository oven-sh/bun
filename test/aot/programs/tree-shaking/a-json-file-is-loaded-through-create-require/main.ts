import { createRequire } from "node:module";
import data from "./data.json";
const load = createRequire(import.meta.url);
console.log(data.version, load("./data.json").version, load("./data.json").nested.port);
const { list } = load("./data.json");
console.log(list.length);
