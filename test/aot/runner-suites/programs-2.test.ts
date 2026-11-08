import { holdProgramsOfSuites } from "../harness/runner-suites";

holdProgramsOfSuites(
  "test/js/bun/resolve/import-meta-glob.test.ts 1/3",
  "test/js/bun/resolve/import-meta-glob.test.ts 2/3",
  "test/js/bun/resolve/import-meta-glob.test.ts 3/3",
);
