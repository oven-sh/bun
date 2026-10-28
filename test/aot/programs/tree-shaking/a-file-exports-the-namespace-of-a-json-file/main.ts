import { all } from "./barrel";
import data from "./data.json";
(all.default as any).version = "9";
console.log(data.version, all.version, all.default.version);
