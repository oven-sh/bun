// Every function is compiled as most of a large program is: by the compiler's own estimate of its heat, and without site caches, which only the hottest functions of a program get. By default every function of a test program is among the hottest. heat/neither-*.test.ts do the same to every program in the `jsc` shell.
import { variant } from "./run-programs";

variant("every-function-neither-hot-nor-cold", ["--aot-heat=nothing-is-hottest"], {}, 1, 3);
