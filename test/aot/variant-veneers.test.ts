// Every direct call between compiled functions goes through a veneer, as if its target were out of range.
import { variant } from "./run-programs";

variant("veneers", { BUN_JSC_forceAOTVeneers: "1" });
