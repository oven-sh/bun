import { holdSuites } from "../harness/runner-suites";

holdSuites("test/cli/test/coverage.test.ts", "test/js/bun/test/bun_test.test.ts");
