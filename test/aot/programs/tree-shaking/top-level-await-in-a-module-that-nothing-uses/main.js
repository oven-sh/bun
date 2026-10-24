// "sideEffects": false. waits.js awaits at its top level and nothing of it is used. Whether it is there shows in the order: a module that awaits holds back its importer while promise jobs run. `bun run` prints the job, then waits.js, then main.js. `bun build --compile` leaves waits.js out, so main.js runs first and the job after it, and --aot follows it.
import "./schedules.js";
import { unused } from "waiting/waits.js";
import { used } from "waiting/used.js";

console.log("main.js runs", used());
