import { Point, normOf } from "./point.ts";
import { patch, restore } from "./patch.ts";

const p = new Point(3, 4);

function report(label: string): void {
  console.log(label + ": " + p.norm() + " " + normOf(p) + " " + p.twice() + " " + new Point(1, 1).norm() + " " + Object.hasOwn(p, "norm"));
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += normOf(p) + p.norm() + p.twice();
console.log("2000 honest rounds: " + sum);
report("before");
patch();
report("patched by the other module");
restore();
report("restored by the other module");
patch();
report("patched again");
