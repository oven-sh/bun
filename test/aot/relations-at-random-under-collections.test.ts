// The collector runs at every third slow allocation and writes over what it frees.
import { programsBuiltWith } from "./run-programs";

programsBuiltWith("relations-at-random", "under-collections", ["--aot-disable=InlineCalls"], { BUN_JSC_slowPathAllocsBetweenGCs: "3", BUN_JSC_scribbleFreeCells: "1" });
