namespace Geometry {
  export function area(side: number): number {
    return side * side;
  }
  export function twice(side: number): number {
    return area(side) * 2;
  }
  export function twiceByName(side: number): number {
    return Geometry.area(side) * 2;
  }
  export let scale: (n: number) => number = n => n * 10;
  export function scaled(n: number): number {
    return scale(n);
  }
}

function outside(side: number): number {
  return Geometry.area(side);
}

function through(g: typeof Geometry, side: number): number {
  return g.area(side);
}

function round(label: string): void {
  console.log(label + ": " + [Geometry.area(3), outside(3), through(Geometry, 3), Geometry.twice(3), Geometry.twiceByName(3), Geometry.scale(3), Geometry.scaled(3)].join(" "));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += outside(i) + through(Geometry, i) + Geometry.twice(i) + Geometry.scaled(i);
console.log("2000 honest: " + warm);
round("before");

export {};
