import { runTests } from "./harness";

runTests({
  package: "postgres",
  repository: "https://github.com/porsager/postgres",
  ref: "v3.4.3",
  paths: ["tests/index.js"],
  runner: "mocha",
  todo: true,
});
