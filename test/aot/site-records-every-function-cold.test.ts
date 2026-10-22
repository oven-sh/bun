// In code that is not hot an operation whose outcome is not proven is a number and a call: what the compiler expects stands in a read-only record, and the test, the fast way and the general way are in a stub.
// A test program is too small to have a cold part, so every function is declared cold here.
import { programsBuiltWith } from "./run-programs";

programsBuiltWith("site-records", "every-function-cold", ["--aot-heat=everything-is-cold"]);
programsBuiltWith("site-records", "every-function-cold-types-erased", ["--aot-heat=everything-is-cold", "--aot-erase-types"]);
