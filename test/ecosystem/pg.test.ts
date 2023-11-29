import { runTests } from "./harness";

runTests({
  package: "node-postgres",
  repository: "https://github.com/brianc/node-postgres",
  ref: "pg@8.11.3",
  paths: ["packages/pg/test/unit/connection-parameters/*.js"],
  runner: "mocha",
  todo: true, // https://github.com/oven-sh/bun/issues/7360
});
