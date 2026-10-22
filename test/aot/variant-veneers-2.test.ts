// Every direct call from one compiled function to another goes through a veneer, as a call across a very large program does.
import { variant } from "./run-programs";

variant("veneers", ["--aot-limit=function-call-reach:0"], {}, 2, 3);
