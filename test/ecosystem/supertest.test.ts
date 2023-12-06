import { runTests } from "./harness";

runTests({
  package: "supertest", // used by `express` for testing
  repository: "https://github.com/ladjs/supertest",
  ref: "v6.3.3",
  paths: ["test/*.js"],
  runner: "mocha",
  todo: true,
});
