// A string concatenation or template literal of primitives whose result is unused is removed. One that may run user code or throw is kept.
// SIZE< unusedLabel 8
// SIZE< unusedTemplate 20
// SIZE< unusedChain 20
// CALLS+ keepsObject .
// CALLS+ keepsSymbol .
type Point = { x: number; label: string };
export function unusedLabel(i: number): number {
  const p: Point = { x: i, label: "p" + i };
  return p.x;
}
export function unusedTemplate(i: number, on: boolean, s: string): number {
  const p: Point = { x: i, label: `${s}-${i}-${on}-${null}-${undefined}` };
  return p.x + 1;
}
export function unusedChain(i: number, s: string): number {
  const p: Point = { x: i, label: s + i + "/" + s + 1n };
  return p.x + 2;
}
export function keepsObject(i: number, o: object): number {
  const p: Point = { x: i, label: "p" + o };
  return p.x;
}
export function keepsSymbol(i: number, key: string | symbol): number {
  const p: Point = { x: i, label: `${key as any}` };
  return p.x;
}
const log: string[] = [];
const noisy = { toString() { log.push("toString"); return "noisy"; } };
console.log(unusedLabel(1), unusedTemplate(2, true, "s"), unusedChain(3, "t"), keepsObject(4, noisy), log.join());
try {
  console.log(keepsSymbol(5, Symbol.iterator));
} catch (error) {
  console.log((error as Error).constructor.name);
}
