// Every function gets its machine code from the direct code generator that allocates registers by linear scan: the one ARM64 has. On x86-64 it stands behind this switch.
// A program that fails here and passes with GenerateAllCodeDirectly alone shows a fault of that generator.
import { variant } from "./run-programs";

variant("direct-code-by-linear-scan", ["--aot-testing=GenerateAllCodeDirectly", "--aot-testing=GenerateDirectCodeByLinearScan"], {}, 2, 3);
