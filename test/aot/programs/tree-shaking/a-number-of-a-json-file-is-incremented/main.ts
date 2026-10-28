import data from "./data.json";
import { read } from "./reader";
data.nested.port++;
console.log(read());
