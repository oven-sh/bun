import { shared } from "./shared";

console.log("start.ts runs,", shared());
const loaded: Record<string, any> = await import("./" + ["main", "ts"].join("."));
console.log(loaded["fir" + "st"](), "/", loaded["sec" + "ond"](), "/", new loaded["Thi" + "rd"]().name(), "/", loaded["def" + "ault"]());
const required: Record<string, any> = require("./" + ["main", "ts"].join("."));
console.log(required["fir" + "st"](), required === loaded || Object.keys(required).sort().join());
