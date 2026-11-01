import { holdSuites } from "../harness/runner-suites";

holdSuites(
  "test/cli/test/isolation-one-module-fetched-twice.test.ts",
  "test/js/bun/test/dots.test.ts",
  "test/js/bun/test/fake-timers/fake-timers.test.ts",
  "test/js/bun/test/only-failures.test.ts",
);
