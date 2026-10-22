// The package has an "exports" map with a subpath, a pattern and a condition, and "sideEffects" lists a file by the path it has on disk. The functions are reached through the names of the map. `bun run` prints "not-listed.js is evaluated" first. `bun build --compile` leaves that file out, and --aot follows it.
import { root } from "mapped";
import { sub } from "mapped/sub";
import { red } from "mapped/colors/red";

console.log(root(), sub(), red());
