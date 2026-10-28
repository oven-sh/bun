import data from "./data.json";
import { read } from "./reader";
delete (data as any).nested.port;
console.log(read());
