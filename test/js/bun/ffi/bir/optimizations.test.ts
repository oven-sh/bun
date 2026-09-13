import { runFixtures, runProjects } from "./run-fixtures";

// What the compiler does to be fast (registers for small aggregates, combined byte accesses, rotates, folded constants) still computes the same values.
runFixtures("optimizations");
runProjects("optimizations");
