import { holdProgramsOfSuites } from "../harness/runner-suites";

holdProgramsOfSuites(
  "test/bundler/bundler_compile_prelinked.test.ts 1/2",
  "test/bundler/bundler_compile_prelinked.test.ts 2/2",
);
