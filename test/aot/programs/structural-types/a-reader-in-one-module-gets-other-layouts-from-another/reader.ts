export interface Point {
  x: number;
  y: number;
}

export function read(p: Point): number {
  return p.x * 100 + p.y;
}

export function store(p: Point, value: number): void {
  p.x = value;
  p.y = value + 1;
}

export function listing(p: Point): string {
  let walked = "";
  for (const key in p) walked += key;
  return Object.keys(p).join() + " " + walked + " " + JSON.stringify(p) + " " + JSON.stringify({ ...p });
}

export function honest(): number {
  let total = 0;
  for (let i = 0; i < 2000; i++) {
    const p: Point = { x: i, y: i };
    store(p, i);
    total += read(p) + listing(p).length;
  }
  return total;
}

export class Holder {
  constructor(public point: Point) {}
  read(): number {
    return this.point.x * 100 + this.point.y;
  }
}

export default read;
