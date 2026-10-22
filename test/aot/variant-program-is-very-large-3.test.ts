// Every program counts as very large: heat is read off the structure alone, most functions are cold, cold functions get their type tests behind the rounds of the optimizer, and a copy behind a failed test holds its stretch alone.
// That is how the largest applications are compiled, and no test program is large enough to get there by itself. A program that fails here and passes under the default flags shows a fault of that road.
import { variant } from "./run-programs";

variant("program-is-very-large", ["--aot-limit=MaxWarmCodeValues:1"], {}, 3, 3);
