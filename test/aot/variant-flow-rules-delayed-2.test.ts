// See ./variant-flow-rules-delayed-1.test.ts. The second seed.
import { variant } from "./run-programs";

variant("flow-rules-delayed", ["--aot-testing=DelayOtherFlowRules"], {}, 2, 3);
