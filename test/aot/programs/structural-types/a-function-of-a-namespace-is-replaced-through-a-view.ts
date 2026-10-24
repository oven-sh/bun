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

const original = Geometry.area;
const view: { area: (side: number) => number } = Geometry;
view.area = side => -side;
round("area replaced through a view");

view.area = Math.sqrt;
round("by a built-in");

view.area = original;
round("put back");

const scale = Geometry.scale;
Geometry.scale = n => n + 0.5;
round("the exported variable stored to");
Geometry.scale = scale;
round("restored");

enum Color {
  Red,
  Green,
}

namespace Color {
  export function name(c: Color): string {
    return c === Color.Red ? "red" : "green";
  }
}

const colorView: { name: (c: Color) => string } = Color;
console.log("a function merged into an enum: " + Color.name(Color.Green));
colorView.name = () => "replaced";
console.log("replaced: " + Color.name(Color.Green) + " " + Color[1]);

function helper(): string {
  return "helper " + helper.suffix();
}

namespace helper {
  export function suffix(): string {
    return "first";
  }
}

const helperView: { suffix: () => string } = helper;
console.log("a function merged into a function: " + helper());
helperView.suffix = () => "second";
console.log("replaced: " + helper() + " " + helper.suffix());

export {};
