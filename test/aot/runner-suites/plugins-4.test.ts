import { holdSuitesInEveryRun } from "../harness/runner-suites";

// See plugins-1.test.ts.
holdSuitesInEveryRun("test/js/bun/plugin/plugins.test.ts 7/8", "test/js/bun/plugin/plugins.test.ts 8/8");
