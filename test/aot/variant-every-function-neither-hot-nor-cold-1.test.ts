// Every function is compiled as most of a large program is: by the compiler's own estimate of its heat, and with no memory at its places of where a property was found. As it stands, every function of a test program is among the hottest of its program: hot, and with that memory. heat/neither-*.test.ts do the same to every program in the `jsc` shell.
import { variant } from "./run-programs";

variant("every-function-neither-hot-nor-cold", { BUN_JSC_aotHotByTextForTesting: "4" }, {}, 1, 3);
