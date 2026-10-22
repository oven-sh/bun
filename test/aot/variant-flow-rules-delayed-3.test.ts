// See ./variant-flow-rules-delayed-1.test.ts. The third seed.
import { variant } from "./run-programs";

variant("flow-rules-delayed", ["--aot-testing=DelayFlowRules,DelayOtherFlowRules"], {}, 3, 3);
