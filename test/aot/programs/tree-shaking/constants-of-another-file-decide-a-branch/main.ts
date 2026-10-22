// The condition is an imported constant: a const false, a const true, a let that its file changes, a const that is computed, an enum member, and a const read through a namespace. Each arm calls its own function.
import { OFF, ON, changes, change, computed, Level } from "./flags";
import * as flags from "./flags";

const log: string[] = [];
function a1() { log.push("OFF is true"); } function a2() { log.push("OFF is false"); } function b1() { log.push("ON is true"); } function b2() { log.push("ON is false"); }
function c1() { log.push("changes is true"); } function c2() { log.push("changes is false"); } function d1() { log.push("computed is true"); } function d2() { log.push("computed is false"); }
function e1() { log.push("Level.High is true"); } function e2() { log.push("Level.High is false"); } function f1() { log.push("flags.ON is true"); } function f2() { log.push("flags.ON is false"); }

OFF ? a1() : a2();
ON ? b1() : b2();
changes ? c1() : c2();
change();
changes ? c1() : c2();
computed ? d1() : d2();
Level.High ? e1() : e2();
flags.ON ? f1() : f2();
console.log(log.join("\n"));
