// No call is taken into its caller. A small program is inlined whole, which hides what a caller believes about a callee: what the callee does to its arguments, to the scope it is handed and to memory.
import { variant } from "./run-programs";

variant("no-inlining", ["--aot-disable=InlineCalls"], {}, 2, 3);
