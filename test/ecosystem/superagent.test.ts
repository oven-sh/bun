import { runTests } from "./harness";

runTests({
  package: "superagent", // used by `express` for testing
  repository: "https://github.com/ladjs/superagent",
  ref: "v8.1.2",
  paths: ["test/*.js"],
  runner: "mocha",
  todo: true,
});
