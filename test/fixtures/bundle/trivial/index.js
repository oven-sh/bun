import { fn } from "./fn";

console.log(fn(42));
globalThis.fn = fn;
