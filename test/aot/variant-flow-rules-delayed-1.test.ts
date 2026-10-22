// What flow answers may not hang on the order in which its rules run. Under each of these switches about half of the rules that are due in a round wait for a later one, chosen by a seed:
// another valid schedule, in which more is hidden behind the value nobody knows by the time a rule looks. Every program must answer as it does under the usual schedule.
// A program that fails here and passes without the switch shows a fault of flow's rules: something that a rule does only if it looks early enough. It was there before the change that
// turned the test red: that change has only moved the schedule.
// ./flow-schedules.test.ts holds the size of the code against the usual schedule's.
import { variant } from "./run-programs";

variant("flow-rules-delayed", ["--aot-testing=DelayFlowRules"], {}, 1, 3);
