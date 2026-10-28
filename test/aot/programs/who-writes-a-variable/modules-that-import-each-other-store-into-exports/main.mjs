// Two files import each other, one reads an export of the other before it is filled, and a file imports its own namespace.
import { readB, setFromA } from "./b.mjs";
export let a = 1; export function setA(v) { a = v; } export function readA() { return a; }
console.log(readB(), a); setFromA(5); console.log(a, readA());
import * as self from "./main.mjs"; console.log(self.a, Object.keys(self).join()); setA(6); console.log(self.a);
