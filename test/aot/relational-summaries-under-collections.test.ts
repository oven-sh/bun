// The collector runs at every third slow allocation and writes over what it frees: whatever was kept by somebody whom the compiler did not see is gone at once, not some day.
import { programsBuiltWith } from "./run-programs";

programsBuiltWith("relational-summaries", "under-collections", ["--aot-disable=InlineCalls"], { BUN_JSC_slowPathAllocsBetweenGCs: "3", BUN_JSC_scribbleFreeCells: "1" });
