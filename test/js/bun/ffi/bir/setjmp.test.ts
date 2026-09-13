import { runFixtures } from "./run-fixtures";

// setjmp and longjmp: what a function that can be re-entered keeps in memory.
runFixtures("setjmp");
