// Every function is compiled in the forms that the compiler has for the coldest part of a large program: compact code, nothing copied into callers, no predictions. A test program is too small to have such a part. heat/cold-*.test.ts do the same to every program in the `jsc` shell.
import { variant } from "./run-programs";

variant("every-function-cold", ["--aot-heat=everything-is-cold"], {}, 1, 3);
