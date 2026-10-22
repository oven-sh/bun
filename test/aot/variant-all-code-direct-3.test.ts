// Every function gets its machine code from the direct code generator, which by itself takes only the functions that are not hot: one walk over the B3 values as they were emitted, no B3 phase, no Air.
// A program that fails here and passes without the switch shows a fault of that generator in a form of code that only hot functions have.
import { variant } from "./run-programs";

variant("all-code-direct", ["--aot-testing=GenerateAllCodeDirectly"], {}, 3, 3);
