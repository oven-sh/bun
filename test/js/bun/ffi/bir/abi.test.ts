import { runFixtures } from "./run-fixtures";

// Calling conventions: what is sent is what arrives, between C functions, between C and the C library, and between
// C and JavaScript.
runFixtures("abi");
