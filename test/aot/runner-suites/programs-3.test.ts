import { holdProgramsOfSuites } from "../harness/runner-suites";

holdProgramsOfSuites(
  "test/bundler/transpiler/es-decorators.test.ts 1/2",
  "test/bundler/transpiler/es-decorators.test.ts 2/2",
  "test/js/bun/test/stack.test.ts",
  "test/js/bun/util/inspect-error.test.js",
);
