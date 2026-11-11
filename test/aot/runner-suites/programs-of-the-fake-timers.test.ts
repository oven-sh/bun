import { holdProgramsOfSuites } from "../harness/runner-suites";

holdProgramsOfSuites(
  "test/js/bun/test/fake-timers/fake-timers.test.ts 1/2",
  "test/js/bun/test/fake-timers/fake-timers.test.ts 2/2",
);
