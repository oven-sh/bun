import { holdSuitesInEveryRun } from "../harness/runner-suites";

// See plugins-1.test.ts.
holdSuitesInEveryRun("test/js/bun/plugin/plugins.test.ts 3/8", "test/js/bun/plugin/plugins.test.ts 4/8");
