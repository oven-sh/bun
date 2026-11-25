import { holdSuites } from "../harness/runner-suites";

holdSuites(
  "test/cli/test/isolation-first-ticks-of-each-file.test.ts",
  "test/cli/test/isolation.test.ts 1/4",
  "test/cli/test/isolation.test.ts 2/4",
  "test/cli/test/isolation.test.ts 3/4",
  "test/cli/test/isolation.test.ts 4/4",
);
