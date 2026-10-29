import { __require } from "./chunk.mjs";
import data from "./data.json";
console.log(data.version, __require("./data.json").version, __require("./data.json").nested.port);
