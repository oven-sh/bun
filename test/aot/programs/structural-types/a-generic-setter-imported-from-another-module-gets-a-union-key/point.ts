export class Point {
  x = 1;
  y = 0.5;
  name = "p";
  sum(): number {
    return this.x + this.y;
  }
  shout(): string {
    return this.name.toUpperCase();
  }
}

export function describe(p: Point): string {
  return typeof p.x + " " + String(p.x) + ", " + typeof p.y + " " + String(p.y) + ", " + typeof p.name + " " + String(p.name) + ", " + Object.keys(p).join() + ", " + JSON.stringify(p);
}
