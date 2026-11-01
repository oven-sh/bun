import { holdProgramsOfSuites } from "../harness/runner-suites";

holdProgramsOfSuites(
  "test/js/node/v8/capture-stack-trace.test.js 1/2",
  "test/js/node/v8/capture-stack-trace.test.js 2/2",
);
