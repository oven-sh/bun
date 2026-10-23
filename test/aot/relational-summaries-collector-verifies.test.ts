// The collector checks its own marking against a second, simple one, and the run time checks what every field holds against its type.
import { programsBuiltWith } from "./run-programs";

programsBuiltWith("relational-summaries", "collector-verifies", [], {
  BUN_JSC_verifyGC: "1",
  BUN_JSC_validateAOTRuntime: "1",
});
