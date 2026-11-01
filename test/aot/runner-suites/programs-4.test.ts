import { holdProgramsOfSuites } from "../harness/runner-suites";

holdProgramsOfSuites(
  "test/js/bun/import-attributes/import-attributes.test.ts 1/3",
  "test/js/bun/import-attributes/import-attributes.test.ts 2/3",
  "test/js/bun/import-attributes/import-attributes.test.ts 3/3",
);
