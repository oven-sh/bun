export let x = 1; export function inc() { x++; } export function setX(v) { x = v; }
let z = 2; export { z as y }; z = 3;
export default function d() { return "d"; } export function reassignDefault() { d = 5; }
export let def; export let late; export function setLate(v) { late = v; }
