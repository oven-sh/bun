import { a, setA, readA } from "./main.mjs";
export let early; try { early = a; } catch (e) { early = e.name; }
export function readB() { return [early, a, readA()]; } export function setFromA(v) { setA(v); }
