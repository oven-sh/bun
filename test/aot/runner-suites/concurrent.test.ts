import { holdSuites } from "../harness/runner-suites";

holdSuites("test/js/bun/test/concurrent.test.ts", "test/js/bun/test/concurrent_immediate.test.ts");
