import { runFixtures } from "./run-fixtures";

// long double on x86-64: the x87 80-bit format, computed with in memory, passed on the stack,
// returned on the x87 register stack, and understood by the C library's printf, strtold and libm.
runFixtures("long-double");
