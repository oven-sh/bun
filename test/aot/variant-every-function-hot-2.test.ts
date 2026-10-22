// Every function is compiled in the forms that the compiler has for hot code: callees are guessed and copied in, a field that holds one function is called without being read, built-ins that take a callback become loops around it. By its own estimate most functions of a test program are not hot. heat/hot-*.test.ts do the same to every program in the `jsc` shell.
import { variant } from "./run-programs";

variant("every-function-hot", ["--aot-heat=everything-is-hot"], {}, 2, 3);
