import { runFixtures } from "./run-fixtures";

// _Atomic objects, <stdatomic.h>, and the __atomic_* / __sync_* builtins at every width.
runFixtures("atomics");
