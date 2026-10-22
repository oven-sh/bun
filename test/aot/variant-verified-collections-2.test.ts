// The executables run under JavaScriptCore's own verifier of the collector: after every marking it marks once more from the roots, with the program stopped, and crashes on a cell that it reaches and the collector has not marked. That is what a store without its write barrier leads to, long before the program reads what was freed.
import { variant } from "./run-programs";

variant("verified-collections", [], { BUN_JSC_verifyGC: "1" }, 2, 3);
