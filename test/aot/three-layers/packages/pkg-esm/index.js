export function add(a, b) { return a + b; }
export const twice = x => x * 2;
export function callsAdd(a, b) { return add(a, b); }
export function callsTwice(x) { return twice(x); }
export default function main() { return "main"; }
export class Maker { static make() { return "made"; } }
export { inner, callsInner } from "./inner.js";
