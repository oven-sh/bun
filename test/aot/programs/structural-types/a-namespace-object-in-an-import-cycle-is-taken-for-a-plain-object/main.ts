import { grow, measuredAtLoad } from "./shape.ts";
import { measure } from "./measure.ts";
import { lines } from "./report.ts";

measure("late");
grow();
measure("grown");
for (const line of lines) console.log(line);
console.log(measuredAtLoad);
