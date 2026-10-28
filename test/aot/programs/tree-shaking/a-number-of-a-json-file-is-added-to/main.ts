import data from "./data.json";
import { read } from "./reader";
data.nested.port += 2;
console.log(read());
