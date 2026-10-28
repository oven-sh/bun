import data from "./data.json";
import { read } from "./reader";
[(data as any).version, { x: data.nested.port }] = ["a", { x: 1 }];
console.log(read());
