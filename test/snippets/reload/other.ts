import previous from "./timestamp.txt";
import { join } from "path";

const current = performance.now() + performance.timeOrigin;
console.log(current - previous);

require("fs").writeFileSync(join(import.meta.dir, "timestamp.txt"), current);
