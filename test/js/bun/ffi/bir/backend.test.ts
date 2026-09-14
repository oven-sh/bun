import { runFixtures } from "./run-fixtures";

// C programs written to reach what was changed in the JIT backend for C: each is run as usual and, where the change
// has a switch, once more with it off; what the program does must not depend on it. COVERAGE.md, section 8.
runFixtures("backend");
