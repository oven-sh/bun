// Every function gets its machine code from the direct code generator that allocates registers by linear scan. It stands behind this switch until it beats the other one in bytes and in its own price.
// A program that fails here and passes with GenerateAllCodeDirectly alone shows a fault of that generator.
import { variant } from "./run-programs";

variant(
  "direct-code-by-linear-scan",
  ["--aot-testing=GenerateAllCodeDirectly", "--aot-testing=GenerateDirectCodeByLinearScan"],
  {},
  1,
  3,
);
