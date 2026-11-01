import { holdSuitesInEveryRun } from "../harness/runner-suites";

// Three faults in its first hour.
holdSuitesInEveryRun(
  "test/js/bun/css/css-loader.test.ts",
  "test/js/bun/import-attributes/import-attributes.test.ts",
  "test/js/bun/resolve/import-custom-condition.test.ts",
  "test/js/bun/resolve/import-meta-glob.test.ts 1/2",
  "test/js/bun/resolve/import-meta-glob.test.ts 2/2",
  "test/js/bun/resolve/resolve.test.ts",
);
