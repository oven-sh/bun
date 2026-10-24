// "sideEffects": false. left.js and right.js import each other, a third file closes a longer ring, and a second ring is used by nobody. Each file prints when it is evaluated. `bun run` also evaluates lonely-2.js and lonely-1.js. `bun build --compile` leaves them out, and --aot follows it.
import { left } from "rings";

console.log(left(2));
