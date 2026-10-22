export interface Point { x: number; y: number }
export function sum(p: Point): number { return p.x + p.y; }
export function scale(n: number): number { return n * 2; }
export function report(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
export function run(odd: any, text: any) {
  report("a Point", () => sum({ x: 1, y: 2 }));
  report("a field of another kind", () => sum(odd));
  report("a field that is missing", () => sum({ x: 1 } as any));
  report("a number", () => scale(4));
  report("a string for a number", () => scale(text));
}
