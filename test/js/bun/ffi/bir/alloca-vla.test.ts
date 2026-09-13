import { runFixtures } from "./run-fixtures";

// alloca in its spellings and variable length arrays: sizes known only at run time, and the stack given back when their scope ends.
runFixtures("alloca-vla");
