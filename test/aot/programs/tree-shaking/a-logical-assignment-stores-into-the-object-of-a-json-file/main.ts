import data from "./data.json";
import { read } from "./reader";
(data.nested.deep as any).off ??= 6;
console.log(read());
