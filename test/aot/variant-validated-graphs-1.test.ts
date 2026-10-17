// The compiler's intermediate representation is validated after every optimization phase.
import { variant } from "./run-programs";

variant("validated-graphs", { BUN_JSC_validateGraphAtEachPhase: "1" }, {}, 1, 8);
