import { holdSuitesInEveryRun } from "../harness/runner-suites";

// It has caught an assertion's stop, and one regression twice.
holdSuitesInEveryRun("test/js/bun/plugin/plugins.test.ts 1/8", "test/js/bun/plugin/plugins.test.ts 2/8");
