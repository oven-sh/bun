// Six packages, alike but for "sideEffects": false, true, an empty list, a string, a list that names another file, and none at all. Each is imported for a name that is not used and each prints when it is evaluated. `bun run` evaluates all six. `bun build --compile` leaves out the ones that say false, an empty list and a list that names another file; true, a string and no field at all keep the file. --aot follows it.
import { unused as a } from "says-false";
import { unused as b } from "says-true";
import { unused as c } from "says-empty-list";
import { unused as d } from "says-a-string";
import { unused as e } from "says-another-file";
import { unused as f } from "says-nothing";

console.log("main.js runs");
