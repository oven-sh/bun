// Compiled code tests every value against the type that it otherwise relies on without a test, and crashes on a value that is not of it.
import { variant } from "./run-programs";

variant("validated-facts", { BUN_JSC_validateAOTTypedFacts: "1" });
