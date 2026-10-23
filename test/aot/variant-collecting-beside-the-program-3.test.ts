// A thread asks for a collection every millisecond while the program runs, and every cell that is freed is overwritten. These collections mark beside the program: what is made meanwhile and let go again is freed at their end, and what a missing barrier loses stays lost. A collection with the program stopped (variant-validate-collecting) shows neither.
import { variant } from "./run-programs";

const besideTheProgram = {
  BUN_JSC_collectContinuously: "1",
  BUN_JSC_collectContinuouslyPeriodMS: "1",
  BUN_JSC_useZombieMode: "1",
  BUN_JSC_scribbleFreeCells: "1",
};
variant("collecting-beside-the-program", [], besideTheProgram, 3, 3);
variant("full-collections-beside-the-program", [], { ...besideTheProgram, BUN_JSC_useGenerationalGC: "0" }, 3, 3);
