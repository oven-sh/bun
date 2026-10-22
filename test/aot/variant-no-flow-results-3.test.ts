// Every result of the flow analysis is switched off: every layout stays open, every declared type is tested, nothing is proven. Slower, and the answers must be the same.
import { variant } from "./run-programs";

variant("no-flow-results", ["--aot-disable=flow-results"], {}, 3, 3);
