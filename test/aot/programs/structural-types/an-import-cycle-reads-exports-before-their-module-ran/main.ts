import { sawSecond } from "./first.ts";
import { lines } from "./report.ts";
import { look } from "./second.ts";

look("late");
for (const line of lines) console.log(line);
console.log("first saw second: " + sawSecond);
