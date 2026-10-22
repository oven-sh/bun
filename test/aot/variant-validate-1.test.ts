// Compiled code tests every value it defines against the type the engine trusts, tests the shape at every closed access and poisons frame cells at exit, and crashes on a mismatch. The program is the one a release build compiles: validation only adds checks.
import { variant } from "./run-programs";

variant("validate", ["--aot-validate"], {}, 1, 3);
