// As variant-validate, and the executable collects at every allocation that leaves the fast path and overwrites every cell it frees: the validators of frame maps, barriers and caches run after each collection, and a value the collector missed is gone at once. It marks with one thread and never while the program runs: only the collector's own visitor compares its fast visit of a cell with the visit through the method table (SlotVisitor::validateFastVisit), and only while the program is stopped, so this way every marked cell is compared.
import { variant } from "./run-programs";

variant(
  "validate-collecting",
  ["--aot-validate"],
  {
    BUN_JSC_slowPathAllocsBetweenGCs: "1",
    BUN_JSC_useZombieMode: "1",
    BUN_JSC_scribbleFreeCells: "1",
    BUN_JSC_numberOfGCMarkers: "1",
    BUN_JSC_useConcurrentGC: "0",
  },
  3,
  3,
);
