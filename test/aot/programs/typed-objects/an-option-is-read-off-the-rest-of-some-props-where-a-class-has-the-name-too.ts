// `child.style.corner`: nobody follows `child.style`. What is stored under `style` is the rest of some props, which mostly leaves `corner` out. A class has a `corner` too, and always fills it.
declare const process: { argv: string[] };
declare const console: { log(...values: any[]): void };
type Styles = { corner?: "sharp" | "round"; color?: string; margin?: number; padding?: number };
type Props = Styles & { children: string; key?: string };
class Cursor {
  corner: "sharp" | "round";
  column: number;
  constructor(corner: "sharp" | "round", column: number) { this.corner = corner; this.column = column; }
}
type Element = { style: Styles; name: string };
const elements: Element[] = [];
function box(props: Props): Element {
  const { children, key, ...style } = props;
  return { style, name: children + (key ?? "") };
}
function countSharp(children: any[]): number {
  let n = 0;
  for (const child of children) {
    const isSharp = child.style.corner === "sharp";
    if (isSharp) n += 2;
    n += child.name.length;
  }
  return n;
}
elements.push(box({ children: "a" }), box({ children: "bc", color: "red" }), box({ children: "d", corner: "sharp" }), box({ children: "e", margin: 1, padding: 2 }));
const cursors = [new Cursor("round", 1), new Cursor("sharp", 2)];
{ (globalThis as any).kept = [box, countSharp, elements, cursors]; const somebody: any = (globalThis as any)[JSON.parse('"somebody"')] ?? {}; somebody[JSON.parse('"something"')] = 1; Object.defineProperty(somebody, JSON.parse('"other"'), { get() { return 1; }, configurable: true }); }
const rounds = Number(process.argv[2]);
let sum = 0;
for (let i = 0; i < rounds; i++) sum += countSharp(elements) + cursors[i & 1]!.column;
console.log(sum);
