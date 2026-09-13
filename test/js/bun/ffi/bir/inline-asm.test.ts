import { runFixtures } from "./run-fixtures";

// asm statements: the ones that need no assembler (hints, fences, cpuid) and the ones assembled at compile time.
runFixtures("inline-asm");
