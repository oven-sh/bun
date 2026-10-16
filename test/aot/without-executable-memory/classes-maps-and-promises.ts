class Point {
  constructor(public x: number, public y: number) {}
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
}
const points: Point[] = [];
for (let i = 0; i < 1000; i++) points.push(new Point(i, i + 1));
let sum = 0;
for (const point of points) sum += point.length();
const names = new Map<string, number>();
for (let i = 0; i < 100; i++) names.set("k" + i, i);
async function later(n: number): Promise<number> { await null; return n * 2; }
try { (null as any).x; } catch (error) { console.log((error as Error).constructor.name); }
console.log(sum.toFixed(3), names.get("k42"), JSON.stringify({ a: [1, 2, { b: "c" }] }), await later(21));
