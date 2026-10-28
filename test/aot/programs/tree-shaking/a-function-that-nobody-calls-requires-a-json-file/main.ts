import data from "./data.json";
import { never } from "./unused";
console.log(data.version, data.nested.port, typeof never === "string" ? never : "");
