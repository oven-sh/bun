import { holdSuites } from "../harness/runner-suites";

holdSuites(
  "test/cli/run/transpiler-cache.test.ts 1/3",
  "test/cli/run/transpiler-cache.test.ts 2/3",
  "test/cli/run/transpiler-cache.test.ts 3/3",
);
