import { holdProgramsOfSuites } from "../harness/runner-suites";

holdProgramsOfSuites(
  "test/js/bun/css/css-loader.test.ts",
  "test/js/bun/resolve/import-query.test.ts",
  "test/js/bun/resolve/resolve.test.ts 1/3",
  "test/js/bun/resolve/resolve.test.ts 2/3",
  "test/js/bun/resolve/resolve.test.ts 3/3",
);
