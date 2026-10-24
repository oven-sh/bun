import { scaled } from "@/scale";
import settings from "#settings";
import { Counter, limit, origin, plusOne } from "legacy";
import { Pixel, type Point, sum } from "shapes";

let total = 0;
const points: Point[] = [];
const counter = new Counter(0);
for (let i = 0; i < 2000; i++) {
  const p = new Pixel(i, 1);
  points.push(scaled(p));
  total += p.sum() + sum(p) + sum(origin()) + plusOne(i) + counter.next() + limit + settings.scale;
}
for (const p of points) total += p.x + p.y;
console.log("total: " + total);
console.log("counter: " + counter.n + " " + JSON.stringify(counter));
console.log("last: " + JSON.stringify(points[points.length - 1]) + " " + settings.name + " " + Object.keys(origin()).join());
