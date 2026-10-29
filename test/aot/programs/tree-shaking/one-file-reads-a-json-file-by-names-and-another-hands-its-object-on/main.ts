import data from "./data.json";
import { whole } from "./whole";
console.log(data.version, data.nested.port);
(whole() as any).version = "9";
whole().nested.port = 81;
console.log(data.version, data.nested.port, whole() === data);
